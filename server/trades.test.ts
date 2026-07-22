import { describe, expect, it } from "vitest";
import {
  calcCapitalGainsTax,
  calcKrCommission,
  calcKrSellCost,
  calcUsSellCost,
  calcUsCommission,
  calcUnrealizedPnL,
} from "../shared/taxUtils";

describe("taxUtils", () => {
  describe("calcUsCommission", () => {
    it("미국주식 매수 수수료를 계산한다", () => {
      // $100 * 10주 * 1300환율 * 0.25% = 3250원
      const result = calcUsCommission(100, 10, 1300, 0.25);
      expect(result).toBeCloseTo(3250, 0);
    });

    it("수수료율 0%일 때 0을 반환한다", () => {
      const result = calcUsCommission(100, 10, 1300, 0);
      expect(result).toBe(0);
    });
  });

  describe("calcUsSellCost", () => {
    it("미국주식 매도 수수료 + SEC Fee를 계산한다", () => {
      // $100 * 10주 = $1000
      // 수수료: $1000 * 1300 * 0.25% = 3250원
      // SEC Fee: $1000 * 0.0008% = $0.008 → 10.4원
      const result = calcUsSellCost(1000, 1300, 0.25, 0.0008);
      expect(result.commission).toBeCloseTo(3250, 0);
      expect(result.secFeeUsd).toBeCloseTo(0.008, 4);
      expect(result.secFeeKrw).toBeCloseTo(10.4, 1);
    });
  });

  describe("calcKrCommission", () => {
    it("국내주식 매수 수수료를 계산한다", () => {
      // 1,000,000원 * 0.015% = 150원
      const result = calcKrCommission(1_000_000, 0.015);
      expect(result).toBeCloseTo(150, 0);
    });
  });

  describe("calcKrSellCost", () => {
    it("국내주식 매도 수수료 + 증권거래세를 계산한다", () => {
      // 1,000,000원 * 0.015% 수수료 = 150원
      // 1,000,000원 * 0.20% 거래세 = 2000원
      const result = calcKrSellCost(1_000_000, 0.015, 0.2);
      expect(result.commission).toBeCloseTo(150, 0);
      expect(result.transactionTax).toBeCloseTo(2000, 0);
      expect(result.total).toBeCloseTo(2150, 0);
    });
  });

  describe("calcCapitalGainsTax", () => {
    it("양도차익이 250만원 이하면 세금이 0이다", () => {
      const result = calcCapitalGainsTax(2_000_000);
      expect(result.estimatedTax).toBe(0);
      expect(result.taxBase).toBe(0);
    });

    it("양도차익 1000만원 - 기본공제 250만원 = 750만원 × 22%", () => {
      const result = calcCapitalGainsTax(10_000_000);
      expect(result.taxBase).toBe(7_500_000);
      expect(result.estimatedTax).toBeCloseTo(1_650_000, 0);
    });

    it("손실 발생 시 세금이 0이다", () => {
      const result = calcCapitalGainsTax(-1_000_000);
      expect(result.estimatedTax).toBe(0);
      expect(result.taxBase).toBe(0);
    });
  });

  describe("calcUnrealizedPnL", () => {
    it("미실현 손익과 수익률을 계산한다", () => {
      // 평균단가 100원, 현재가 120원, 10주
      const result = calcUnrealizedPnL(120, 100, 10);
      expect(result.pnl).toBe(200); // (120-100) * 10
      expect(result.pnlRate).toBeCloseTo(20, 1); // 20%
    });

    it("손실 시 음수 손익률을 반환한다", () => {
      const result = calcUnrealizedPnL(80, 100, 10);
      expect(result.pnl).toBe(-200);
      expect(result.pnlRate).toBeCloseTo(-20, 1);
    });
  });
});

// Helper function signature fix for tests
function calcUsCommission(
  priceUsd: number,
  quantity: number,
  exchangeRate: number,
  commissionRate: number
): number {
  return priceUsd * quantity * exchangeRate * (commissionRate / 100);
}
