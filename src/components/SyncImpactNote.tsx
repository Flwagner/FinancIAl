import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { dailyImpactLabel, hasDailyReference, impactPresentation, type SyncImpact } from '@/lib/sync-impact';

export default function SyncImpactNote({ impact, contextChanged = false }: { impact: SyncImpact; contextChanged?: boolean }) {
  if (!hasDailyReference(impact)) return <div className="metric-note sync-impact">Référence quotidienne en cours d’initialisation.</div>;
  const { direction, points, transition } = impactPresentation(impact.before_rate, impact.after_rate);
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight;
  const date = (value: string) => new Date(value).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  return <div className="metric-note capital-change-note sync-impact" title={`Référence : ${date(impact.reference_at!)} · Dernière synchronisation : ${date(impact.synced_at)} (heure de Paris). Dernière valeur connue avant minuit, pas une performance intrajournalière du capital.`}>
    <span className="sync-transition">{transition}</span>
    <span className={`capital-change ${direction === 'up' ? 'positive' : direction === 'down' ? 'negative' : 'muted'}`}><Icon size={22} />{points}</span>
    <span>Variation {dailyImpactLabel(impact)}{impact.partial ? ' (synchronisation partielle)' : ''}</span>
    {contextChanged && <span>Placements ou rendement modifiés : ce comparatif est conservé à titre indicatif.</span>}
  </div>;
}
