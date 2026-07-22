import axios from "axios";
import https from "https";

// 샌드박스 환경에서 SSL 인증서 검증 실패 대응
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ─── 미국주식 현재가 (Yahoo Finance) ─────────────────────────────────────────

export async function getUsStockPrice(ticker: string): Promise<{
  ticker: string;
  price: number;
  currency: string;
  name: string;
} | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
      httpsAgent,
      timeout: 8000,
    });

    const result = response.data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const price = meta.regularMarketPrice ?? meta.previousClose;
    const name = meta.longName ?? meta.shortName ?? ticker;

    return {
      ticker: ticker.toUpperCase(),
      price: Number(price),
      currency: meta.currency ?? "USD",
      name,
    };
  } catch (err) {
    console.error(`[MarketData] Failed to fetch US stock price for ${ticker}:`, err);
    return null;
  }
}

// ─── 국내주식 현재가 (네이버 금융) ───────────────────────────────────────────

export async function getKrStockPrice(ticker: string): Promise<{
  ticker: string;
  price: number;
  currency: string;
  name: string;
} | null> {
  try {
    // 네이버 금융 API (비공식)
    const url = `https://m.stock.naver.com/api/stock/${encodeURIComponent(ticker)}/basic`;
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://m.stock.naver.com/",
      },
      httpsAgent,
      timeout: 8000,
    });

    const data = response.data;
    if (!data) return null;

    const price = Number(data.closePrice?.replace(/,/g, "") ?? data.stockEndPrice?.replace(/,/g, ""));
    const name = data.stockName ?? data.itemName ?? ticker;

    if (isNaN(price) || price === 0) return null;

    return {
      ticker: ticker,
      price,
      currency: "KRW",
      name,
    };
  } catch (err) {
    console.error(`[MarketData] Failed to fetch KR stock price for ${ticker}:`, err);
    return null;
  }
}

// ─── USD/KRW 환율 (한국수출입은행 API) ───────────────────────────────────────

export async function getUsdKrwRate(): Promise<number | null> {
  try {
    // 한국수출입은행 환율 API (공개 API, 인증 불필요)
    const today = new Date();
    const dateStr = formatDate(today);

    const url = `https://www.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=DEMO&searchdate=${dateStr}&data=AP01`;
    const response = await axios.get(url, { httpsAgent, timeout: 8000 });

    const data = response.data;
    if (Array.isArray(data)) {
      const usdEntry = data.find((item: any) => item.cur_unit === "USD");
      if (usdEntry) {
        const rate = Number(usdEntry.deal_bas_r?.replace(/,/g, ""));
        if (!isNaN(rate) && rate > 0) return rate;
      }
    }

    // Fallback: Yahoo Finance USD/KRW
    return await getUsdKrwFromYahoo();
  } catch (err) {
    console.error("[MarketData] Failed to fetch USD/KRW from Koreaexim:", err);
    return await getUsdKrwFromYahoo();
  }
}

async function getUsdKrwFromYahoo(): Promise<number | null> {
  try {
    const url =
      "https://query1.finance.yahoo.com/v8/finance/chart/USDKRW=X?interval=1d&range=1d";
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      httpsAgent,
      timeout: 8000,
    });
    const meta = response.data?.chart?.result?.[0]?.meta;
    const rate = meta?.regularMarketPrice ?? meta?.previousClose;
    return rate ? Number(rate) : null;
  } catch (err) {
    console.error("[MarketData] Failed to fetch USD/KRW from Yahoo:", err);
    return null;
  }
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// ─── 국내주식 종목 검색 (네이버 증권 자동완성 API) ──────────────────────────────

export async function searchKrTicker(query: string): Promise<
  Array<{ ticker: string; name: string; market: string }>
> {
  try {
    const url = `https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=stock,index`;
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://finance.naver.com/",
      },
      httpsAgent,
      timeout: 6000,
    });

    const items = response.data?.items ?? [];
    return items
      .filter((item: any) =>
        item.category === "stock" &&
        item.nationCode === "KOR" &&
        (item.typeCode === "KOSPI" || item.typeCode === "KOSDAQ")
      )
      .slice(0, 8)
      .map((item: any) => ({
        ticker: item.code,
        name: item.name,
        market: item.typeCode, // "KOSPI" | "KOSDAQ"
      }));
  } catch (err) {
    console.error("[MarketData] Failed to search KR ticker:", err);
    return [];
  }
}

// ─── 종목명 검색 (Yahoo Finance) ─────────────────────────────────────────────

export async function searchUsTicker(query: string): Promise<
  Array<{ ticker: string; name: string; exchange: string }>
> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      httpsAgent,
      timeout: 8000,
    });

    const quotes = response.data?.quotes ?? [];
    return quotes
      .filter((q: any) => q.quoteType === "EQUITY" || q.quoteType === "ETF")
      .slice(0, 6)
      .map((q: any) => ({
        ticker: q.symbol,
        name: q.longname ?? q.shortname ?? q.symbol,
        exchange: q.exchange ?? "",
      }));
  } catch (err) {
    console.error("[MarketData] Failed to search US ticker:", err);
    return [];
  }
}
