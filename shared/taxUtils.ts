// ─── 세금 및 수수료 계산 유틸리티 ─────────────────────────────────────────────

export interface CommissionSettings {
  usCommissionRate: number; // % (e.g. 0.25)
  krCommissionRate: number; // % (e.g. 0.015)
  secFeeRate: number; // % (e.g. 0.0008)
}

export const DEFAULT_SETTINGS: CommissionSettings = {
  usCommissionRate: 0.25,
  krCommissionRate: 0.015,
  secFeeRate: 0.0008,
};

// 미국주식 매수 수수료 (원화)
export function calcUsCommission(
  totalUsd: number,
  exchangeRate: number,
  commissionRate: number
): number {
  return totalUsd * exchangeRate * (commissionRate / 100);
}

// 미국주식 매도 수수료 + SEC Fee (원화)
export function calcUsSellCost(
  totalUsd: number,
  exchangeRate: number,
  commissionRate: number,
  secFeeRate: number
): { commission: number; secFeeUsd: number; secFeeKrw: number; total: number } {
  const commission = totalUsd * exchangeRate * (commissionRate / 100);
  const secFeeUsd = totalUsd * (secFeeRate / 100);
  const secFeeKrw = secFeeUsd * exchangeRate;
  return { commission, secFeeUsd, secFeeKrw, total: commission + secFeeKrw };
}

// 국내주식 매수 수수료 (원화)
export function calcKrCommission(totalKrw: number, commissionRate: number): number {
  return totalKrw * (commissionRate / 100);
}

// 국내주식 매도 수수료 + 증권거래세 (원화)
export function calcKrSellCost(
  totalKrw: number,
  commissionRate: number,
  transactionTaxRate = 0.2 // 0.20%
): { commission: number; transactionTax: number; total: number } {
  const commission = totalKrw * (commissionRate / 100);
  const transactionTax = totalKrw * (transactionTaxRate / 100);
  return { commission, transactionTax, total: commission + transactionTax };
}

// 미국주식 배당소득세 (원천징수 15%)
export function calcUsDividendTax(grossAmountUsd: number): number {
  return grossAmountUsd * 0.15;
}

// 국내주식 배당소득세 (원천징수 15.4%)
export function calcKrDividendTax(grossAmountKrw: number): number {
  return grossAmountKrw * 0.154;
}

// 해외주식 양도소득세 계산
// (연간 양도차익 합계 - 필요경비 - 기본공제 250만원) × 22%
export function calcCapitalGainsTax(
  totalGainKrw: number, // 연간 실현 양도차익 합계 (원화)
  totalCostKrw: number = 0 // 필요경비 (수수료 등)
): {
  taxableGain: number;
  basicDeduction: number;
  taxBase: number;
  estimatedTax: number;
} {
  const basicDeduction = 2_500_000; // 250만원
  const netGain = totalGainKrw - totalCostKrw;
  const taxBase = Math.max(0, netGain - basicDeduction);
  const estimatedTax = taxBase * 0.22;
  return { taxableGain: netGain, basicDeduction, taxBase, estimatedTax };
}

// 종목별 평균 매수단가 계산 (선입선출 기준)
export interface TradeRecord {
  tradeType: "buy" | "sell";
  quantity: number;
  price: number;
  exchangeRate: number;
}

export function calcAverageCostKrw(buyTrades: TradeRecord[]): number {
  const totalQty = buyTrades.reduce((sum, t) => sum + t.quantity, 0);
  if (totalQty === 0) return 0;
  const totalCost = buyTrades.reduce(
    (sum, t) => sum + t.quantity * t.price * t.exchangeRate,
    0
  );
  return totalCost / totalQty;
}

// 실현 손익 계산
export function calcRealizedPnL(
  sellAmountKrw: number,
  avgCostKrw: number,
  sellQty: number,
  sellCost: number // 수수료 + 세금
): number {
  const costBasis = avgCostKrw * sellQty;
  return sellAmountKrw - costBasis - sellCost;
}

// 미실현 손익 계산
export function calcUnrealizedPnL(
  currentPriceKrw: number,
  avgCostKrw: number,
  holdingQty: number
): { pnl: number; pnlRate: number } {
  const currentValue = currentPriceKrw * holdingQty;
  const costBasis = avgCostKrw * holdingQty;
  const pnl = currentValue - costBasis;
  const pnlRate = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
  return { pnl, pnlRate };
}
