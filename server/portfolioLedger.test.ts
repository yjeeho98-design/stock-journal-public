import { describe, expect, it } from "vitest";
import { calculatePortfolioLedger } from "../shared/portfolioLedger";

describe("calculatePortfolioLedger", () => {
  it("매수 수수료를 원가에 포함하고 매도 비용을 순수령액에서 차감한다", () => {
    const { summaries } = calculatePortfolioLedger([
      {
        id: 1,
        ticker: "TSM",
        market: "us",
        tickerName: "Taiwan Semiconductor Manufacturing Company Limited",
        tradeType: "buy",
        quantity: 10,
        price: 100,
        exchangeRate: 1_000,
        totalAmountKrw: 1_000_000,
        commission: 2_500,
        tradeDate: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: 2,
        ticker: "TSM",
        market: "us",
        tradeType: "sell",
        quantity: 4,
        price: 120,
        exchangeRate: 1_000,
        totalAmountKrw: 480_000,
        commission: 1_200,
        secFee: 4,
        tradeDate: new Date("2026-02-01T00:00:00.000Z"),
      },
    ]);

    const tsm = summaries[0]!;
    expect(tsm.holdingQty).toBe(6);
    expect(tsm.holdingCostKrw).toBeCloseTo(601_500, 6);
    expect(tsm.realizedCostKrw).toBeCloseTo(401_000, 6);
    expect(tsm.totalSellCostKrw).toBeCloseTo(1_204, 6);
    expect(tsm.realizedPnlKrw).toBeCloseTo(77_796, 6);
  });

  it("매도 이후 재매수한 종목은 각 매도 시점의 이동평균 원가로 정산한다", () => {
    const { summaries } = calculatePortfolioLedger([
      {
        id: 1, ticker: "TSM", market: "us", tradeType: "buy", quantity: 10, price: 100,
        exchangeRate: 1, totalAmountKrw: 1_000, tradeDate: new Date("2024-01-01T00:00:00.000Z"),
      },
      {
        id: 2, ticker: "TSM", market: "us", tradeType: "sell", quantity: 10, price: 130,
        exchangeRate: 1, totalAmountKrw: 1_300, tradeDate: new Date("2024-02-01T00:00:00.000Z"),
      },
      {
        id: 3, ticker: "TSM", market: "us", tradeType: "buy", quantity: 1, price: 400,
        exchangeRate: 1, totalAmountKrw: 400, tradeDate: new Date("2025-01-01T00:00:00.000Z"),
      },
      {
        id: 4, ticker: "TSM", market: "us", tradeType: "sell", quantity: 1, price: 420,
        exchangeRate: 1, totalAmountKrw: 420, tradeDate: new Date("2025-02-01T00:00:00.000Z"),
      },
    ]);

    const tsm = summaries[0]!;
    expect(tsm.holdingQty).toBe(0);
    expect(tsm.realizedCostKrw).toBe(1_400);
    expect(tsm.realizedPnlKrw).toBe(320);
  });
});
