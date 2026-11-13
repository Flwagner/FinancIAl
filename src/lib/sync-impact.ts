import { livePositions, type MarketData } from './market';
import { percent, summarize, type Reading } from './portfolio';

export type SyncImpact = {
  before_rate: number;
  after_rate: number;
  synced_at: string;
  portfolio_updated_at: string;
  partial: boolean;
};

// Compare the SAME holdings against two market snapshots, never two portfolios.
export function calculateSyncImpact(reading: Reading, before: MarketData, after: MarketData, now = new Date()) {
  const rate = (market: MarketData) => {
    const live = livePositions(reading, market, now);
    return summarize(live.positions, live.categoryRates).rate;
  };
  return { before_rate: rate(before), after_rate: rate(after) };
}

export function impactPresentation(before: number, after: number) {
  // Compare displayed hundredths, avoiding a green +0 or hidden changes.
  const rounded = (rate: number) => Math.round(Number(new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, useGrouping: false }).format(rate)) * 100);
  const delta = rounded(after) - rounded(before);
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const points = `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Math.abs(delta) / 100)} point${Math.abs(delta) > 100 ? 's' : ''}`;
  return { direction, points, transition: `${percent(before)} → ${percent(after)}` };
}

export function applicableImpact(impact: SyncImpact | null | undefined) {
  if (!impact || !Number.isFinite(impact.before_rate) || !Number.isFinite(impact.after_rate)) return null;
  return impact;
}

export function impactContextChanged(impact: SyncImpact, rate: number) {
  // An updated timestamp can reflect goals only, not a change to holdings or returns.
  return !Number.isFinite(rate) || Math.abs(impact.after_rate - rate) > 0.000001;
}
