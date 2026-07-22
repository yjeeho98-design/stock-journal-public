import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatKrw, getPnlColorClass } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { CalendarDays, Check, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { KR_BROKERS, US_BROKERS } from "@/lib/brokers";
import { useEffect, useState } from "react";
import { toast } from "sonner";

// ─── 거래 입력 폼 ─────────────────────────────────────────────────────────────

function TradeForm({
  market,
  onSuccess,
}: {
  market: "us" | "kr";
  onSuccess: () => void;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);

  // 증권사 기본값: 미국주식=NH투자증권, 국내주식=미래에셋증권
  const defaultBroker = market === "us" ? "NH투자증권" : "미래에셋증권";
  const [broker, setBroker] = useState(defaultBroker);

  const [form, setForm] = useState({
    tradeType: "buy" as "buy" | "sell",
    ticker: "",
    tickerName: "",
    quantity: "",
    price: "",
    exchangeRate: "",
    memo: "",
    tradeDate: new Date().toISOString().slice(0, 10),
  });

  const [loadingPrice, setLoadingPrice] = useState(false);
  const [loadingRate, setLoadingRate] = useState(false);
  // 국내주식 종목명 검색 자동완성
  const [krSearchQuery, setKrSearchQuery] = useState("");
  const [showKrSuggestions, setShowKrSuggestions] = useState(false);

  const { data: rateData } = trpc.market.exchangeRate.useQuery(undefined, {
    enabled: market === "us" && open,
    staleTime: 5 * 60 * 1000,
  });

  // 국내주식 종목명 검색
  const { data: krSuggestions, isFetching: krSearching } = trpc.market.searchKr.useQuery(
    { query: krSearchQuery },
    {
      enabled: market === "kr" && krSearchQuery.length >= 1,
      staleTime: 30_000,
    }
  );

  const { data: settings } = trpc.settings.get.useQuery(undefined, { enabled: open });

  // 환율 자동 설정
  useEffect(() => {
    if (market === "us" && rateData?.rate && !form.exchangeRate) {
      setForm((f) => ({ ...f, exchangeRate: String(rateData.rate!.toFixed(2)) }));
    }
  }, [rateData, market, form.exchangeRate]);

  const createMutation = trpc.trades.create.useMutation({
    onSuccess: () => {
      toast.success("거래가 저장되었습니다.");
      utils.trades.list.invalidate();
      utils.trades.portfolioSummary.invalidate();
      utils.trades.monthlyPnL.invalidate();
      setOpen(false);
      resetForm();
      onSuccess();
    },
    onError: (err) => toast.error("저장 실패: " + err.message),
  });

  function resetForm() {
    setForm({
      tradeType: "buy",
      ticker: "",
      tickerName: "",
      quantity: "",
      price: "",
      exchangeRate: "",
      memo: "",
      tradeDate: new Date().toISOString().slice(0, 10),
    });
    setBroker(market === "us" ? "NH투자증권" : "미래에셋증권");
    setKrSearchQuery("");
    setShowKrSuggestions(false);
  }

  // 선택된 증권사의 수수료율 조회
  function getBrokerCommissionRate(): number {
    if (!settings) return market === "us" ? 0.25 : 0.015;
    if (market === "us") {
      const found = US_BROKERS.find((b) => b.label === broker);
      if (found) return Number((settings as any)[found.key] ?? found.defaultRate);
      return Number((settings as any).usCommissionRate ?? 0.25);
    } else {
      const found = KR_BROKERS.find((b) => b.label === broker);
      if (found) return Number((settings as any)[found.key] ?? found.defaultRate);
      return Number((settings as any).krCommissionRate ?? 0.015);
    }
  }

  function selectKrSuggestion(item: { ticker: string; name: string; market: string }) {
    setForm((f) => ({ ...f, ticker: item.ticker, tickerName: item.name }));
    setKrSearchQuery(item.name);
    setShowKrSuggestions(false);
    // 선택 후 자동으로 현재가 조회
    setTimeout(async () => {
      setLoadingPrice(true);
      try {
        const result = await utils.market.krPrice.fetch({ ticker: item.ticker });
        if (result) {
          setForm((f) => ({ ...f, price: String(result.price) }));
          toast.success(`${result.name}: ₩${result.price.toLocaleString()}`);
        }
      } catch { /* silent */ } finally {
        setLoadingPrice(false);
      }
    }, 0);
  }

  async function fetchCurrentPrice() {
    if (!form.ticker) return;
    setLoadingPrice(true);
    try {
      if (market === "us") {
        const result = await utils.market.usPrice.fetch({ ticker: form.ticker });
        if (result) {
          setForm((f) => ({
            ...f,
            price: String(result.price),
            tickerName: result.name,
          }));
          toast.success(`${result.name}: $${result.price}`);
        } else {
          toast.error("종목을 찾을 수 없습니다.");
        }
      } else {
        const result = await utils.market.krPrice.fetch({ ticker: form.ticker });
        if (result) {
          setForm((f) => ({
            ...f,
            price: String(result.price),
            tickerName: result.name,
          }));
          toast.success(`${result.name}: ₩${result.price.toLocaleString()}`);
        } else {
          toast.error("종목을 찾을 수 없습니다.");
        }
      }
    } catch {
      toast.error("시세 조회 실패");
    } finally {
      setLoadingPrice(false);
    }
  }

  async function fetchExchangeRate() {
    setLoadingRate(true);
    try {
      const result = await utils.market.exchangeRate.fetch();
      if (result.rate) {
        setForm((f) => ({ ...f, exchangeRate: String(result.rate!.toFixed(2)) }));
        toast.success(`환율: ₩${result.rate.toFixed(2)}`);
      }
    } catch {
      toast.error("환율 조회 실패");
    } finally {
      setLoadingRate(false);
    }
  }

  function calcTotalKrw(): number {
    const qty = Number(form.quantity);
    const price = Number(form.price);
    const rate = market === "us" ? Number(form.exchangeRate) : 1;
    if (!qty || !price) return 0;
    return qty * price * rate;
  }

  function calcCommission(): number {
    const total = calcTotalKrw();
    if (!total) return 0;
    const rate = getBrokerCommissionRate();
    return total * (rate / 100);
  }

  function calcTax(): number {
    if (form.tradeType !== "sell") return 0;
    const total = calcTotalKrw();
    if (!total) return 0;
    if (market === "kr") return total * 0.002; // 0.20%
    // SEC Fee
    const qty = Number(form.quantity);
    const price = Number(form.price);
    const rate = Number(form.exchangeRate);
    const secRate = Number(settings?.secFeeRate ?? 0.0008);
    return qty * price * (secRate / 100) * rate;
  }

  function handleSubmit() {
    const qty = Number(form.quantity);
    const price = Number(form.price);
    const rate = market === "us" ? Number(form.exchangeRate) : 1;

    if (!form.ticker || !qty || !price) {
      toast.error("종목코드, 수량, 단가를 입력해주세요.");
      return;
    }
    if (market === "us" && !rate) {
      toast.error("환율을 입력해주세요.");
      return;
    }

    const totalKrw = qty * price * rate;
    const commission = calcCommission();
    const tax = calcTax();
    const secFee = market === "us" && form.tradeType === "sell"
      ? qty * price * (Number(settings?.secFeeRate ?? 0.0008) / 100)
      : 0;

    createMutation.mutate({
      market,
      tradeType: form.tradeType,
      ticker: form.ticker,
      tickerName: form.tickerName || undefined,
      quantity: qty,
      price,
      exchangeRate: rate,
      totalAmountKrw: totalKrw,
      commission,
      tax,
      secFee,
      broker: broker || undefined,
      memo: form.memo || undefined,
      tradeDate: new Date(form.tradeDate),
    });
  }

  const totalKrw = calcTotalKrw();
  const commission = calcCommission();
  const tax = calcTax();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="w-4 h-4" />
          거래 입력
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle>
            {market === "us" ? "미국주식" : "국내주식"} 거래 입력
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 증권사 선택 */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">증권사</Label>
            <Select value={broker} onValueChange={setBroker}>
              <SelectTrigger className="bg-input border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(market === "us" ? US_BROKERS : KR_BROKERS).map((b) => (
                  <SelectItem key={b.key} value={b.label}>
                    {b.label}
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({b.defaultRate}%)
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {settings && (
              <p className="text-xs text-muted-foreground mt-1">
                적용 수수료율: <span className="text-primary font-medium">{getBrokerCommissionRate().toFixed(4)}%</span>
              </p>
            )}
          </div>

          {/* 거래구분 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">거래구분</Label>
              <Select
                value={form.tradeType}
                onValueChange={(v) => setForm((f) => ({ ...f, tradeType: v as any }))}
              >
                <SelectTrigger className="bg-input border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="buy">매수</SelectItem>
                  <SelectItem value="sell">매도</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">거래일자</Label>
              <Input
                type="date"
                value={form.tradeDate}
                onChange={(e) => setForm((f) => ({ ...f, tradeDate: e.target.value }))}
                className="bg-input border-border"
              />
            </div>
          </div>

          {/* 종목 입력 - 미국주식: 코드 직접 입력, 국내주식: 기업명 검색 자동완성 */}
          <div>
            {market === "kr" ? (
              // 국내주식: 기업명 검색 자동완성
              <div className="relative">
                <Label className="text-xs text-muted-foreground mb-1.5 block">
                  기업명 검색
                  {form.ticker && (
                    <span className="ml-2 text-primary font-mono">{form.ticker}</span>
                  )}
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="삼성전자, 카카오, SK하이닉스..."
                      value={krSearchQuery}
                      onChange={(e) => {
                        setKrSearchQuery(e.target.value);
                        setShowKrSuggestions(true);
                        if (!e.target.value) {
                          setForm((f) => ({ ...f, ticker: "", tickerName: "" }));
                        }
                      }}
                      onFocus={() => krSearchQuery && setShowKrSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowKrSuggestions(false), 150)}
                      className="bg-input border-border pl-8"
                    />
                    {krSearching && (
                      <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {loadingPrice && (
                    <div className="flex items-center px-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    </div>
                  )}
                </div>
                {/* 자동완성 드롭다운 */}
                {showKrSuggestions && krSuggestions && krSuggestions.length > 0 && (
                  <div className="absolute z-50 top-full mt-1 w-full bg-card border border-border rounded-lg shadow-xl overflow-hidden">
                    {krSuggestions.map((item) => (
                      <button
                        key={item.ticker}
                        type="button"
                        onMouseDown={() => selectKrSuggestion(item)}
                        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-accent/50 transition-colors text-left"
                      >
                        <div>
                          <p className="text-sm font-semibold">{item.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{item.ticker}</p>
                        </div>
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {item.market}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {form.tickerName && (
                  <p className="text-xs text-profit mt-1">✓ {form.tickerName} ({form.ticker}) 선택됨</p>
                )}
              </div>
            ) : (
              // 미국주식: 종목코드 직접 입력
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">종목코드</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="AAPL, TSLA, PLTR..."
                    value={form.ticker}
                    onChange={(e) => setForm((f) => ({ ...f, ticker: e.target.value.toUpperCase() }))}
                    className="bg-input border-border flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchCurrentPrice}
                    disabled={!form.ticker || loadingPrice}
                    className="shrink-0 border-border"
                  >
                    {loadingPrice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "시세조회"}
                  </Button>
                </div>
                {form.tickerName && (
                  <p className="text-xs text-muted-foreground mt-1">{form.tickerName}</p>
                )}
              </div>
            )}
          </div>

          {/* 수량 + 단가 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">수량</Label>
              <Input
                type="number"
                placeholder="0"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                className="bg-input border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                단가 ({market === "us" ? "USD" : "KRW"})
              </Label>
              <Input
                type="number"
                placeholder="0"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                className="bg-input border-border"
              />
            </div>
          </div>

          {/* 환율 (미국주식만) */}
          {market === "us" && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">환율 (USD/KRW)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="1300.00"
                  value={form.exchangeRate}
                  onChange={(e) => setForm((f) => ({ ...f, exchangeRate: e.target.value }))}
                  className="bg-input border-border flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchExchangeRate}
                  disabled={loadingRate}
                  className="shrink-0 border-border"
                >
                  {loadingRate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
          )}

          {/* 계산 결과 미리보기 */}
          {totalKrw > 0 && (
            <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm border border-border/50">
              <div className="flex justify-between">
                <span className="text-muted-foreground">거래금액</span>
                <span className="font-mono font-medium">{formatKrw(totalKrw)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">수수료</span>
                <span className="font-mono text-loss">-{formatKrw(commission)}</span>
              </div>
              {form.tradeType === "sell" && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {market === "kr" ? "증권거래세" : "SEC Fee"}
                  </span>
                  <span className="font-mono text-loss">-{formatKrw(tax)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border/50 pt-1.5">
                <span className="font-medium">실수령/실지급</span>
                <span className="font-mono font-semibold">
                  {formatKrw(
                    form.tradeType === "buy"
                      ? totalKrw + commission
                      : totalKrw - commission - tax
                  )}
                </span>
              </div>
            </div>
          )}

          {/* 메모 */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">메모 (선택)</Label>
            <Input
              placeholder="매매 근거, 메모..."
              value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
              className="bg-input border-border"
            />
          </div>

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : null}
            저장하기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── 거래 내역 테이블 ─────────────────────────────────────────────────────────

// ─── 인라인 수정 행 ──────────────────────────────────────────────────────────

function EditTradeRow({
  trade,
  market,
  onCancel,
  onSaved,
}: {
  trade: any;
  market: "us" | "kr";
  onCancel: () => void;
  onSaved: () => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    tradeDate: new Date(trade.tradeDate).toISOString().slice(0, 10),
    tradeType: trade.tradeType as "buy" | "sell",
    ticker: trade.ticker,
    quantity: String(Number(trade.quantity)),
    price: String(Number(trade.price)),
    exchangeRate: String(Number(trade.exchangeRate ?? 1)),
    totalAmountKrw: String(Number(trade.totalAmountKrw)),
    commission: String(Number(trade.commission)),
    memo: trade.memo ?? "",
  });

  const updateMutation = trpc.trades.update.useMutation({
    onSuccess: () => {
      toast.success("수정되었습니다.");
      utils.trades.list.invalidate();
      utils.trades.portfolioSummary.invalidate();
      utils.trades.monthlyPnL.invalidate();
      onSaved();
    },
    onError: (err) => toast.error("수정 실패: " + err.message),
  });

  const handleSave = () => {
    updateMutation.mutate({
      id: trade.id,
      tradeDate: new Date(form.tradeDate),
      tradeType: form.tradeType,
      ticker: form.ticker,
      quantity: parseFloat(form.quantity),
      price: parseFloat(form.price),
      exchangeRate: parseFloat(form.exchangeRate),
      totalAmountKrw: parseFloat(form.totalAmountKrw),
      commission: parseFloat(form.commission),
      memo: form.memo,
    });
  };

  const inputCls = "h-7 text-xs bg-input border-border px-2 w-full";

  return (
    <tr className="border-b border-primary/30 bg-primary/5">
      {/* 날짜 */}
      <td className="px-2 py-2">
        <Input type="date" value={form.tradeDate} onChange={(e) => setForm(f => ({ ...f, tradeDate: e.target.value }))} className={inputCls} />
      </td>
      {/* 구분 */}
      <td className="px-2 py-2">
        <Select value={form.tradeType} onValueChange={(v) => setForm(f => ({ ...f, tradeType: v as any }))}>
          <SelectTrigger className="h-7 text-xs bg-input border-border w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="buy">매수</SelectItem>
            <SelectItem value="sell">매도</SelectItem>
          </SelectContent>
        </Select>
      </td>
      {/* 종목 */}
      <td className="px-2 py-2">
        <Input value={form.ticker} onChange={(e) => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))} className={`${inputCls} w-24`} />
      </td>
      {/* 수량 */}
      <td className="px-2 py-2">
        <Input type="number" value={form.quantity} onChange={(e) => setForm(f => ({ ...f, quantity: e.target.value }))} className={`${inputCls} text-right w-20`} />
      </td>
      {/* 단가 */}
      <td className="px-2 py-2">
        <Input type="number" value={form.price} onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))} className={`${inputCls} text-right w-24`} />
      </td>
      {/* 환율 (미국주식만) */}
      {market === "us" && (
        <td className="px-2 py-2">
          <Input type="number" value={form.exchangeRate} onChange={(e) => setForm(f => ({ ...f, exchangeRate: e.target.value }))} className={`${inputCls} text-right w-24`} />
        </td>
      )}
      {/* 거래금액 */}
      <td className="px-2 py-2">
        <Input type="number" value={form.totalAmountKrw} onChange={(e) => setForm(f => ({ ...f, totalAmountKrw: e.target.value }))} className={`${inputCls} text-right w-28`} />
      </td>
      {/* 수수료 */}
      <td className="px-2 py-2">
        <Input type="number" value={form.commission} onChange={(e) => setForm(f => ({ ...f, commission: e.target.value }))} className={`${inputCls} text-right w-24`} />
      </td>
      {/* 메모 */}
      <td className="px-2 py-2">
        <Input value={form.memo} onChange={(e) => setForm(f => ({ ...f, memo: e.target.value }))} className={`${inputCls} w-28`} placeholder="메모" />
      </td>
      {/* 저장/취소 */}
      <td className="px-2 py-2">
        <div className="flex gap-1">
          <Button size="sm" className="h-7 w-7 p-0" onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" onClick={onCancel}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ─── 거래 내역 테이블 ──────────────────────────────────────────────────────────

function TradeTable({ market, searchTicker, tradeTypeFilter = "all", dateFrom = "", dateTo = "" }: { market: "us" | "kr"; searchTicker: string; tradeTypeFilter?: "all" | "buy" | "sell"; dateFrom?: string; dateTo?: string }) {
  const utils = trpc.useUtils();
  const { data: trades, isLoading } = trpc.trades.list.useQuery({ market });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const deleteMutation = trpc.trades.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      utils.trades.list.invalidate();
      utils.trades.portfolioSummary.invalidate();
      utils.trades.monthlyPnL.invalidate();
    },
    onError: (err) => toast.error("삭제 실패: " + err.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  // 클라이언트 사이드 필터링 (종목 검색 + 매수/매도 + 날짜 범위)
  const filtered = (trades ?? []).filter((t) => {
    const tickerMatch = !searchTicker || t.ticker.toUpperCase().includes(searchTicker.toUpperCase());
    const typeMatch = tradeTypeFilter === "all" || t.tradeType === tradeTypeFilter;
    const tradeDate = new Date(t.tradeDate);
    const fromMatch = !dateFrom || tradeDate >= new Date(dateFrom);
    const toMatch = !dateTo || tradeDate <= new Date(dateTo + "T23:59:59");
    return tickerMatch && typeMatch && fromMatch && toMatch;
  });

  // 페이지네이션
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (!trades?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <p className="text-muted-foreground">거래 내역이 없습니다.</p>
        <p className="text-sm text-muted-foreground">위의 '거래 입력' 버튼으로 첫 거래를 추가해 보세요.</p>
      </div>
    );
  }

  if (filtered.length === 0 && (searchTicker || tradeTypeFilter !== "all")) {
    const filterDesc = [
      searchTicker ? `'${searchTicker.toUpperCase()}'` : "",
      tradeTypeFilter === "buy" ? "매수" : tradeTypeFilter === "sell" ? "매도" : "",
    ].filter(Boolean).join(" ");
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <p className="text-muted-foreground">{filterDesc} 조건에 해당하는 거래 내역이 없습니다.</p>
      </div>
    );
  }

  return (
    <div>
      {/* 상단 카운트 바 */}
      <div className="px-4 py-2 border-b border-border/30 text-xs text-muted-foreground flex items-center justify-between">
        <span>
          {searchTicker
            ? <><span className="text-primary font-semibold">{searchTicker.toUpperCase()}</span> 검색 결과 {filtered.length}건</>
            : <>전체 {filtered.length}건</>}
        </span>
        {totalPages > 1 && (
          <span>{safePage} / {totalPages} 페이지</span>
        )}
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50">
            <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">날짜</th>
            <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">구분</th>
            <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">종목</th>
            <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">수량</th>
            <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">단가</th>
            {market === "us" && (
              <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">환율</th>
            )}
            <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">거래금액</th>
            <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">수수료</th>
            <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">메모</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((trade) => {
            if (editingId === trade.id) {
              return (
                <EditTradeRow
                  key={trade.id}
                  trade={trade}
                  market={market}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => setEditingId(null)}
                />
              );
            }
            return (
              <tr
                key={trade.id}
                className="border-b border-border/30 hover:bg-accent/20 transition-colors group"
                onMouseEnter={() => setHoveredId(trade.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {formatDate(trade.tradeDate)}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    variant="outline"
                    className={`text-xs px-2 py-0.5 ${
                      trade.tradeType === "buy"
                        ? "border-profit/50 text-profit bg-profit-muted"
                        : "border-loss/50 text-loss bg-loss-muted"
                    }`}
                  >
                    {trade.tradeType === "buy" ? "매수" : "매도"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold">{trade.ticker}</p>
                  {trade.tickerName && (
                    <p className="text-xs text-muted-foreground truncate max-w-28">{trade.tickerName}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {Number(trade.quantity).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                  {market === "us"
                    ? `$${Number(trade.price).toFixed(2)}`
                    : `₩${Number(trade.price).toLocaleString()}`}
                </td>
                {market === "us" && (
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground text-xs">
                    {Number(trade.exchangeRate).toFixed(2)}
                  </td>
                )}
                <td className="px-4 py-3 text-right font-mono">
                  {formatKrw(Number(trade.totalAmountKrw))}
                </td>
                <td className="px-4 py-3 text-right font-mono text-loss text-xs">
                  -{formatKrw(Number(trade.commission) + Number(trade.tax))}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs max-w-32 truncate">
                  {trade.memo ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {/* 호버 시 수정 버튼 표시 */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-7 w-7 p-0 text-muted-foreground hover:text-primary transition-opacity ${
                        hoveredId === trade.id ? "opacity-100" : "opacity-0"
                      }`}
                      onClick={() => setEditingId(trade.id)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (confirm("이 거래를 삭제하시겠습니까?")) {
                          deleteMutation.mutate({ id: trade.id });
                        }
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {/* 페이지네이션 컨트롤 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5 px-4 py-4 border-t border-border/30">
          <Button
            variant="outline" size="sm"
            className="h-8 px-2.5 border-border text-xs"
            onClick={() => setPage(1)}
            disabled={safePage === 1}
          >
            «
          </Button>
          <Button
            variant="outline" size="sm"
            className="h-8 px-3 border-border text-xs"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
          >
            ‹ 이전
          </Button>
          <div className="flex gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => Math.abs(p - safePage) <= 2)
              .map((p) => (
                <Button
                  key={p}
                  variant={p === safePage ? "default" : "outline"}
                  size="sm"
                  className="h-8 w-8 p-0 text-xs border-border"
                  onClick={() => setPage(p)}
                >
                  {p}
                </Button>
              ))}
          </div>
          <Button
            variant="outline" size="sm"
            className="h-8 px-3 border-border text-xs"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
          >
            다음 ›
          </Button>
          <Button
            variant="outline" size="sm"
            className="h-8 px-2.5 border-border text-xs"
            onClick={() => setPage(totalPages)}
            disabled={safePage === totalPages}
          >
            »
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── 종목별 손익 정산 ─────────────────────────────────────────────────────────

function TickerSummaryTable({ market }: { market: "us" | "kr" }) {
  const { data: summary, isLoading } = trpc.trades.portfolioSummary.useQuery({ market });

  if (isLoading) return <Skeleton className="h-40 rounded-lg" />;
  if (!summary?.length) return null;

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">종목별 손익 정산</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">종목</th>
                <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">매수 총액</th>
                <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">매도 총액</th>
                <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">수수료+세금</th>
                <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">실현 손익</th>
                <th className="text-right text-xs text-muted-foreground font-medium px-4 py-3 uppercase tracking-wider">보유수량</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => {
                const buyQty = Number(row.totalBuyQty ?? 0);
                const sellQty = Number(row.totalSellQty ?? 0);
                const holdingQty = Math.max(0, buyQty - sellQty);
                const buyKrw = Number(row.totalBuyAmountKrw ?? 0);
                const sellKrw = Number(row.totalSellAmountKrw ?? 0);
                const commission = Number(row.totalCommission ?? 0);
                const tax = Number(row.totalTax ?? 0);
                const avgCost = buyQty > 0 ? buyKrw / buyQty : 0;
                const realizedPnl = sellKrw - avgCost * sellQty - commission - tax;

                return (
                  <tr key={row.ticker} className="border-b border-border/30 hover:bg-accent/20 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-semibold">{row.ticker}</p>
                      {row.tickerName && (
                        <p className="text-xs text-muted-foreground">{row.tickerName}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {formatKrw(buyKrw)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {sellKrw > 0 ? formatKrw(sellKrw) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-loss text-xs">
                      -{formatKrw(commission + tax)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${getPnlColorClass(realizedPnl)}`}>
                      {sellKrw > 0 ? formatKrw(realizedPnl, true) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {holdingQty > 0 ? holdingQty.toLocaleString() : "청산"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

export default function Trades() {
  const [activeTab, setActiveTab] = useState<"us" | "kr">("us");
  const [view, setView] = useState<"trades" | "summary">("trades");
  const [searchTicker, setSearchTicker] = useState("");
  const [tradeTypeFilter, setTradeTypeFilter] = useState<"all" | "buy" | "sell">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const hasDateFilter = !!(dateFrom || dateTo);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-[1400px]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">매매일지</h1>
            <p className="text-sm text-muted-foreground mt-1">거래 내역 입력 및 조회</p>
          </div>
          <TradeForm market={activeTab} onSuccess={() => {}} />
        </div>

        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as any); setSearchTicker(""); setTradeTypeFilter("all"); setDateFrom(""); setDateTo(""); }}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <TabsList className="bg-card border border-border/50">
              <TabsTrigger value="us">미국주식</TabsTrigger>
              <TabsTrigger value="kr">국내주식</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2 flex-wrap">
              {/* 종목 검색창 */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="종목 검색 (예: PLTR)"
                  value={searchTicker}
                  onChange={(e) => setSearchTicker(e.target.value.toUpperCase())}
                  className="pl-8 pr-8 h-8 w-44 bg-input border-border text-sm"
                />
                {searchTicker && (
                  <button
                    onClick={() => setSearchTicker("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {/* 날짜 범위 필터 */}
              <div className="flex items-center gap-1.5">
                <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-8 w-36 bg-input border-border text-xs px-2"
                  title="시작일"
                />
                <span className="text-muted-foreground text-xs">~</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-8 w-36 bg-input border-border text-xs px-2"
                  title="종료일"
                />
                {hasDateFilter && (
                  <button
                    onClick={() => { setDateFrom(""); setDateTo(""); }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="날짜 필터 초기화"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {/* 매수/매도 필터 버튼 */}
              <div className="flex items-center rounded-md border border-border/50 bg-card overflow-hidden">
                {(["all", "buy", "sell"] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setTradeTypeFilter(type)}
                    className={`px-3 h-8 text-xs font-medium transition-colors ${
                      tradeTypeFilter === type
                        ? type === "buy"
                          ? "bg-profit/20 text-profit"
                          : type === "sell"
                          ? "bg-loss/20 text-loss"
                          : "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                    }`}
                  >
                    {type === "all" ? "전체" : type === "buy" ? "매수" : "매도"}
                  </button>
                ))}
              </div>
              <Button
                variant={view === "trades" ? "default" : "outline"}
                size="sm"
                onClick={() => setView("trades")}
                className="border-border"
              >
                거래 내역
              </Button>
              <Button
                variant={view === "summary" ? "default" : "outline"}
                size="sm"
                onClick={() => setView("summary")}
                className="border-border"
              >
                종목별 정산
              </Button>
            </div>
          </div>

          <TabsContent value="us" className="mt-4">
            {view === "trades" ? (
              <Card className="bg-card border-border/50">
                <TradeTable market="us" searchTicker={searchTicker} tradeTypeFilter={tradeTypeFilter} dateFrom={dateFrom} dateTo={dateTo} />
              </Card>
            ) : (
              <TickerSummaryTable market="us" />
            )}
          </TabsContent>

          <TabsContent value="kr" className="mt-4">
            {view === "trades" ? (
              <Card className="bg-card border-border/50">
                <TradeTable market="kr" searchTicker={searchTicker} tradeTypeFilter={tradeTypeFilter} dateFrom={dateFrom} dateTo={dateTo} />
              </Card>
            ) : (
              <TickerSummaryTable market="kr" />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
