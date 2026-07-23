import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatKrw,
  formatPercent,
  formatYearMonth,
  getChartColor,
  getPnlColorClass,
} from "@/lib/format";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Loader2, RefreshCw, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ─── 포트폴리오 계산 헬퍼 ────────────────────────────────────────────────────

interface TickerSummary {
  ticker: string;
  tickerName: string | null;
  market: "us" | "kr";
  buyQty: number;
  sellQty: number;
  holdingQty: number;
  totalBuyKrw: number;
  totalSellKrw: number;
  soldCostKrw: number;
  netSellProceedsKrw: number;
  avgCostKrw: number;
  avgCostUsd: number | null; // 미국주식일 때만 유효
  currentPriceKrw: number | null;
  currentValueKrw: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlRate: number | null;
  realizedPnl: number;
  realizedPnlRate: number | null;
  totalCommission: number;
  totalTax: number;
  weight: number;
}

function buildPortfolio(
  summaryRows: any[],
  prices: Record<string, number>
): {
  tickers: TickerSummary[];
  holdingTickers: TickerSummary[];
  totalInvested: number;
  totalCurrentValue: number;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  totalPnl: number;
  totalPnlRate: number;
} {
  const tickers: TickerSummary[] = summaryRows.map((row) => {
    const buyQty = Number(row.totalBuyQty ?? 0);
    const sellQty = Number(row.totalSellQty ?? 0);
    const holdingQty = Number(row.holdingQty ?? Math.max(0, buyQty - sellQty));
    // 매수 수수료가 포함된 실제 보유 원가를 투자 원금으로 사용한다.
    const totalBuyKrw = Number(row.totalBuyCostKrw ?? row.totalBuyAmountKrw ?? 0);
    const totalSellKrw = Number(row.totalSellAmountKrw ?? 0);
    const commission = Number(row.totalCommission ?? 0);
    const tax = Number(row.totalTax ?? 0);

    // 이동평균법으로 서버에서 계산된 평균단가 사용
    const avgCostKrw = Number(row.avgCostKrwMoving ?? 0);
    const avgCostUsd = (row.market === "us" && Number(row.avgCostUsdMoving ?? 0) > 0)
      ? Number(row.avgCostUsdMoving)
      : null;

    // 서버에서 거래 날짜 순으로 재생한 이동평균 원가·매도 비용 반영 결과를 그대로 사용한다.
    const soldCostKrw = Number(row.realizedCostKrw ?? 0);
    const netSellProceedsKrw = Number(row.netSellProceedsKrw ?? totalSellKrw);
    const realizedPnl = Number(row.realizedPnlKrw ?? 0);
    const realizedPnlRate = row.realizedPnlRate === null || row.realizedPnlRate === undefined
      ? null
      : Number(row.realizedPnlRate);

    const currentPriceKrw = prices[row.ticker] ?? null;
    const currentValueKrw = currentPriceKrw !== null ? currentPriceKrw * holdingQty : null;
    const unrealizedPnl =
      currentValueKrw !== null ? currentValueKrw - avgCostKrw * holdingQty : null;
    const unrealizedPnlRate =
      unrealizedPnl !== null && avgCostKrw * holdingQty > 0
        ? (unrealizedPnl / (avgCostKrw * holdingQty)) * 100
        : null;

    return {
      ticker: row.ticker,
      tickerName: row.tickerName,
      market: row.market,
      buyQty,
      sellQty,
      holdingQty,
      totalBuyKrw,
      totalSellKrw,
      avgCostKrw,
      avgCostUsd,
      currentPriceKrw,
      currentValueKrw,
      unrealizedPnl,
      unrealizedPnlRate,
      realizedPnl,
      realizedPnlRate,
      soldCostKrw,
      netSellProceedsKrw,
      totalCommission: commission,
      totalTax: tax,
      weight: 0,
    };
  });

  // 보유 중인 종목만으로 비중 계산
  const holdingTickers = tickers.filter((t) => t.holdingQty > 0);
  const totalCurrentValue = holdingTickers.reduce(
    (sum, t) => sum + (t.currentValueKrw ?? t.avgCostKrw * t.holdingQty),
    0
  );

  tickers.forEach((t) => {
    if (t.holdingQty > 0) {
      const value = t.currentValueKrw ?? t.avgCostKrw * t.holdingQty;
      t.weight = totalCurrentValue > 0 ? (value / totalCurrentValue) * 100 : 0;
    } else {
      t.weight = 0;
    }
  });

  const totalInvested = holdingTickers.reduce(
    (sum, t) => sum + t.avgCostKrw * t.holdingQty,
    0
  );
  const totalUnrealizedPnl = totalCurrentValue - totalInvested;
  const totalRealizedPnl = tickers.reduce((sum, t) => sum + t.realizedPnl, 0);
  const totalPnl = totalUnrealizedPnl + totalRealizedPnl;
  const totalPnlRate = totalInvested > 0 ? (totalUnrealizedPnl / totalInvested) * 100 : 0;

  return {
    tickers,
    holdingTickers: holdingTickers.sort((a, b) => b.weight - a.weight),
    totalInvested,
    totalCurrentValue,
    totalUnrealizedPnl,
    totalRealizedPnl,
    totalPnl,
    totalPnlRate,
  };
}

// ─── 커스텀 툴팁 ─────────────────────────────────────────────────────────────

const CustomPieTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-sm">
      <p className="font-semibold">{d.name}</p>
      <p className="text-muted-foreground">{formatKrw(d.value)}</p>
      <p className="text-primary">{d.payload.weight?.toFixed(1)}%</p>
    </div>
  );
};

const CustomBarTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value ?? 0;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-sm">
      <p className="font-semibold mb-1">{label}</p>
      <p className={getPnlColorClass(val)}>{formatKrw(val, true)}</p>
    </div>
  );
};

const CustomLineTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-sm">
      <p className="font-semibold mb-1">{formatYearMonth(label)}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {formatKrw(p.value, true)}
        </p>
      ))}
    </div>
  );
};

// ─── 요약 카드 ────────────────────────────────────────────────────────────────

function SummaryCard({
  title,
  value,
  sub,
  isPositive,
  icon: Icon,
}: {
  title: string;
  value: string;
  sub?: string;
  isPositive?: boolean | null;
  icon?: React.ElementType;
}) {
  return (
    <Card className="bg-card border-border/50 hover:border-border transition-colors">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">
              {title}
            </p>
            <p className="text-2xl font-bold font-mono tracking-tight truncate">{value}</p>
            {sub && (
              <p
                className={`text-sm mt-1 font-mono ${
                  isPositive === true
                    ? "text-profit"
                    : isPositive === false
                    ? "text-loss"
                    : "text-muted-foreground"
                }`}
              >
                {sub}
              </p>
            )}
          </div>
          {Icon && (
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 ml-3">
              <Icon className="w-5 h-5 text-primary" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── 메인 대시보드 ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<"us" | "kr">("us");
  const [priceEnabled, setPriceEnabled] = useState(true); // 페이지 진입 시 자동 활성화

  // 로그인 확인 후 쿼리 실행
  const { data: usSummary, isLoading: usLoading } = trpc.trades.portfolioSummary.useQuery(
    { market: "us" }, { enabled: isAuthenticated }
  );
  const { data: krSummary, isLoading: krLoading } = trpc.trades.portfolioSummary.useQuery(
    { market: "kr" }, { enabled: isAuthenticated }
  );
  const { data: monthlyData, isLoading: monthlyLoading } = trpc.trades.monthlyPnL.useQuery(
    undefined, { enabled: isAuthenticated }
  );

  // 보유 중인 미국주식 티커 목록 (정렬하여 안정적 해시 보장)
  const holdingUsTickers = useMemo(() => {
    return Array.from(new Set(
      (usSummary ?? [])
        .filter((r) => Number(r.totalBuyQty ?? 0) - Number(r.totalSellQty ?? 0) > 0)
        .map((r) => r.ticker)
    )).sort();
  }, [usSummary]);

  // 보유 중인 국내주식 티커 목록
  const holdingKrTickers = useMemo(() => {
    return Array.from(new Set(
      (krSummary ?? [])
        .filter((r) => Number(r.totalBuyQty ?? 0) - Number(r.totalSellQty ?? 0) > 0)
        .map((r) => r.ticker)
    )).sort();
  }, [krSummary]);

  // 미국주식 현재가 일괄 조회 - 5분마다 자동 갱신
  const { data: batchPrices, isFetching: usPricesFetching, refetch: refetchPrices } =
    trpc.market.batchUsPrice.useQuery(
      { tickers: holdingUsTickers },
      {
        enabled: isAuthenticated && priceEnabled && holdingUsTickers.length > 0,
        staleTime: 5 * 60 * 1000,
        refetchInterval: 5 * 60 * 1000,
        refetchIntervalInBackground: false,
        retry: 1,
      }
    );

  // 국내주식 현재가 일괄 조회 - 5분마다 자동 갱신
  const { data: batchKrPrices, isFetching: krPricesFetching, refetch: refetchKrPrices } =
    trpc.market.batchKrPrice.useQuery(
      { tickers: holdingKrTickers },
      {
        enabled: isAuthenticated && priceEnabled && holdingKrTickers.length > 0,
        staleTime: 5 * 60 * 1000,
        refetchInterval: 5 * 60 * 1000,
        refetchIntervalInBackground: false,
        retry: 1,
      }
    );

  // 환율 조회 - 5분마다 자동 갱신
  const { data: fxData, refetch: refetchFx } = trpc.market.exchangeRate.useQuery(
    undefined,
    {
      enabled: isAuthenticated && priceEnabled,
      staleTime: 5 * 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
      refetchIntervalInBackground: false,
      retry: 1,
    }
  );

  const pricesFetching = usPricesFetching || krPricesFetching;

  const handleRefreshPrices = () => {
    refetchPrices();
    refetchKrPrices();
    refetchFx();
  };

  // USD 현재가 → KRW 변환 맵 (미국주식)
  const priceMapKrw = useMemo(() => {
    if (!batchPrices?.prices || !fxData?.rate) return {};
    const rate = fxData.rate;
    const map: Record<string, number> = {};
    for (const [ticker, usdPrice] of Object.entries(batchPrices.prices)) {
      map[ticker] = usdPrice * rate;
    }
    return map;
  }, [batchPrices, fxData]);

  // 국내주식 현재가 맵 (이미 KRW)
  const krPriceMapKrw = useMemo(() => {
    return batchKrPrices?.prices ?? {};
  }, [batchKrPrices]);

  const isLoading = usLoading || krLoading || monthlyLoading;

  const usPortfolio = useMemo(() => buildPortfolio(usSummary ?? [], priceMapKrw), [usSummary, priceMapKrw]);
  const krPortfolio = useMemo(() => buildPortfolio(krSummary ?? [], krPriceMapKrw), [krSummary, krPriceMapKrw]);

  const currentPortfolio = activeTab === "us" ? usPortfolio : krPortfolio;

  // 도넛 차트 - 보유 중인 종목 전체
  const pieData = useMemo(
    () =>
      currentPortfolio.holdingTickers.map((t, i) => ({
        name: t.ticker,
        value: t.currentValueKrw ?? t.avgCostKrw * t.holdingQty,
        weight: t.weight,
        color: getChartColor(i),
      })),
    [currentPortfolio]
  );

  // 막대 차트 - 보유 종목 전체 (투자금액 기준 정렬, 최대 20개)
  const barData = useMemo(
    () =>
      currentPortfolio.holdingTickers
        .slice(0, 20)
        .map((t) => ({
          ticker: t.ticker,
          pnl: t.unrealizedPnl ?? 0,
        })),
    [currentPortfolio]
  );

  // 월별 손익 라인 차트
  const lineData = useMemo(() => {
    if (!monthlyData) return [];
    const byMonth: Record<string, { us: number; kr: number }> = {};
    for (const row of monthlyData) {
      const ym = row.yearMonth;
      if (!byMonth[ym]) byMonth[ym] = { us: 0, kr: 0 };
      const realizedPnl = Number(row.realizedPnlKrw ?? 0);
      if (row.market === "us") byMonth[ym].us += realizedPnl;
      else byMonth[ym].kr += realizedPnl;
    }
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, v]) => ({
        month: ym,
        미국주식: Math.round(v.us),
        국내주식: Math.round(v.kr),
        합계: Math.round(v.us + v.kr),
      }));
  }, [monthlyData]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-80 rounded-xl" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const hasData = currentPortfolio.holdingTickers.length > 0 || currentPortfolio.tickers.length > 0;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-[1400px]">
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">포트폴리오 대시보드</h1>
            <p className="text-sm text-muted-foreground mt-1">
              미국주식(NH투자증권) + 국내주식(미래에셋증권)
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end gap-0.5">
              {(batchPrices?.fetchedAt || batchKrPrices?.fetchedAt) && (
                <p className="text-xs text-muted-foreground">
                  마지막 갱신: {new Date((batchPrices?.fetchedAt ?? batchKrPrices?.fetchedAt)!).toLocaleTimeString("ko-KR")}
                  {fxData?.rate && <span className="ml-2">· 환율 {fxData.rate.toFixed(2)}원</span>}
                </p>
              )}
              {!batchPrices && !batchKrPrices && !pricesFetching && (
                <p className="text-xs text-muted-foreground">시세 로딩 중...</p>
              )}
              {pricesFetching && (
                <p className="text-xs text-primary">시세 업데이트 중...</p>
              )}
            </div>
            <button
              onClick={handleRefreshPrices}
              disabled={pricesFetching}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {pricesFetching
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
              {pricesFetching ? "갱신 중..." : "수동 갱신"}
            </button>
          </div>
        </div>

        {/* 탭 */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList className="bg-card border border-border/50">
            <TabsTrigger value="us">미국주식</TabsTrigger>
            <TabsTrigger value="kr">국내주식</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-6 space-y-6">
            {/* 요약 카드 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <SummaryCard
                title="투자 원금"
                value={formatKrw(currentPortfolio.totalInvested)}
              />
              <SummaryCard
                title="평가 손익"
                value={formatKrw(currentPortfolio.totalUnrealizedPnl, true)}
                sub={formatPercent(currentPortfolio.totalPnlRate, true)}
                isPositive={currentPortfolio.totalUnrealizedPnl > 0 ? true : currentPortfolio.totalUnrealizedPnl < 0 ? false : null}
                icon={currentPortfolio.totalUnrealizedPnl >= 0 ? TrendingUp : TrendingDown}
              />
              <SummaryCard
                title="총 평가금액"
                value={formatKrw(currentPortfolio.totalCurrentValue)}
                icon={Wallet}
              />
            </div>

            {!hasData ? (
              <Card className="bg-card border-border/50">
                <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                    <TrendingUp className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-lg">거래 내역이 없습니다</p>
                    <p className="text-muted-foreground text-sm mt-1">
                      매매일지에서 첫 거래를 입력해 보세요.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* 차트 행 1: 도넛 + 막대 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 종목 비중 도넛 차트 */}
                  <Card className="bg-card border-border/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base font-semibold">
                        종목 비중
                        <span className="text-xs text-muted-foreground font-normal ml-2">
                          (보유 {currentPortfolio.holdingTickers.length}종목)
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-col lg:flex-row items-center gap-4">
                        <div className="w-full lg:w-56 h-56 shrink-0">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={pieData}
                                cx="50%"
                                cy="50%"
                                innerRadius="55%"
                                outerRadius="80%"
                                paddingAngle={1}
                                dataKey="value"
                              >
                                {pieData.map((entry, index) => (
                                  <Cell key={`pie-${entry.name}-${index}`} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip content={<CustomPieTooltip />} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        {/* 범례 - 상위 10개 + 나머지 합산 */}
                        <div className="flex-1 space-y-1.5 w-full overflow-y-auto max-h-56">
                          {pieData.slice(0, 10).map((entry, i) => (
                            <div key={`legend-${entry.name}-${i}`} className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <div
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: entry.color }}
                                />
                                <span className="text-sm font-medium truncate">{entry.name}</span>
                              </div>
                              <span className="text-sm text-muted-foreground font-mono shrink-0">
                                {entry.weight.toFixed(1)}%
                              </span>
                            </div>
                          ))}
                          {pieData.length > 10 && (
                            <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/30">
                              <span className="text-xs text-muted-foreground">
                                외 {pieData.length - 10}개 종목
                              </span>
                              <span className="text-xs text-muted-foreground font-mono">
                                {pieData.slice(10).reduce((s, e) => s + e.weight, 0).toFixed(1)}%
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* 종목별 손익 막대 차트 (상위 20개) */}
                  <Card className="bg-card border-border/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base font-semibold">
                        종목별 평가 손익
                        <span className="text-xs text-muted-foreground font-normal ml-2">
                          (상위 {barData.length}종목)
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={barData} margin={{ top: 4, right: 8, left: 8, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.015 240)" vertical={false} />
                            <XAxis
                              dataKey="ticker"
                              tick={{ fill: "oklch(0.60 0.015 240)", fontSize: 10 }}
                              axisLine={false}
                              tickLine={false}
                              angle={-35}
                              textAnchor="end"
                            />
                            <YAxis
                              tick={{ fill: "oklch(0.60 0.015 240)", fontSize: 10 }}
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`}
                              width={50}
                            />
                            <Tooltip content={<CustomBarTooltip />} />
                            <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                              {barData.map((entry, index) => (
                                <Cell
                                  key={`bar-${entry.ticker}-${index}`}
                                  fill={entry.pnl >= 0 ? "oklch(0.68 0.18 145)" : "oklch(0.62 0.22 25)"}
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* 월별 누적 손익 라인 차트 */}
                {lineData.length > 0 && (
                  <Card className="bg-card border-border/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base font-semibold">월별 실현 손익 추이</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={lineData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.015 240)" vertical={false} />
                            <XAxis
                              dataKey="month"
                              tick={{ fill: "oklch(0.60 0.015 240)", fontSize: 11 }}
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(v) => v.slice(5)}
                            />
                            <YAxis
                              tick={{ fill: "oklch(0.60 0.015 240)", fontSize: 10 }}
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`}
                              width={55}
                            />
                            <Tooltip content={<CustomLineTooltip />} />
                            <Legend wrapperStyle={{ fontSize: 12, color: "oklch(0.60 0.015 240)" }} />
                            <Line type="monotone" dataKey="미국주식" stroke="oklch(0.65 0.18 240)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                            <Line type="monotone" dataKey="국내주식" stroke="oklch(0.70 0.15 160)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                            <Line type="monotone" dataKey="합계" stroke="oklch(0.72 0.16 60)" strokeWidth={2.5} strokeDasharray="5 3" dot={false} activeDot={{ r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* ── 보유 종목 현황 (전체) ── */}
                <Card className="bg-card border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold">
                      보유 종목 현황
                      <span className="text-xs text-muted-foreground font-normal ml-2">
                        ({currentPortfolio.holdingTickers.length}종목)
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/50">
                            <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">종목</th>
                            <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">매수수량</th>
                            <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">매도수량</th>
                            <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">보유수량</th>
                            <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">평균단가</th>
                            <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">현재가($)</th>
                            <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">평가금액</th>
                            <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">평가손익</th>
                            <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">비중</th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentPortfolio.holdingTickers.map((t, i) => (
                            <tr
                              key={`${t.ticker}-${t.market}`}
                              className="border-b border-border/30 hover:bg-accent/20 transition-colors"
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{ backgroundColor: getChartColor(i) }}
                                  />
                                  <div>
                                    <p className="font-semibold">{t.ticker}</p>
                                    {t.tickerName && (
                                      <p className="text-xs text-muted-foreground truncate max-w-32">{t.tickerName}</p>
                                    )}
                                  </div>
                                  <Badge variant="outline" className="text-xs px-1.5 py-0 border-border/50">
                                    {t.market === "us" ? "미국" : "국내"}
                                  </Badge>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                                {t.buyQty.toLocaleString()}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                                {t.sellQty > 0 ? t.sellQty.toLocaleString() : "—"}
                              </td>
                              <td className="px-4 py-3 text-right font-mono font-semibold">
                                {t.holdingQty.toLocaleString()}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                                <p>{formatKrw(t.avgCostKrw)}</p>
                                {t.avgCostUsd !== null && (
                                  <p className="text-xs text-muted-foreground/70">${t.avgCostUsd.toFixed(2)}</p>
                                )}
                              </td>
                              {/* 현재가($) 컬럼 - 미국주식만 표시, 시세 갱신 시 실시간 반영 */}
                              <td className="px-4 py-3 text-right font-mono">
                                {t.market === "us" ? (
                                  batchPrices?.prices[t.ticker] ? (
                                    <div>
                                      <p className="font-semibold text-foreground">
                                        ${batchPrices.prices[t.ticker].toFixed(2)}
                                      </p>
                                      {t.avgCostUsd !== null && (
                                        <p className={`text-xs ${
                                          batchPrices.prices[t.ticker] >= t.avgCostUsd
                                            ? "text-profit"
                                            : "text-loss"
                                        }`}>
                                          {batchPrices.prices[t.ticker] >= t.avgCostUsd ? "+" : ""}
                                          {((batchPrices.prices[t.ticker] - t.avgCostUsd) / t.avgCostUsd * 100).toFixed(2)}%
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">
                                      {pricesFetching ? "조회 중..." : "—"}
                                    </span>
                                  )
                                ) : (
                                  // 국내주식: 원화 현재가
                                  batchKrPrices?.prices[t.ticker] ? (
                                    <div>
                                      <p className="font-semibold text-foreground">
                                        {formatKrw(batchKrPrices.prices[t.ticker])}
                                      </p>
                                      {t.avgCostKrw > 0 && (
                                        <p className={`text-xs ${
                                          batchKrPrices.prices[t.ticker] >= t.avgCostKrw
                                            ? "text-profit"
                                            : "text-loss"
                                        }`}>
                                          {batchKrPrices.prices[t.ticker] >= t.avgCostKrw ? "+" : ""}
                                          {((batchKrPrices.prices[t.ticker] - t.avgCostKrw) / t.avgCostKrw * 100).toFixed(2)}%
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">
                                      {krPricesFetching ? "조회 중..." : "—"}
                                    </span>
                                  )
                                )}
                              </td>
                              <td className="px-4 py-3 text-right font-mono">
                                {formatKrw(t.currentValueKrw ?? t.avgCostKrw * t.holdingQty)}
                              </td>
                              <td className="px-4 py-3 text-right font-mono">
                                <div className={getPnlColorClass(t.unrealizedPnl ?? 0)}>
                                  <p>{formatKrw(t.unrealizedPnl ?? 0, true)}</p>
                                  {t.unrealizedPnlRate !== null && (
                                    <p className="text-xs">{formatPercent(t.unrealizedPnlRate, true)}</p>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                                {t.weight.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                {/* ── 전체 종목 손익 정산 (청산 포함) ── */}
                {currentPortfolio.tickers.some((t) => t.sellQty > 0) && (
                  <Card className="bg-card border-border/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base font-semibold">
                        전체 종목 손익 정산
                        <span className="text-xs text-muted-foreground font-normal ml-2">
                          (청산 종목 포함 {currentPortfolio.tickers.length}종목)
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border/50">
                              <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">종목</th>
                              <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">매수수량</th>
                              <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">매도수량</th>
                              <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">보유수량</th>
                              <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">매수 총액</th>
                              <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">매도 총액</th>
                              <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">실현 손익</th>
                              <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">수익률</th>
                              <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">상태</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentPortfolio.tickers
                              .sort((a, b) => b.totalBuyKrw - a.totalBuyKrw)
                              .map((t, i) => (
                                <tr
                                  key={`all-${t.ticker}-${t.market}`}
                                  className="border-b border-border/30 hover:bg-accent/20 transition-colors"
                                >
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                      <p className="font-semibold">{t.ticker}</p>
                                      <Badge variant="outline" className="text-xs px-1.5 py-0 border-border/50">
                                        {t.market === "us" ? "미국" : "국내"}
                                      </Badge>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                                    {t.buyQty.toLocaleString()}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                                    {t.sellQty > 0 ? t.sellQty.toLocaleString() : "—"}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono font-semibold">
                                    {t.holdingQty > 0 ? t.holdingQty.toLocaleString() : "청산"}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                                    {formatKrw(t.totalBuyKrw)}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                                    {t.totalSellKrw > 0 ? formatKrw(t.totalSellKrw) : "—"}
                                  </td>
                                  <td className={`px-4 py-3 text-right font-mono font-semibold ${getPnlColorClass(t.realizedPnl)}`}>
                                    {t.sellQty > 0 ? formatKrw(t.realizedPnl, true) : "—"}
                                  </td>
                                  <td className={`px-4 py-3 text-right font-mono text-sm ${t.realizedPnlRate !== null ? getPnlColorClass(t.realizedPnl) : "text-muted-foreground"}`}>
                                    {t.sellQty > 0 && t.realizedPnlRate !== null
                                      ? formatPercent(t.realizedPnlRate, true)
                                      : "—"}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <Badge
                                      variant="outline"
                                      className={`text-xs px-2 py-0.5 ${
                                        t.holdingQty > 0
                                          ? "border-profit/40 text-profit"
                                          : "border-muted text-muted-foreground"
                                      }`}
                                    >
                                      {t.holdingQty > 0 ? "보유중" : "청산"}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
