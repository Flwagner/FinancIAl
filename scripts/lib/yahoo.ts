import { calculateReturn, type MarketPrice, type MarketReturn } from '../../src/lib/market';

type ChartResult = {
  meta: { symbol: string; currency: string; exchangeTimezoneName: string };
  timestamp: number[];
  indicators: { quote: { close: (number | null)[] }[]; adjclose?: { adjclose: (number | null)[] }[] };
};

export function parseYahooChart(payload: unknown, expectedSymbol: string, expectedCurrency: string): MarketPrice[] {
  const chart = (payload as { chart?: { error?: unknown; result?: ChartResult[] } })?.chart;
  const result = chart?.result?.[0];
  if (!result || chart?.error) throw new Error('Réponse Yahoo Finance indisponible.');
  if (result.meta?.symbol !== expectedSymbol || result.meta.currency !== expectedCurrency) throw new Error('Instrument ou devise inattendus : synchronisation refusée.');
  const closes = result.indicators?.quote?.[0]?.close;
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose;
  if (!Array.isArray(result.timestamp) || !Array.isArray(closes) || !Array.isArray(adjusted)) throw new Error('Historique ajusté absent.');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: result.meta.exchangeTimezoneName, year: 'numeric', month: '2-digit', day: '2-digit' });
  const prices: MarketPrice[] = [];
  result.timestamp.forEach((timestamp, index) => {
    // Les jours sans cotation peuvent être fournis comme lignes entièrement nulles.
    if (closes[index] == null && adjusted[index] == null) return;
    if (closes[index] == null || adjusted[index] == null) throw new Error('Clôture sans cours ajusté : calcul refusé.');
    prices.push({ date: formatter.format(new Date(timestamp * 1000)), close: closes[index]!, adjusted_close: adjusted[index]! });
  });
  return prices;
}

export async function fetchYahooReturn(symbol: string, currency: string, now = new Date(), request: typeof fetch = fetch): Promise<{ prices: MarketPrice[]; performance: MarketReturn }> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.search = new URLSearchParams({ range: '2y', interval: '1d', events: 'div,splits' }).toString();
  const response = await request(url, { signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Yahoo Finance : HTTP ${response.status}.`);
  const prices = parseYahooChart(await response.json(), symbol, currency);
  const performance = calculateReturn(symbol, currency, prices, now);
  return { prices: prices.filter(p => p.date <= performance.as_of), performance };
}
