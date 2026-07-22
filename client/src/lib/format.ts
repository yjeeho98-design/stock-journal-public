// ─── 숫자/금액 포맷 유틸리티 ────────────────────────────────────────────────

export function formatKrw(amount: number | string, showSign = false): string {
  const n = Number(amount);
  if (isNaN(n)) return "—";
  const abs = Math.abs(n);
  const formatted = new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(abs);
  if (showSign && n !== 0) {
    return (n > 0 ? "+" : "-") + "₩" + formatted;
  }
  return "₩" + formatted;
}

export function formatUsd(amount: number | string, showSign = false): string {
  const n = Number(amount);
  if (isNaN(n)) return "—";
  const abs = Math.abs(n);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  if (showSign && n !== 0) {
    return (n > 0 ? "+" : "-") + "$" + formatted;
  }
  return "$" + formatted;
}

export function formatPercent(value: number | string, showSign = false): string {
  const n = Number(value);
  if (isNaN(n)) return "—";
  const formatted = Math.abs(n).toFixed(2) + "%";
  if (showSign && n !== 0) {
    return (n > 0 ? "+" : "-") + formatted;
  }
  return formatted;
}

export function formatNumber(value: number | string, decimals = 0): string {
  const n = Number(value);
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function formatDateShort(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function formatYearMonth(yearMonth: string): string {
  // "2024-03" → "2024년 3월"
  const [year, month] = yearMonth.split("-");
  return `${year}년 ${parseInt(month)}월`;
}

// 수익/손실 색상 클래스
export function getPnlColorClass(value: number): string {
  if (value > 0) return "text-profit";
  if (value < 0) return "text-loss";
  return "text-muted-foreground";
}

export function getPnlBgClass(value: number): string {
  if (value > 0) return "bg-profit-muted text-profit";
  if (value < 0) return "bg-loss-muted text-loss";
  return "bg-muted text-muted-foreground";
}

// 종목별 차트 색상 팔레트
const CHART_COLORS = [
  "oklch(0.65 0.18 240)",
  "oklch(0.70 0.15 160)",
  "oklch(0.72 0.16 60)",
  "oklch(0.68 0.18 300)",
  "oklch(0.65 0.20 25)",
  "oklch(0.70 0.16 200)",
  "oklch(0.68 0.18 120)",
  "oklch(0.66 0.20 340)",
  "oklch(0.72 0.14 80)",
  "oklch(0.64 0.18 260)",
];

export function getChartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

// 포트폴리오 계산 헬퍼
export function calcPnlRate(pnl: number, cost: number): number {
  if (cost === 0) return 0;
  return (pnl / cost) * 100;
}
