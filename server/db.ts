import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  Dividend,
  FundRecord,
  InsertDividend,
  InsertFundRecord,
  InsertJournalEntry,
  InsertTrade,
  InsertUser,
  InsertUserSettings,
  JournalEntry,
  Trade,
  UserSettings,
  dividends,
  fundRecords,
  journalEntries,
  trades,
  userSettings,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

// ─── Trades ──────────────────────────────────────────────────────────────────

export async function createTrade(trade: InsertTrade): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(trades).values(trade);
}

export async function getTradesByUser(
  userId: number,
  options?: {
    market?: "us" | "kr";
    ticker?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }
): Promise<Trade[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(trades.userId, userId)];
  if (options?.market) conditions.push(eq(trades.market, options.market));
  if (options?.ticker) conditions.push(eq(trades.ticker, options.ticker.toUpperCase()));
  if (options?.from) conditions.push(gte(trades.tradeDate, options.from));
  if (options?.to) conditions.push(lte(trades.tradeDate, options.to));

  const query = db
    .select()
    .from(trades)
    .where(and(...conditions))
    .orderBy(desc(trades.tradeDate));

  if (options?.limit) {
    return await query.limit(options.limit).offset(options?.offset ?? 0);
  }
  return await query;
}

export async function getTradeById(id: number, userId: number): Promise<Trade | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(trades)
    .where(and(eq(trades.id, id), eq(trades.userId, userId)))
    .limit(1);
  return result[0];
}

export async function updateTrade(
  id: number,
  userId: number,
  data: Partial<InsertTrade>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(trades)
    .set(data)
    .where(and(eq(trades.id, id), eq(trades.userId, userId)));
}

export async function deleteTrade(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(trades).where(and(eq(trades.id, id), eq(trades.userId, userId)));
}

export async function bulkInsertTrades(tradeList: InsertTrade[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (tradeList.length === 0) return;
  // Insert in batches of 100
  for (let i = 0; i < tradeList.length; i += 100) {
    await db.insert(trades).values(tradeList.slice(i, i + 100));
  }
}

// ─── Portfolio Summary ────────────────────────────────────────────────────────

export async function getPortfolioSummary(userId: number, market?: "us" | "kr") {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(trades.userId, userId)];
  if (market) conditions.push(eq(trades.market, market));

  // 1) 전체 거래 내역을 날짜 순으로 가져옴
  const allTrades = await db
    .select({
      ticker: trades.ticker,
      market: trades.market,
      tickerName: trades.tickerName,
      tradeType: trades.tradeType,
      quantity: trades.quantity,
      price: trades.price,
      exchangeRate: trades.exchangeRate,
      totalAmountKrw: trades.totalAmountKrw,
      commission: trades.commission,
      tax: trades.tax,
      tradeDate: trades.tradeDate,
    })
    .from(trades)
    .where(and(...conditions))
    .orderBy(trades.tradeDate, trades.id);

  // 2) 종목별 이동평균법으로 평균단가 계산
  type TickerState = {
    ticker: string;
    market: string;
    tickerName: string | null;
    holdingQty: number;
    holdingCostKrw: number;  // 현재 보유 원가 합계
    holdingCostUsd: number;  // 현재 보유 달러 원가 합계 (미국주식)
    totalBuyQty: number;
    totalSellQty: number;
    totalBuyAmountKrw: number;
    totalSellAmountKrw: number;
    totalBuyAmountUsd: number;
    totalCommission: number;
    totalTax: number;
    avgCostKrw: number;      // 이동평균 원화 단가
    avgCostUsd: number;      // 이동평균 달러 단가
  };

  const map = new Map<string, TickerState>();

  for (const t of allTrades) {
    const key = `${t.ticker}__${t.market}`;
    if (!map.has(key)) {
      map.set(key, {
        ticker: t.ticker,
        market: t.market,
        tickerName: t.tickerName ?? null,
        holdingQty: 0,
        holdingCostKrw: 0,
        holdingCostUsd: 0,
        totalBuyQty: 0,
        totalSellQty: 0,
        totalBuyAmountKrw: 0,
        totalSellAmountKrw: 0,
        totalBuyAmountUsd: 0,
        totalCommission: 0,
        totalTax: 0,
        avgCostKrw: 0,
        avgCostUsd: 0,
      });
    }
    const s = map.get(key)!;
    if (t.tickerName) s.tickerName = t.tickerName;

    const qty = Number(t.quantity);
    const amtKrw = Number(t.totalAmountKrw);
    const priceUsd = Number(t.price);
    const comm = Number(t.commission ?? 0);
    const tax = Number(t.tax ?? 0);

    s.totalCommission += comm;
    s.totalTax += tax;

    if (t.tradeType === 'buy') {
      // 이동평균법: 신규 매수 시 보유 원가에 추가
      s.holdingCostKrw += amtKrw;
      s.holdingCostUsd += qty * priceUsd;
      s.holdingQty += qty;
      s.totalBuyQty += qty;
      s.totalBuyAmountKrw += amtKrw;
      s.totalBuyAmountUsd += qty * priceUsd;
      // 이동평균 단가 갱신
      s.avgCostKrw = s.holdingQty > 0 ? s.holdingCostKrw / s.holdingQty : 0;
      s.avgCostUsd = s.holdingQty > 0 ? s.holdingCostUsd / s.holdingQty : 0;
    } else {
      // 매도: 현재 이동평균 단가 기준으로 보유 원가에서 차감
      const costKrwPerShare = s.holdingQty > 0 ? s.holdingCostKrw / s.holdingQty : 0;
      const costUsdPerShare = s.holdingQty > 0 ? s.holdingCostUsd / s.holdingQty : 0;
      s.holdingCostKrw -= costKrwPerShare * qty;
      s.holdingCostUsd -= costUsdPerShare * qty;
      s.holdingQty -= qty;
      s.totalSellQty += qty;
      s.totalSellAmountKrw += amtKrw;
      // 매도 후 보유 수량이 0이면 원가도 0으로 초기화
      if (s.holdingQty <= 0) {
        s.holdingQty = 0;
        s.holdingCostKrw = 0;
        s.holdingCostUsd = 0;
      }
      // 이동평균 단가는 매도 시 변하지 않음 (보유 수량 기준 유지)
    }
  }

  // 3) 결과 포맷 변환
  return Array.from(map.values()).map((s) => ({
    ticker: s.ticker,
    tickerName: s.tickerName,
    market: s.market,
    totalBuyAmountKrw: String(s.totalBuyAmountKrw),
    totalSellAmountKrw: String(s.totalSellAmountKrw),
    totalBuyQty: String(s.totalBuyQty),
    totalSellQty: String(s.totalSellQty),
    totalCommission: String(s.totalCommission),
    totalTax: String(s.totalTax),
    totalBuyAmountUsd: String(s.totalBuyAmountUsd),
    // 이동평균법으로 계산된 현재 보유 평균단가
    avgCostKrwMoving: String(s.avgCostKrw),
    avgCostUsdMoving: String(s.avgCostUsd),
  }));
}

export async function getMonthlyPnL(userId: number) {
  const db = await getDb();
  if (!db) return [];

    const result = await db
    .select({
      yearMonth: sql<string>`DATE_FORMAT(tradeDate, '%Y-%m')`,
      market: trades.market,
      totalBuyKrw: sql<string>`SUM(CASE WHEN tradeType = 'buy' THEN totalAmountKrw ELSE 0 END)`,
      totalSellKrw: sql<string>`SUM(CASE WHEN tradeType = 'sell' THEN totalAmountKrw ELSE 0 END)`,
    })
    .from(trades)
    .where(eq(trades.userId, userId))
    .groupBy(sql`DATE_FORMAT(tradeDate, '%Y-%m')`, trades.market)
    .orderBy(sql`DATE_FORMAT(tradeDate, '%Y-%m')`);

  return result;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getUserSettings(userId: number): Promise<UserSettings | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return result[0];
}

export async function upsertUserSettings(
  userId: number,
  data: Partial<InsertUserSettings>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .insert(userSettings)
    .values({ userId, ...data })
    .onDuplicateKeyUpdate({ set: data });
}

// ─── Journal ──────────────────────────────────────────────────────────────────

export async function getJournalEntries(userId: number): Promise<JournalEntry[]> {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.userId, userId))
    .orderBy(desc(journalEntries.entryDate));
}

export async function createJournalEntry(entry: InsertJournalEntry): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(journalEntries).values(entry);
}

export async function updateJournalEntry(
  id: number,
  userId: number,
  data: Partial<InsertJournalEntry>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(journalEntries)
    .set(data)
    .where(and(eq(journalEntries.id, id), eq(journalEntries.userId, userId)));
}

export async function deleteJournalEntry(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .delete(journalEntries)
    .where(and(eq(journalEntries.id, id), eq(journalEntries.userId, userId)));
}

// ─── Fund Records ─────────────────────────────────────────────────────────────

export async function getFundRecords(userId: number): Promise<FundRecord[]> {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(fundRecords)
    .where(eq(fundRecords.userId, userId))
    .orderBy(desc(fundRecords.recordDate));
}

export async function createFundRecord(record: InsertFundRecord): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(fundRecords).values(record);
}

export async function deleteFundRecord(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .delete(fundRecords)
    .where(and(eq(fundRecords.id, id), eq(fundRecords.userId, userId)));
}

// ─── Dividends ────────────────────────────────────────────────────────────────

export async function updateFundRecord(
  id: number,
  userId: number,
  data: {
    fundType?: "debt" | "extra_income" | "regular";
    recordType?: "deposit" | "withdrawal" | "interest" | "extra_visit" | "extra_mobile" | "extra_board";
    amount?: string;
    description?: string | null;
    recordDate?: Date;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(fundRecords)
    .set({ ...data })
    .where(and(eq(fundRecords.id, id), eq(fundRecords.userId, userId)));
}

export async function getDividends(userId: number): Promise<Dividend[]> {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(dividends)
    .where(eq(dividends.userId, userId))
    .orderBy(desc(dividends.dividendDate));
}

export async function createDividend(dividend: InsertDividend): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(dividends).values(dividend);
}

export async function deleteDividend(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .delete(dividends)
    .where(and(eq(dividends.id, id), eq(dividends.userId, userId)));
}
