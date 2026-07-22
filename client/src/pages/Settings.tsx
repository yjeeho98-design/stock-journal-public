import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// 증권사 목록은 @/lib/brokers에서 가져옴
import { KR_BROKERS, US_BROKERS } from "@/lib/brokers";
export { KR_BROKERS, US_BROKERS };

// ─── CSV 파서 ─────────────────────────────────────────────────────────────────

function parseUsCsv(text: string) {
  const lines = text.trim().split("\n").slice(1);
  return lines
    .map((line) => {
      const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      if (cols.length < 6) return null;
      const [dateStr, typeStr, ticker, qty, price, rate, total] = cols;
      const tradeType = typeStr?.includes("매도") || typeStr?.toLowerCase() === "sell" ? "sell" : "buy";
      const tradeDate = dateStr?.replace(/\./g, "-");
      if (!ticker || !qty || !price) return null;
      return {
        tradeDate,
        tradeType: tradeType as "buy" | "sell",
        ticker: ticker.toUpperCase(),
        quantity: Number(qty),
        price: Number(price),
        exchangeRate: Number(rate) || 1300,
        totalAmountKrw: Number(total) || Number(qty) * Number(price) * (Number(rate) || 1300),
      };
    })
    .filter(Boolean) as any[];
}

function parseKrCsv(text: string) {
  const lines = text.trim().split("\n").slice(1);
  return lines
    .map((line) => {
      const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      if (cols.length < 5) return null;
      const [dateStr, typeStr, ticker, qty, price, total] = cols;
      const tradeType = typeStr?.includes("매도") || typeStr?.toLowerCase() === "sell" ? "sell" : "buy";
      const tradeDate = dateStr?.replace(/\./g, "-");
      if (!ticker || !qty || !price) return null;
      return {
        tradeDate,
        tradeType: tradeType as "buy" | "sell",
        ticker,
        quantity: Number(qty),
        price: Number(price.replace(/,/g, "")),
        exchangeRate: 1,
        totalAmountKrw: Number((total ?? "").replace(/,/g, "")) || Number(qty) * Number(price.replace(/,/g, "")),
      };
    })
    .filter(Boolean) as any[];
}

function CsvImport() {
  const utils = trpc.useUtils();
  const [market, setMarket] = useState<"us" | "kr">("us");
  const [preview, setPreview] = useState<any[]>([]);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const importMutation = trpc.trades.importCsv.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.count}건 가져오기 완료!`);
      utils.trades.list.invalidate();
      utils.trades.portfolioSummary.invalidate();
      utils.trades.monthlyPnL.invalidate();
      setPreview([]);
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (err) => toast.error("가져오기 실패: " + err.message),
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = market === "us" ? parseUsCsv(text) : parseKrCsv(text);
      setPreview(rows.slice(0, 5));
    };
    reader.readAsText(file, "utf-8");
  }

  function handleImport() {
    if (!fileRef.current?.files?.[0]) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = market === "us" ? parseUsCsv(text) : parseKrCsv(text);
      importMutation.mutate({ market, rows });
    };
    reader.readAsText(fileRef.current.files[0], "utf-8");
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => { setMarket("us"); setPreview([]); setFileName(""); }}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors border ${market === "us" ? "bg-primary text-primary-foreground border-primary" : "bg-transparent text-muted-foreground border-border hover:bg-accent"}`}
        >미국주식</button>
        <button
          onClick={() => { setMarket("kr"); setPreview([]); setFileName(""); }}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors border ${market === "kr" ? "bg-primary text-primary-foreground border-primary" : "bg-transparent text-muted-foreground border-border hover:bg-accent"}`}
        >국내주식</button>
      </div>

      <div
        className="border-2 border-dashed border-border/50 rounded-xl p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm font-medium">{fileName || "CSV 파일을 선택하세요"}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {market === "us"
            ? "컬럼 순서: 거래일자, 거래구분, 종목코드, 수량, 단가(USD), 환율, 총금액(KRW)"
            : "컬럼 순서: 거래일자, 거래구분, 종목코드, 수량, 단가(KRW), 총금액(KRW)"}
        </p>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
      </div>

      {preview.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">미리보기 (상위 5건)</p>
          <div className="overflow-x-auto bg-muted/20 rounded-lg border border-border/50">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left px-3 py-2 text-muted-foreground">날짜</th>
                  <th className="text-left px-3 py-2 text-muted-foreground">구분</th>
                  <th className="text-left px-3 py-2 text-muted-foreground">종목</th>
                  <th className="text-right px-3 py-2 text-muted-foreground">수량</th>
                  <th className="text-right px-3 py-2 text-muted-foreground">단가</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="px-3 py-2">{row.tradeDate}</td>
                    <td className="px-3 py-2">{row.tradeType === "buy" ? "매수" : "매도"}</td>
                    <td className="px-3 py-2 font-semibold">{row.ticker}</td>
                    <td className="px-3 py-2 text-right">{row.quantity}</td>
                    <td className="px-3 py-2 text-right">{row.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Button className="w-full" onClick={handleImport} disabled={!fileName || importMutation.isPending}>
        {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
        가져오기 실행
      </Button>
    </div>
  );
}

// ─── 수수료 설정 ──────────────────────────────────────────────────────────────

type CommissionFormState = Record<string, string>;

function CommissionSettings() {
  const utils = trpc.useUtils();
  const { data: settings, isLoading } = trpc.settings.get.useQuery();
  const [form, setForm] = useState<CommissionFormState>({});

  useEffect(() => {
    if (settings) {
      const init: CommissionFormState = {};
      [...US_BROKERS, ...KR_BROKERS].forEach(({ key, defaultRate }) => {
        init[key] = String((settings as any)[key] ?? defaultRate);
      });
      init.secFeeRate = String((settings as any).secFeeRate ?? "0.0008");
      setForm(init);
    }
  }, [settings]);

  const updateMutation = trpc.settings.update.useMutation({
    onSuccess: () => {
      toast.success("설정이 저장되었습니다.");
      utils.settings.get.invalidate();
    },
    onError: (err) => toast.error("저장 실패: " + err.message),
  });

  function handleSave() {
    const payload: Record<string, number> = {};
    Object.entries(form).forEach(([k, v]) => {
      const n = Number(v);
      if (!isNaN(n)) payload[k] = n;
    });
    updateMutation.mutate(payload as any);
  }

  if (isLoading) return <div className="animate-pulse h-40 bg-muted rounded-lg" />;

  return (
    <div className="space-y-8">
      {/* 미국주식 증권사별 수수료율 */}
      <div>
        <h3 className="text-sm font-semibold mb-1">미국주식 증권사별 수수료율</h3>
        <p className="text-xs text-muted-foreground mb-4">각 증권사의 해외주식 매매 수수료율을 입력하세요.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {US_BROKERS.map(({ key, label, defaultRate }) => (
            <div key={key}>
              <Label className="text-xs text-muted-foreground mb-1.5 block">{label}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="10"
                  placeholder={defaultRate}
                  value={form[key] ?? defaultRate}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="bg-input border-border"
                />
                <span className="text-sm text-muted-foreground shrink-0">%</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 max-w-xs">
          <Label className="text-xs text-muted-foreground mb-1.5 block">SEC Fee율 (미국주식 매도 시)</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="0.0001"
              min="0"
              placeholder="0.0008"
              value={form.secFeeRate ?? "0.0008"}
              onChange={(e) => setForm((f) => ({ ...f, secFeeRate: e.target.value }))}
              className="bg-input border-border"
            />
            <span className="text-sm text-muted-foreground shrink-0">%</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">현행 0.0008% (매도 금액 기준)</p>
        </div>
      </div>

      <Separator className="bg-border/50" />

      {/* 국내주식 증권사별 수수료율 */}
      <div>
        <h3 className="text-sm font-semibold mb-1">국내주식 증권사별 수수료율</h3>
        <p className="text-xs text-muted-foreground mb-4">각 증권사의 국내주식 매매 수수료율을 입력하세요.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {KR_BROKERS.map(({ key, label, defaultRate }) => (
            <div key={key}>
              <Label className="text-xs text-muted-foreground mb-1.5 block">{label}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  max="10"
                  placeholder={defaultRate}
                  value={form[key] ?? defaultRate}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="bg-input border-border"
                />
                <span className="text-sm text-muted-foreground shrink-0">%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground border border-border/50">
        <p className="font-medium text-foreground mb-1">고정 세율 안내</p>
        <p>• 국내주식 증권거래세: 0.20% (코스피/코스닥, 2026년~)</p>
        <p>• 해외주식 양도소득세: 기본공제 250만원, 세율 22%</p>
        <p>• 미국주식 배당소득세: 15% (미국 원천징수)</p>
        <p>• 국내주식 배당소득세: 15.4% (국내 원천징수)</p>
      </div>

      <Button onClick={handleSave} disabled={updateMutation.isPending} className="w-full sm:w-auto">
        {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        설정 저장
      </Button>
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

export default function Settings() {
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-[900px]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">설정</h1>
          <p className="text-sm text-muted-foreground mt-1">증권사별 수수료율 설정 및 데이터 가져오기</p>
        </div>

        <Tabs defaultValue="commission">
          <TabsList className="bg-card border border-border/50">
            <TabsTrigger value="commission">수수료 설정</TabsTrigger>
            <TabsTrigger value="import">CSV 가져오기</TabsTrigger>
          </TabsList>

          <TabsContent value="commission" className="mt-4">
            <Card className="bg-card border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">증권사별 수수료율</CardTitle>
              </CardHeader>
              <CardContent>
                <CommissionSettings />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="import" className="mt-4">
            <Card className="bg-card border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">CSV 데이터 가져오기</CardTitle>
              </CardHeader>
              <CardContent>
                <CsvImport />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
