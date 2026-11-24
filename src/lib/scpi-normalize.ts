import { validateScpiImport, type ScpiImport } from './scpi';

type RawPosition = { scpiUrlId: string; scpiName: string; nbShares: number; investedAmount: number; buyingPrice: number; sellingPrice: number; ownership: string[] };
type RawFact = { urlId: string; pageUrl: string; distributionRate?: number; assetTypes?: Record<string, number>; geographyDistribution?: Record<string, number>; performanceHistory?: { year: number; period: string; distributionRate?: number }[] };
type RawTransaction = { transactionId: string; scpiUrlId: string; executionDate: string; direction: string; nbShares: number; amount: number; ownership: string; isExternal: boolean; inProgress: boolean; status: { code: string; label: string } };
export type LouveBundle = {
  portfolio: { date: string; scpi: { buyingPrice: number; investedAmount: number; sellingPrice: number; positions: RawPosition[] } };
  facts: RawFact[];
  transactionPages: { page: number; total: number; hasMore: boolean; transactions: RawTransaction[] }[];
};
export function normalizeLouve(bundle: LouveBundle): ScpiImport {
  const { portfolio, facts, transactionPages } = bundle;
  const pages = [...transactionPages].sort((a, b) => a.page - b.page);
  if (!pages.length || pages.some((p, i) => p.page !== i + 1 || p.total !== pages[0].total || p.hasMore !== (i < pages.length - 1)) || pages.flatMap(p => p.transactions).length !== pages[0].total) throw new Error('Pagination des transactions incomplète.');
  const source = portfolio.scpi;
  for (const [total, field] of [[source.buyingPrice, 'buyingPrice'], [source.investedAmount, 'investedAmount'], [source.sellingPrice, 'sellingPrice']] as const) {
    if (!Number.isFinite(total) || Math.abs(source.positions.reduce((s, p) => s + p[field], 0) - total) > 0.1) throw new Error('Les positions ne correspondent pas aux totaux Louve.');
  }
  const year = Number(portfolio.date.slice(0, 4)) - 1;
  const result: ScpiImport = {
    version: 1, source: 'louve', complete: true, capturedAt: portfolio.date,
    positions: source.positions.map(p => {
      const fact = facts.find(f => f.urlId === p.scpiUrlId);
      if (!fact) throw new Error(`Fiche absente : ${p.scpiUrlId}.`);
      const annual = fact.performanceHistory?.filter(h => h.year === year && h.period === 'FY');
      if (annual && annual.length > 1) throw new Error('Plusieurs taux annuels pour la même année.');
      const annualRate = annual?.[0]?.distributionRate;
      const publicRate = annualRate ?? fact.distributionRate;
      const generalFallback = annualRate === undefined && fact.distributionRate !== undefined;
      // Une nue-propriété ne distribue pas de loyers. Les détentions mixtes
      // exigent un détail de droits : ne pas leur affecter le taux pleine propriété.
      const rate = p.ownership.length === 1 && p.ownership[0] === 'Nue-propriété' ? 0
        : p.ownership.length === 1 && p.ownership[0] === 'Pleine propriété' ? publicRate : undefined;
      const reference = generalFallback && p.ownership[0] !== 'Nue-propriété' ? 'general' : 'annual';
      return { id: p.scpiUrlId, name: p.scpiName, shares: p.nbShares, invested: p.investedAmount, buyingValue: p.buyingPrice, withdrawalValue: p.sellingPrice, ownership: p.ownership, ...(rate === undefined ? {} : { rate: Math.round(rate * 1e10) / 1e8, rateReference: reference, ...(reference === 'annual' ? { rateYear: year } : {}) }) };
    }),
    facts: facts.filter(f => source.positions.some(p => p.scpiUrlId === f.urlId)).map(f => ({
      id: f.urlId, sourceUrl: f.pageUrl, sectors: f.assetTypes ?? {},
      // Les clés FRA_* sont des sous-totaux : si FRA existe, ne pas les
      // additionner. Sans total France, consolider ses sous-régions.
      countries: Object.entries(f.geographyDistribution ?? {}).reduce<Record<string, number>>((acc, [key, weight]) => {
        if (key.startsWith('FRA_')) { if (f.geographyDistribution?.FRA === undefined) acc.FRA = (acc.FRA ?? 0) + weight; }
        else acc[key] = weight;
        return acc;
      }, {}),
      // Le MCP ne date pas nécessairement les répartitions. La date de la
      // dernière performance n'est PAS une preuve de leur date d'arrêté.
    })),
    transactions: pages.flatMap(p => p.transactions).map(t => {
      if (!['Achat', 'Vente'].includes(t.direction)) throw new Error('Sens de transaction inconnu.');
      return { id: t.transactionId, scpiId: t.scpiUrlId, date: t.executionDate, direction: t.direction === 'Achat' ? 'buy' : 'sell', shares: t.nbShares, amount: t.amount, ownership: t.ownership, external: t.isExternal, inProgress: t.inProgress, status: t.status.label };
    }),
  };
  validateScpiImport(result);
  return result;
}
