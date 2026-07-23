import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  bulkInsertTrades,
  createDividend,
  createFundRecord,
  createJournalEntry,
  createTrade,
  deleteDividend,
  deleteFundRecord,
  deleteJournalEntry,
  deleteTrade,
  getDividends,
  getFundRecords,
  getJournalEntries,
  getMonthlyPnL,
  getPortfolioSummary,
  getTradeById,
  getTradesByUser,
  getUserSettings,
  updateFundRecord,
  updateJournalEntry,
  updateTrade,
  updateTickerNameForUser,
  upsertUserSettings,
} from "./db";
import {
  getKrStockPrice,
  getUsStockPrice,
  getUsdKrwRate,
  searchKrTicker,
  searchUsTicker,
} from "./marketData";

type TickerNameRow = {
  ticker: string;
  market: "us" | "kr";
  tickerName: string | null;
};

/**
 * 과거 CSV·수기 거래에서 비어 있는 종목명을 시장별 조회로 보강하고, 다음 조회부터는 DB 값으로 보여준다.
 */
async function enrichTickerNames<T extends TickerNameRow>(userId: number, rows: T[]): Promise<T[]> {
  const missing = Array.from(
    new Map(
      rows
        .filter((row) => !row.tickerName?.trim())
        .map((row) => [`${row.market}__${row.ticker}`, row] as const)
    ).values()
  ).slice(0, 50);

  if (missing.length === 0) return rows;

  const results = await Promise.allSettled(
    missing.map(async (row) => {
      const quote = row.market === "us"
        ? await getUsStockPrice(row.ticker)
        : await getKrStockPrice(row.ticker);
      return { row, name: quote?.name?.trim() ?? "" };
    })
  );

  const names = new Map<string, string>();
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.name) continue;
    const { row, name } = result.value;
    const key = `${row.market}__${row.ticker}`;
    names.set(key, name);
    await updateTickerNameForUser(userId, row.market, row.ticker, name);
  }

  return rows.map((row) => ({
    ...row,
    tickerName: row.tickerName?.trim() || names.get(`${row.market}__${row.ticker}`) || null,
  }));
}

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Market Data ───────────────────────────────────────────────────────────
  market: router({
    usPrice: publicProcedure
      .input(z.object({ ticker: z.string().min(1).max(20) }))
      .query(async ({ input }) => {
        return await getUsStockPrice(input.ticker);
      }),

    krPrice: publicProcedure
      .input(z.object({ ticker: z.string().min(1).max(20) }))
      .query(async ({ input }) => {
        return await getKrStockPrice(input.ticker);
      }),

    exchangeRate: publicProcedure.query(async () => {
      const rate = await getUsdKrwRate();
      return { rate, updatedAt: new Date() };
    }),

    searchUs: publicProcedure
      .input(z.object({ query: z.string().min(1) }))
      .query(async ({ input }) => {
        return await searchUsTicker(input.query);
      }),

    // 국내주식 종목명 검색 (네이버 증권 자동완성)
    searchKr: publicProcedure
      .input(z.object({ query: z.string().min(1) }))
      .query(async ({ input }) => {
        return await searchKrTicker(input.query);
      }),

    // 여러 종목 현재가 일괄 조회 (Yahoo Finance 병렬 요청)
    batchUsPrice: protectedProcedure
      .input(z.object({ tickers: z.array(z.string().min(1).max(20)).max(50) }))
      .query(async ({ input }) => {
        const results = await Promise.allSettled(
          input.tickers.map((t) => getUsStockPrice(t))
        );
        const priceMap: Record<string, number> = {};
        const nameMap: Record<string, string> = {};
        results.forEach((r, i) => {
          if (r.status === "fulfilled" && r.value) {
            priceMap[input.tickers[i]] = r.value.price;
            nameMap[input.tickers[i]] = r.value.name;
          }
        });
        return { prices: priceMap, names: nameMap, fetchedAt: new Date() };
      }),

    // 국내주식 현재가 일괄 조회 (네이버 금융 병렬 요청)
    batchKrPrice: protectedProcedure
      .input(z.object({ tickers: z.array(z.string().min(1).max(20)).max(50) }))
      .query(async ({ input }) => {
        const results = await Promise.allSettled(
          input.tickers.map((t) => getKrStockPrice(t))
        );
        const priceMap: Record<string, number> = {};
        const nameMap: Record<string, string> = {};
        results.forEach((r, i) => {
          if (r.status === "fulfilled" && r.value) {
            priceMap[input.tickers[i]] = r.value.price;
            nameMap[input.tickers[i]] = r.value.name;
          }
        });
        return { prices: priceMap, names: nameMap, fetchedAt: new Date() };
      }),
  }),

  // ─── Trades ────────────────────────────────────────────────────────────────
  trades: router({
    list: protectedProcedure
      .input(
        z.object({
          market: z.enum(["us", "kr"]).optional(),
          ticker: z.string().optional(),
          from: z.date().optional(),
          to: z.date().optional(),
          limit: z.number().min(1).max(500).optional(),
          offset: z.number().min(0).optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const rows = await getTradesByUser(ctx.user.id, input);
        return await enrichTickerNames(ctx.user.id, rows);
      }),

    create: protectedProcedure
      .input(
        z.object({
          market: z.enum(["us", "kr"]),
          tradeType: z.enum(["buy", "sell"]),
          ticker: z.string().min(1).max(20),
          tickerName: z.string().max(100).optional(),
          quantity: z.number().positive(),
          price: z.number().positive(),
          exchangeRate: z.number().positive().default(1),
          totalAmountKrw: z.number().positive(),
          commission: z.number().min(0).default(0),
          tax: z.number().min(0).default(0),
          secFee: z.number().min(0).default(0),
          broker: z.string().max(50).optional(),
          memo: z.string().max(1000).optional(),
          tradeDate: z.date(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await createTrade({
          userId: ctx.user.id,
          market: input.market,
          tradeType: input.tradeType,
          ticker: input.ticker.toUpperCase(),
          tickerName: input.tickerName ?? null,
          quantity: String(input.quantity),
          price: String(input.price),
          exchangeRate: String(input.exchangeRate),
          totalAmountKrw: String(input.totalAmountKrw),
          commission: String(input.commission),
          tax: String(input.tax),
          secFee: String(input.secFee),
          broker: input.broker ?? null,
          memo: input.memo ?? null,
          tradeDate: input.tradeDate,
        });
        return { success: true };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          market: z.enum(["us", "kr"]).optional(),
          tradeType: z.enum(["buy", "sell"]).optional(),
          ticker: z.string().min(1).max(20).optional(),
          tickerName: z.string().max(100).optional(),
          quantity: z.number().positive().optional(),
          price: z.number().positive().optional(),
          exchangeRate: z.number().positive().optional(),
          totalAmountKrw: z.number().positive().optional(),
          commission: z.number().min(0).optional(),
          tax: z.number().min(0).optional(),
          secFee: z.number().min(0).optional(),
          broker: z.string().max(50).optional(),
          memo: z.string().max(1000).optional(),
          tradeDate: z.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const updateData: Record<string, unknown> = {};
        if (data.market) updateData.market = data.market;
        if (data.tradeType) updateData.tradeType = data.tradeType;
        if (data.ticker) updateData.ticker = data.ticker.toUpperCase();
        if (data.tickerName !== undefined) updateData.tickerName = data.tickerName;
        if (data.quantity !== undefined) updateData.quantity = String(data.quantity);
        if (data.price !== undefined) updateData.price = String(data.price);
        if (data.exchangeRate !== undefined) updateData.exchangeRate = String(data.exchangeRate);
        if (data.totalAmountKrw !== undefined) updateData.totalAmountKrw = String(data.totalAmountKrw);
        if (data.commission !== undefined) updateData.commission = String(data.commission);
        if (data.tax !== undefined) updateData.tax = String(data.tax);
        if (data.secFee !== undefined) updateData.secFee = String(data.secFee);
        if (data.broker !== undefined) updateData.broker = data.broker;
        if (data.memo !== undefined) updateData.memo = data.memo;
        if (data.tradeDate) updateData.tradeDate = data.tradeDate;
        await updateTrade(id, ctx.user.id, updateData as any);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteTrade(input.id, ctx.user.id);
        return { success: true };
      }),

    portfolioSummary: protectedProcedure
      .input(z.object({ market: z.enum(["us", "kr"]).optional() }))
      .query(async ({ ctx, input }) => {
        const summary = await getPortfolioSummary(ctx.user.id, input.market);
        return await enrichTickerNames(ctx.user.id, summary);
      }),

    monthlyPnL: protectedProcedure.query(async ({ ctx }) => {
      return await getMonthlyPnL(ctx.user.id);
    }),

    // CSV 가져오기
    importCsv: protectedProcedure
      .input(
        z.object({
          market: z.enum(["us", "kr"]),
          rows: z.array(
            z.object({
              tradeDate: z.string(),
              tradeType: z.enum(["buy", "sell"]),
              ticker: z.string(),
              tickerName: z.string().optional(),
              quantity: z.number(),
              price: z.number(),
              exchangeRate: z.number().optional(),
              totalAmountKrw: z.number(),
            })
          ),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const settings = await getUserSettings(ctx.user.id);
        const usRate = Number(settings?.usCommissionRate ?? 0.25);
        const krRate = Number(settings?.krCommissionRate ?? 0.015);
        const secRate = Number(settings?.secFeeRate ?? 0.0008);

        const tradeList = input.rows.map((row) => {
          const qty = row.quantity;
          const price = row.price;
          const exRate = row.exchangeRate ?? 1;
          const totalKrw = row.totalAmountKrw;
          const isSell = row.tradeType === "sell";
          const isUs = input.market === "us";

          let commission = 0;
          let tax = 0;
          let secFee = 0;

          if (isUs) {
            commission = (price * qty * exRate * usRate) / 100;
            if (isSell) {
              // 모든 거래 비용 필드는 원화로 저장한다. 미국 매도 SEC Fee도 환율을 적용한다.
              secFee = (price * qty * secRate * exRate) / 100;
            }
          } else {
            commission = (totalKrw * krRate) / 100;
            if (isSell) {
              tax = (totalKrw * 0.2) / 100;
            }
          }

          return {
            userId: ctx.user.id,
            market: input.market,
            tradeType: row.tradeType,
            ticker: row.ticker.toUpperCase(),
            tickerName: row.tickerName ?? null,
            quantity: String(qty),
            price: String(price),
            exchangeRate: String(exRate),
            totalAmountKrw: String(totalKrw),
            commission: String(commission),
            tax: String(tax),
            secFee: String(secFee),
            memo: null,
            tradeDate: new Date(row.tradeDate),
          };
        });

        await bulkInsertTrades(tradeList);
        return { success: true, count: tradeList.length };
      }),
  }),

  // ─── Settings ──────────────────────────────────────────────────────────────
  settings: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const s = await getUserSettings(ctx.user.id);
      return (
        s ?? {
          // 미국주식 증권사별
          commissionNH: "0.25",
          commissionMiraeasset: "0.25",
          commissionKiwoom: "0.25",
          commissionSamsung: "0.25",
          commissionHantu: "0.25",
          commissionKb: "0.25",
          commissionToss: "0.25",
          // 국내주식 증권사별
          commissionKrNH: "0.015",
          commissionKrMiraeasset: "0.015",
          commissionKrKiwoom: "0.015",
          commissionKrSamsung: "0.015",
          commissionKrHantu: "0.015",
          commissionKrKb: "0.015",
          commissionKrToss: "0.015",
          secFeeRate: "0.0008",
          // 하위호환
          usCommissionRate: "0.25",
          krCommissionRate: "0.015",
        }
      );
    }),

    update: protectedProcedure
      .input(
        z.object({
          // 미국주식
          commissionNH: z.number().min(0).max(10).optional(),
          commissionMiraeasset: z.number().min(0).max(10).optional(),
          commissionKiwoom: z.number().min(0).max(10).optional(),
          commissionSamsung: z.number().min(0).max(10).optional(),
          commissionHantu: z.number().min(0).max(10).optional(),
          commissionKb: z.number().min(0).max(10).optional(),
          commissionToss: z.number().min(0).max(10).optional(),
          // 국내주식
          commissionKrNH: z.number().min(0).max(10).optional(),
          commissionKrMiraeasset: z.number().min(0).max(10).optional(),
          commissionKrKiwoom: z.number().min(0).max(10).optional(),
          commissionKrSamsung: z.number().min(0).max(10).optional(),
          commissionKrHantu: z.number().min(0).max(10).optional(),
          commissionKrKb: z.number().min(0).max(10).optional(),
          commissionKrToss: z.number().min(0).max(10).optional(),
          secFeeRate: z.number().min(0).max(1).optional(),
          // 하위호환
          usCommissionRate: z.number().min(0).max(10).optional(),
          krCommissionRate: z.number().min(0).max(10).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const data: Record<string, string> = {};
        const fields = [
          "commissionNH","commissionMiraeasset","commissionKiwoom","commissionSamsung",
          "commissionHantu","commissionKb","commissionToss",
          "commissionKrNH","commissionKrMiraeasset","commissionKrKiwoom","commissionKrSamsung",
          "commissionKrHantu","commissionKrKb","commissionKrToss",
          "secFeeRate","usCommissionRate","krCommissionRate",
        ] as const;
        for (const f of fields) {
          if ((input as any)[f] !== undefined) data[f] = String((input as any)[f]);
        }
        await upsertUserSettings(ctx.user.id, data as any);
        return { success: true };
      }),
  }),

  // ─── Journal ───────────────────────────────────────────────────────────────
  journal: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return await getJournalEntries(ctx.user.id);
    }),

    create: protectedProcedure
      .input(
        z.object({
          entryDate: z.date(),
          title: z.string().max(200).optional(),
          content: z.string().min(1),
          tags: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await createJournalEntry({
          userId: ctx.user.id,
          entryDate: input.entryDate,
          title: input.title ?? null,
          content: input.content,
          tags: input.tags ?? null,
        });
        return { success: true };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().max(200).optional(),
          content: z.string().min(1).optional(),
          tags: z.string().max(500).optional(),
          entryDate: z.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updateJournalEntry(id, ctx.user.id, data as any);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteJournalEntry(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  // ─── Funds ─────────────────────────────────────────────────────────────────
  funds: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return await getFundRecords(ctx.user.id);
    }),

    create: protectedProcedure
      .input(
        z.object({
          fundType: z.enum(["debt", "extra_income", "regular"]),
          recordType: z.enum(["deposit", "withdrawal", "interest", "extra_visit", "extra_mobile", "extra_board"]),
          amount: z.number().positive(),
          description: z.string().max(500).optional(),
          recordDate: z.date(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await createFundRecord({
          userId: ctx.user.id,
          fundType: input.fundType,
          recordType: input.recordType,
          amount: String(input.amount),
          description: input.description ?? null,
          recordDate: input.recordDate,
        });
        return { success: true };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          fundType: z.enum(["debt", "extra_income", "regular"]).optional(),
          recordType: z.enum(["deposit", "withdrawal", "interest", "extra_visit", "extra_mobile", "extra_board"]).optional(),
          amount: z.number().positive().optional(),
          description: z.string().max(500).nullable().optional(),
          recordDate: z.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, amount, ...rest } = input;
        await updateFundRecord(id, ctx.user.id, {
          ...rest,
          ...(amount !== undefined ? { amount: String(amount) } : {}),
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteFundRecord(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  // ─── Dividends ─────────────────────────────────────────────────────────────
  dividends: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return await getDividends(ctx.user.id);
    }),

    create: protectedProcedure
      .input(
        z.object({
          market: z.enum(["us", "kr"]),
          ticker: z.string().min(1).max(20),
          tickerName: z.string().max(100).optional(),
          dividendDate: z.date(),
          amountUsd: z.number().positive().optional(),
          amountKrw: z.number().positive().optional(),
          taxWithheld: z.number().min(0).default(0),
          exchangeRate: z.number().positive().default(1),
          memo: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await createDividend({
          userId: ctx.user.id,
          market: input.market,
          ticker: input.ticker.toUpperCase(),
          tickerName: input.tickerName ?? null,
          dividendDate: input.dividendDate,
          amountUsd: input.amountUsd ? String(input.amountUsd) : null,
          amountKrw: input.amountKrw ? String(input.amountKrw) : null,
          taxWithheld: String(input.taxWithheld),
          exchangeRate: String(input.exchangeRate),
          memo: input.memo ?? null,
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteDividend(input.id, ctx.user.id);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
