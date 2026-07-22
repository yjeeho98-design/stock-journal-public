import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatKrw, getPnlColorClass } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";

const BASIC_DEDUCTION = 2_500_000; // 250만원
const CGT_RATE = 0.22;             // 22%

// ─── 이동평균법으로 연도별 실현 손익 계산 ────────────────────────────────────
// trades: 전체 미국주식 거래 내역 (날짜 오름차순 정렬된 상태)
// targetYear: 계산할 연도
function calcYearlyRealizedGain(
  trades: Array<{
    ticker: string;
    tradeType: string;
    quantity: string | number;
    price: string | number;
    totalAmountKrw: string | number;
      commission: string | number | null;
      tax: string | number | null;
    tradeDate: string | Date;
  }>,
  targetYear: number
) {
  // 종목별 보유 상태 (이동평균법)
  const holdingMap: Record<string, { qty: number; costKrw: number }> = {};

  type SellRecord = {
    ticker: string;
    date: string;
    qty: number;
    sellKrw: number;
    costBasisKrw: number;
    commission: number;
    secFee: number;
    pnl: number;
  };

  const yearSells: SellRecord[] = [];

  // 전체 거래를 날짜순으로 순회
  for (const t of trades) {
    const qty = Number(t.quantity);
    const amtKrw = Number(t.totalAmountKrw);
    const ticker = t.ticker;
    const year = new Date(t.tradeDate).getFullYear();

    if (!holdingMap[ticker]) holdingMap[ticker] = { qty: 0, costKrw: 0 };
    const h = holdingMap[ticker];

    if (t.tradeType === "buy") {
      // 매수: 이동평균 원가에 추가
      h.costKrw += amtKrw;
      h.qty += qty;
    } else {
      // 매도: 현재 이동평균 단가 기준으로 원가 차감
      const avgCostPerShare = h.qty > 0 ? h.costKrw / h.qty : 0;
      const costBasis = avgCostPerShare * qty;
      const commission = Number(t.commission ?? 0);
      const secFee = Number(t.tax ?? 0); // US: tax 컬럼에 SEC fee 저장됨
      const pnl = amtKrw - costBasis - commission - secFee;

      // 보유 원가 차감
      h.costKrw -= costBasis;
      h.qty -= qty;
      if (h.qty <= 0) { h.qty = 0; h.costKrw = 0; }

      // 해당 연도 매도만 집계
      if (year === targetYear) {
        yearSells.push({
          ticker,
          date: new Date(t.tradeDate).toLocaleDateString("ko-KR"),
          qty,
          sellKrw: amtKrw,
          costBasisKrw: costBasis,
          commission,
          secFee,
          pnl,
        });
      }
    }
  }

  const totalGain = yearSells.reduce((s, r) => s + r.pnl, 0);
  const taxBase = Math.max(0, totalGain - BASIC_DEDUCTION);
  const estimatedTax = taxBase * CGT_RATE;
  const deductionUsed = Math.min(BASIC_DEDUCTION, Math.max(0, totalGain));
  const remainingDeduction = Math.max(0, BASIC_DEDUCTION - totalGain);

  return { yearSells, totalGain, taxBase, estimatedTax, deductionUsed, remainingDeduction };
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function TaxCalculator() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const { data: usTrades } = trpc.trades.list.useQuery({ market: "us" });
  const { data: krTrades } = trpc.trades.list.useQuery({ market: "kr" });
  const { data: dividends } = trpc.dividends.list.useQuery();

  // 데이터가 있는 연도 목록 추출
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    years.add(currentYear);
    (usTrades ?? []).forEach((t) => years.add(new Date(t.tradeDate).getFullYear()));
    (krTrades ?? []).forEach((t) => years.add(new Date(t.tradeDate).getFullYear()));
    return Array.from(years).sort((a, b) => b - a); // 최신 연도 먼저
  }, [usTrades, krTrades, currentYear]);

  // 선택 연도 미국주식 양도소득세 계산 (이동평균법)
  const cgtCalc = useMemo(() => {
    if (!usTrades) return null;
    // 날짜 오름차순 정렬 (이동평균법은 순서가 중요)
    const sorted = [...usTrades].sort(
      (a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime()
    );
    return calcYearlyRealizedGain(sorted, selectedYear);
  }, [usTrades, selectedYear]);

  // 선택 연도 국내주식 거래세 합계 + 이동평균법 실현손익
  const krTaxCalc = useMemo(() => {
    if (!krTrades) return { yearSells: [], total: 0, sellAmount: 0, totalRealizedPnl: 0 };

    // 이동평균법으로 실현손익 계산
    const holdingMap: Record<string, { qty: number; costKrw: number }> = {};
    type KrSellRecord = {
      ticker: string;
      tickerName: string | null;
      date: string;
      qty: number;
      sellKrw: number;
      costBasisKrw: number;
      commission: number;
      transactionTax: number;
      pnl: number;
    };
    const yearSellRecords: KrSellRecord[] = [];

    const sorted = [...krTrades].sort(
      (a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime()
    );

    for (const t of sorted) {
      const qty = Number(t.quantity);
      const amtKrw = Number(t.totalAmountKrw);
      const ticker = t.ticker;
      const year = new Date(t.tradeDate).getFullYear();

      if (!holdingMap[ticker]) holdingMap[ticker] = { qty: 0, costKrw: 0 };
      const h = holdingMap[ticker];

      if (t.tradeType === "buy") {
        h.costKrw += amtKrw;
        h.qty += qty;
      } else {
        const avgCostPerShare = h.qty > 0 ? h.costKrw / h.qty : 0;
        const costBasis = avgCostPerShare * qty;
        const commission = Number(t.commission ?? 0);
        const transactionTax = Number(t.tax ?? 0);
        const pnl = amtKrw - costBasis - commission - transactionTax;

        h.costKrw -= costBasis;
        h.qty -= qty;
        if (h.qty <= 0) { h.qty = 0; h.costKrw = 0; }

        if (year === selectedYear) {
          yearSellRecords.push({
            ticker,
            tickerName: t.tickerName ?? null,
            date: new Date(t.tradeDate).toLocaleDateString("ko-KR"),
            qty,
            sellKrw: amtKrw,
            costBasisKrw: costBasis,
            commission,
            transactionTax,
            pnl,
          });
        }
      }
    }

    const total = yearSellRecords.reduce((s, r) => s + r.transactionTax, 0);
    const sellAmount = yearSellRecords.reduce((s, r) => s + r.sellKrw, 0);
    const totalRealizedPnl = yearSellRecords.reduce((s, r) => s + r.pnl, 0);

    return { yearSells: yearSellRecords, total, sellAmount, totalRealizedPnl };
  }, [krTrades, selectedYear]);

  const krTransactionTax = { total: krTaxCalc.total, sellAmount: krTaxCalc.sellAmount };

  // 선택 연도 배당소득세
  const dividendTax = useMemo(() => {
    if (!dividends) return { usTax: 0, krTax: 0 };
    const yearDivs = dividends.filter(
      (d) => new Date(d.dividendDate).getFullYear() === selectedYear
    );
    return {
      usTax: yearDivs.filter((d) => d.market === "us").reduce((s, d) => s + Number(d.taxWithheld ?? 0), 0),
      krTax: yearDivs.filter((d) => d.market === "kr").reduce((s, d) => s + Number(d.taxWithheld ?? 0), 0),
    };
  }, [dividends, selectedYear]);

  const totalTaxBurden =
    (cgtCalc?.estimatedTax ?? 0) + krTransactionTax.total + dividendTax.usTax + dividendTax.krTax;

  const deductionProgress = cgtCalc
    ? Math.min(100, (cgtCalc.deductionUsed / BASIC_DEDUCTION) * 100)
    : 0;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-[1000px]">
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">세금 계산기</h1>
            <p className="text-sm text-muted-foreground mt-1">
              연도별 세금 예상액 (이동평균법 기준)
            </p>
          </div>
          {/* 연도 선택 탭 */}
          <div className="flex gap-1 flex-wrap">
            {availableYears.map((y) => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  selectedYear === y
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                {y}년
              </button>
            ))}
          </div>
        </div>

        {/* 요약 카드 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-card border-border/50">
            <CardContent className="p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                해외주식 양도소득세
              </p>
              <p className={`text-2xl font-bold font-mono ${(cgtCalc?.estimatedTax ?? 0) > 0 ? "text-loss" : "text-muted-foreground"}`}>
                {formatKrw(cgtCalc?.estimatedTax ?? 0)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedYear + 1}년 5월 자진신고
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border/50">
            <CardContent className="p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                국내주식 거래세
              </p>
              <p className="text-2xl font-bold font-mono text-loss">
                {formatKrw(krTransactionTax.total)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">매도 시 자동 납부</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border/50">
            <CardContent className="p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                배당소득세 합계
              </p>
              <p className="text-2xl font-bold font-mono text-loss">
                {formatKrw(dividendTax.usTax + dividendTax.krTax)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">원천징수 완료</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="cgt">
          <TabsList className="bg-card border border-border/50">
            <TabsTrigger value="cgt">해외주식 양도소득세</TabsTrigger>
            <TabsTrigger value="kr">국내주식 거래세</TabsTrigger>
            <TabsTrigger value="dividend">배당소득세</TabsTrigger>
          </TabsList>

          {/* ── 양도소득세 탭 ── */}
          <TabsContent value="cgt" className="mt-4 space-y-4">
            <Card className="bg-card border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">
                  {selectedYear}년 기본공제 사용 현황
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">연간 기본공제</span>
                    <span className="font-mono">₩2,500,000</span>
                  </div>
                  <Progress value={deductionProgress} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>사용: {formatKrw(cgtCalc?.deductionUsed ?? 0)}</span>
                    <span>잔여: {formatKrw(cgtCalc?.remainingDeduction ?? 0)}</span>
                  </div>
                </div>

                {(cgtCalc?.totalGain ?? 0) > 0 && (cgtCalc?.remainingDeduction ?? 0) > 0 && (
                  <div className="flex items-start gap-2 bg-primary/5 border border-primary/20 rounded-lg p-3">
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <p className="text-sm text-primary">
                      기본공제 {formatKrw(cgtCalc?.remainingDeduction ?? 0)} 잔여.
                      추가 매도 시 공제 한도 내에서 세금 없음.
                    </p>
                  </div>
                )}
                {(cgtCalc?.estimatedTax ?? 0) > 0 && (
                  <div className="flex items-start gap-2 bg-loss/5 border border-loss/20 rounded-lg p-3">
                    <AlertCircle className="w-4 h-4 text-loss shrink-0 mt-0.5" />
                    <p className="text-sm text-loss">
                      {selectedYear + 1}년 5월 {formatKrw(cgtCalc?.estimatedTax ?? 0)} 신고·납부 예정
                    </p>
                  </div>
                )}
                {(cgtCalc?.totalGain ?? 0) <= 0 && (
                  <div className="flex items-start gap-2 bg-muted/30 border border-border/30 rounded-lg p-3">
                    <CheckCircle2 className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-sm text-muted-foreground">
                      {selectedYear}년 실현 손익이 없거나 손실입니다. 양도소득세 없음.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">
                  {selectedYear}년 양도소득세 계산 내역
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between py-2 border-b border-border/30">
                    <span className="text-muted-foreground">연간 실현 양도차익 (수수료·SEC Fee 차감)</span>
                    <span className={`font-mono font-semibold ${getPnlColorClass(cgtCalc?.totalGain ?? 0)}`}>
                      {formatKrw(cgtCalc?.totalGain ?? 0, true)}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/30">
                    <span className="text-muted-foreground">기본공제 (-) 250만원</span>
                    <span className="font-mono text-profit">
                      -{formatKrw(Math.min(BASIC_DEDUCTION, Math.max(0, cgtCalc?.totalGain ?? 0)))}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/30">
                    <span className="text-muted-foreground">과세표준</span>
                    <span className="font-mono">{formatKrw(cgtCalc?.taxBase ?? 0)}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/30">
                    <span className="text-muted-foreground">세율</span>
                    <span className="font-mono">22% (양도세 20% + 지방세 2%)</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="font-semibold">예상 납부세액</span>
                    <span className={`font-mono font-bold text-lg ${(cgtCalc?.estimatedTax ?? 0) > 0 ? "text-loss" : "text-muted-foreground"}`}>
                      {formatKrw(cgtCalc?.estimatedTax ?? 0)}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  * 취득원가는 이동평균법(매수 시 평균단가 갱신, 매도 시 차감)으로 계산됩니다.
                </p>
              </CardContent>
            </Card>

            {/* 종목별 실현 손익 */}
            {(cgtCalc?.yearSells.length ?? 0) > 0 && (
              <Card className="bg-card border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">
                    {selectedYear}년 매도 내역별 실현 손익
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/50">
                          <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">날짜</th>
                          <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">종목</th>
                          <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3">수량</th>
                          <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3">매도금액</th>
                          <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3">취득원가</th>
                          <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3">수수료+SEC</th>
                          <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3">실현 손익</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cgtCalc?.yearSells.map((r, i) => (
                          <tr key={i} className="border-b border-border/30 hover:bg-accent/20">
                            <td className="px-4 py-3 text-muted-foreground text-xs">{r.date}</td>
                            <td className="px-4 py-3 font-semibold">{r.ticker}</td>
                            <td className="px-4 py-3 text-right font-mono text-muted-foreground">{r.qty.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right font-mono text-muted-foreground">{formatKrw(r.sellKrw)}</td>
                            <td className="px-4 py-3 text-right font-mono text-muted-foreground">{formatKrw(r.costBasisKrw)}</td>
                            <td className="px-4 py-3 text-right font-mono text-loss text-xs">-{formatKrw(r.commission + r.secFee)}</td>
                            <td className={`px-4 py-3 text-right font-mono font-semibold ${getPnlColorClass(r.pnl)}`}>
                              {formatKrw(r.pnl, true)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border/50 bg-muted/20">
                          <td colSpan={6} className="px-4 py-3 text-sm font-semibold">합계</td>
                          <td className={`px-4 py-3 text-right font-mono font-bold ${getPnlColorClass(cgtCalc?.totalGain ?? 0)}`}>
                            {formatKrw(cgtCalc?.totalGain ?? 0, true)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── 국내주식 거래세 탭 ── */}
          <TabsContent value="kr" className="mt-4 space-y-4">
            <Card className="bg-card border-border/50">
              <CardContent className="p-5 space-y-4">
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between py-2 border-b border-border/30">
                    <span className="text-muted-foreground">증권거래세율 (코스피/코스닥)</span>
                    <span className="font-mono">0.20%</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/30">
                    <span className="text-muted-foreground">{selectedYear}년 매도 열액</span>
                    <span className="font-mono">{formatKrw(krTransactionTax.sellAmount)}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/30">
                    <span className="text-muted-foreground">{selectedYear}년 실현 손익 (수수료·거래세 차감, 이동평균법)</span>
                    <span className={`font-mono font-semibold ${getPnlColorClass(krTaxCalc.totalRealizedPnl)}`}>
                      {formatKrw(krTaxCalc.totalRealizedPnl, true)}
                    </span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="font-semibold">{selectedYear}년 납부 거래세 합계</span>
                    <span className="font-mono font-bold text-lg text-loss">
                      {formatKrw(krTransactionTax.total)}
                    </span>
                  </div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
                  국내주식 증권거래세는 매도 시 증권사가 자동으로 원천징수합니다. 별도 신고 불필요.
                  실현 손익은 이동평균법 기준으로 계산됩니다.
                </div>
              </CardContent>
            </Card>

            {/* 국내주식 매도 내역 상세 테이블 */}
            {krTaxCalc.yearSells.length > 0 && (
              <Card className="bg-card border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">
                    {selectedYear}년 국내주식 매도 내역별 실현 손익
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/50">
                          <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">날짜</th>
                          <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">종목</th>
                          <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3">수량</th>
                          <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3">매도금액</th>
                          <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3">취득원가</th>
                          <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3">수수료+거래세</th>
                          <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3">실현 손익</th>
                        </tr>
                      </thead>
                      <tbody>
                        {krTaxCalc.yearSells.map((r, i) => (
                          <tr key={i} className="border-b border-border/30 hover:bg-accent/20">
                            <td className="px-4 py-3 text-muted-foreground text-xs">{r.date}</td>
                            <td className="px-4 py-3">
                              <p className="font-semibold">{r.tickerName ?? r.ticker}</p>
                              <p className="text-xs text-muted-foreground font-mono">{r.ticker}</p>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-muted-foreground">{r.qty.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right font-mono text-muted-foreground">{formatKrw(r.sellKrw)}</td>
                            <td className="px-4 py-3 text-right font-mono text-muted-foreground">{formatKrw(r.costBasisKrw)}</td>
                            <td className="px-4 py-3 text-right font-mono text-loss text-xs">-{formatKrw(r.commission + r.transactionTax)}</td>
                            <td className={`px-4 py-3 text-right font-mono font-semibold ${getPnlColorClass(r.pnl)}`}>
                              {formatKrw(r.pnl, true)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border/50 bg-muted/20">
                          <td colSpan={6} className="px-4 py-3 text-sm font-semibold">합계</td>
                          <td className={`px-4 py-3 text-right font-mono font-bold ${getPnlColorClass(krTaxCalc.totalRealizedPnl)}`}>
                            {formatKrw(krTaxCalc.totalRealizedPnl, true)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {krTaxCalc.yearSells.length === 0 && (
              <Card className="bg-card border-border/50">
                <CardContent className="p-8 text-center text-muted-foreground text-sm">
                  {selectedYear}년에 국내주식 매도 내역이 없습니다.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── 배당소득세 탭 ── */}
          <TabsContent value="dividend" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card className="bg-card border-border/50">
                <CardContent className="p-5 space-y-3">
                  <p className="text-sm font-semibold">미국주식 배당소득세</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">세율</span>
                      <span className="font-mono">15% (미국 원천징수)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{selectedYear}년 납부 세액</span>
                      <span className="font-mono font-semibold text-loss">{formatKrw(dividendTax.usTax)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">배당금 지급 시 미국에서 자동 원천징수</p>
                </CardContent>
              </Card>
              <Card className="bg-card border-border/50">
                <CardContent className="p-5 space-y-3">
                  <p className="text-sm font-semibold">국내주식 배당소득세</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">세율</span>
                      <span className="font-mono">15.4% (국내 원천징수)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{selectedYear}년 납부 세액</span>
                      <span className="font-mono font-semibold text-loss">{formatKrw(dividendTax.krTax)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">배당금 지급 시 국내에서 자동 원천징수</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
