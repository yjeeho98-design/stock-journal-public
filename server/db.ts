import { and, desc, eq, gte, lte } from "drizzle-orm";
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
import { calculatePortfolioLedger } from "../shared/portfolioLedger";
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

  // 전체 거래를 시간순으로 재생해 부분 매도·재매수에도 정확한 이동평균 원가를 적용한다.
  const allTrades = await db
    .select({
      id: trades.id,
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
      secFee: trades.secFee,
      tradeDate: trades.tradeDate,
    })
    .from(trades)
    .where(and(...conditions))
    .orderBy(trades.tradeDate, trades.id);

  const { summaries } = calculatePortfolioLedger(allTrades);

  return summaries.map((s) => ({
    ticker: s.ticker,
    tickerName: s.tickerName,
    market: s.market,
    totalBuyAmountKrw: String(s.totalBuyAmountKrw),
    totalBuyCostKrw: String(s.totalBuyCostKrw),
    totalSellAmountKrw: String(s.totalSellAmountKrw),
    totalSellCostKrw: String(s.totalSellCostKrw),
    netSellProceedsKrw: String(s.netSellProceedsKrw),
    totalBuyQty: String(s.totalBuyQty),
    totalSellQty: String(s.totalSellQty),
    holdingQty: String(s.holdingQty),
    totalCommission: String(s.totalCommission),
    totalTax: String(s.totalTax),
    totalSecFeeKrw: String(s.totalSecFeeKrw),
    totalBuyAmountUsd: String(s.totalBuyAmountUsd),
    realizedCostKrw: String(s.realizedCostKrw),
    realizedPnlKrw: String(s.realizedPnlKrw),
    realizedPnlRate: s.realizedCostKrw > 0 ? String((s.realizedPnlKrw / s.realizedCostKrw) * 100) : null,
    avgCostKrwMoving: String(s.avgCostKrw),
    avgCostUsdMoving: String(s.avgCostUsd),
  }));
}

export async function getMonthlyPnL(userId: number) {
  const db = await getDb();
  if (!db) return [];

  const allTrades = await db
    .select({
      id: trades.id,
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
      secFee: trades.secFee,
      tradeDate: trades.tradeDate,
    })
    .from(trades)
    .where(eq(trades.userId, userId))
    .orderBy(trades.tradeDate, trades.id);

  const { saleEvents } = calculatePortfolioLedger(allTrades);
  const byMonth = new Map<string, { yearMonth: string; market: "us" | "kr"; realizedPnlKrw: number }>();

  for (const sale of saleEvents) {
    const yearMonth = sale.tradeDate.toISOString().slice(0, 7);
    const key = `${yearMonth}__${sale.market}`;
    const existing = byMonth.get(key) ?? { yearMonth, market: sale.market, realizedPnlKrw: 0 };
    existing.realizedPnlKrw += sale.realizedPnlKrw;
    byMonth.set(key, existing);
  }

  return Array.from(byMonth.values())
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth) || a.market.localeCompare(b.market))
    .map((row) => ({ ...row, realizedPnlKrw: String(row.realizedPnlKrw) }));
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
