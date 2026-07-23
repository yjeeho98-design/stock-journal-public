export type LedgerMarket = "us" | "kr";
export type LedgerTradeType = "buy" | "sell";

export interface LedgerTradeInput {
  id?: number;
  ticker: string;
  market: LedgerMarket;
  tickerName?: string | null;
  tradeType: LedgerTradeType;
  quantity: number | string;
  price: number | string;
  exchangeRate?: number | string | null;
  totalAmountKrw: number | string;
  commission?: number | string | null;
  tax?: number | string | null;
  secFee?: number | string | null;
  tradeDate: Date;
}

export interface LedgerSaleEvent {
  ticker: string;
  market: LedgerMarket;
  tradeDate: Date;
  grossProceedsKrw: number;
  sellCostsKrw: number;
  realizedCostKrw: number;
  realizedPnlKrw: number;
}

export interface LedgerTickerSummary {
  ticker: string;
  market: LedgerMarket;
  tickerName: string | null;
  holdingQty: number;
  holdingCostKrw: number;
  holdingCostUsd: number;
  totalBuyQty: number;
  totalSellQty: number;
  totalBuyAmountKrw: number;
  totalBuyCostKrw: number;
  totalSellAmountKrw: number;
  totalSellCostKrw: number;
  netSellProceedsKrw: number;
  totalBuyAmountUsd: number;
  totalCommission: number;
  totalTax: number;
  totalSecFeeKrw: number;
  realizedCostKrw: number;
  realizedPnlKrw: number;
  avgCostKrw: number;
  avgCostUsd: number;
}

export interface PortfolioLedger {
  summaries: LedgerTickerSummary[];
  saleEvents: LedgerSaleEvent[];
}

function numberValue(value: number | string | null | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 종목·시장별 거래를 날짜 순으로 재생해 이동평균 원가와 실현손익을 계산한다.
 * 매수 수수료는 보유 원가에 포함하고, 매도 수수료·세금·SEC Fee는 매도 순수령액에서 차감한다.
 */
export function calculatePortfolioLedger(trades: LedgerTradeInput[]): PortfolioLedger {
  const states = new Map<string, LedgerTickerSummary>();
  const saleEvents: LedgerSaleEvent[] = [];

  const orderedTrades = [...trades].sort((a, b) => {
    const dateDiff = a.tradeDate.getTime() - b.tradeDate.getTime();
    return dateDiff !== 0 ? dateDiff : (a.id ?? 0) - (b.id ?? 0);
  });

  for (const trade of orderedTrades) {
    const key = `${trade.market}__${trade.ticker}`;
    let state = states.get(key);
    if (!state) {
      state = {
        ticker: trade.ticker,
        market: trade.market,
        tickerName: trade.tickerName ?? null,
        holdingQty: 0,
        holdingCostKrw: 0,
        holdingCostUsd: 0,
        totalBuyQty: 0,
        totalSellQty: 0,
        totalBuyAmountKrw: 0,
        totalBuyCostKrw: 0,
        totalSellAmountKrw: 0,
        totalSellCostKrw: 0,
        netSellProceedsKrw: 0,
        totalBuyAmountUsd: 0,
        totalCommission: 0,
        totalTax: 0,
        totalSecFeeKrw: 0,
        realizedCostKrw: 0,
        realizedPnlKrw: 0,
        avgCostKrw: 0,
        avgCostUsd: 0,
      };
      states.set(key, state);
    }

    if (trade.tickerName) state.tickerName = trade.tickerName;

    const quantity = numberValue(trade.quantity);
    const price = numberValue(trade.price);
    const exchangeRate = numberValue(trade.exchangeRate, 1) || 1;
    const grossAmountKrw = numberValue(trade.totalAmountKrw);
    const commission = numberValue(trade.commission);
    const tax = numberValue(trade.tax);
    // 레거시 거래도 포함해 secFee는 모두 원화 비용으로 취급한다.
    const secFeeKrw = numberValue(trade.secFee);

    state.totalCommission += commission;
    state.totalTax += tax;
    state.totalSecFeeKrw += secFeeKrw;

    if (trade.tradeType === "buy") {
      const acquisitionCostKrw = grossAmountKrw + commission + tax + secFeeKrw;
      state.holdingQty += quantity;
      state.holdingCostKrw += acquisitionCostKrw;
      state.holdingCostUsd += trade.market === "us" ? quantity * price + commission / exchangeRate : 0;
      state.totalBuyQty += quantity;
      state.totalBuyAmountKrw += grossAmountKrw;
      state.totalBuyCostKrw += acquisitionCostKrw;
      state.totalBuyAmountUsd += trade.market === "us" ? quantity * price : 0;
    } else {
      const averageCostKrw = state.holdingQty > 0 ? state.holdingCostKrw / state.holdingQty : 0;
      const averageCostUsd = state.holdingQty > 0 ? state.holdingCostUsd / state.holdingQty : 0;
      const settledQuantity = Math.min(quantity, state.holdingQty);
      const realizedCostKrw = averageCostKrw * settledQuantity;
      const realizedCostUsd = averageCostUsd * settledQuantity;
      const sellCostsKrw = commission + tax + secFeeKrw;
      const netProceedsKrw = grossAmountKrw - sellCostsKrw;
      const realizedPnlKrw = netProceedsKrw - realizedCostKrw;

      state.holdingQty = Math.max(0, state.holdingQty - quantity);
      state.holdingCostKrw = Math.max(0, state.holdingCostKrw - realizedCostKrw);
      state.holdingCostUsd = Math.max(0, state.holdingCostUsd - realizedCostUsd);
      state.totalSellQty += quantity;
      state.totalSellAmountKrw += grossAmountKrw;
      state.totalSellCostKrw += sellCostsKrw;
      state.netSellProceedsKrw += netProceedsKrw;
      state.realizedCostKrw += realizedCostKrw;
      state.realizedPnlKrw += realizedPnlKrw;

      saleEvents.push({
        ticker: trade.ticker,
        market: trade.market,
        tradeDate: trade.tradeDate,
        grossProceedsKrw: grossAmountKrw,
        sellCostsKrw,
        realizedCostKrw,
        realizedPnlKrw,
      });
    }

    state.avgCostKrw = state.holdingQty > 0 ? state.holdingCostKrw / state.holdingQty : 0;
    state.avgCostUsd = state.holdingQty > 0 ? state.holdingCostUsd / state.holdingQty : 0;
  }

  return { summaries: Array.from(states.values()), saleEvents };
}
