import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { impactPresentation, type SyncImpact } from '@/lib/sync-impact';

export default function SyncImpactNote({ impact, contextChanged = false }: { impact: SyncImpact; contextChanged?: boolean }) {
  const { direction, points, transition } = impactPresentation(impact.before_rate, impact.after_rate);
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight;
  return <div className="metric-note capital-change-note sync-impact" title={`Synchronisation du ${new Date(impact.synced_at).toLocaleString('fr-FR')}`}>
    <span className="sync-transition">{transition}</span>
    <span className={`capital-change ${direction === 'up' ? 'positive' : direction === 'down' ? 'negative' : 'muted'}`}><Icon size={22} />{points}</span>
    <span>lors de la dernière synchronisation{impact.partial ? ' (partielle)' : ''}</span>
    {contextChanged && <span>Le rendement actuel diffère de ce comparatif : variation conservée à titre indicatif.</span>}
  </div>;
}
