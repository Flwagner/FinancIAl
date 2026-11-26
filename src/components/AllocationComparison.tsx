'use client';
import { allocationComparison, euro, percent, percent1, type AllocationTarget } from '@/lib/portfolio';

export default function AllocationComparison({ groups, target }: { groups: { name: string; value: number }[]; target: AllocationTarget }) {
  const rows = allocationComparison(groups, target);
  const hasCapital = groups.some(group => group.value > 0);
  return <div className="allocation-comparison">
    <div className="allocation-key"><span><i />Actuel</span><span><i />Cible</span></div>
    <div className="allocation-columns" aria-hidden="true"><span>Classe d’actifs</span><span>Actuel</span><span>Cible</span><span>Écart</span></div>
    {rows.map(row => <div className="allocation-row" key={row.name}>
      <div className="allocation-values"><strong>{row.name}</strong><span>{hasCapital ? percent(row.actual) : '—'}</span><span>{percent(row.target)}</span><b>{hasCapital ? `${row.gap >= 0.005 ? '+' : ''}${percent(Math.abs(row.gap) < 0.005 ? 0 : row.gap).replace(' %', '')} pts` : '—'}</b></div>
      <div className="allocation-track" role="img" aria-label={`${row.name} : actuel ${percent1(row.actual)}, cible ${percent1(row.target)}`}><span style={{ width: `${Math.min(100, row.actual)}%` }} /><i style={{ left: `${row.target}%` }} /></div>
      <small>{!hasCapital ? 'Écart en euros indisponible sans capital.' : Math.abs(row.euroGap) < 0.5 ? 'À la cible' : `${euro(Math.abs(row.euroGap))} ${row.euroGap < 0 ? 'sous' : 'au-dessus de'} la cible`}</small>
    </div>)}
    <p className="allocation-note">Écarts à patrimoine constant, pas des montants à verser ni des recommandations d’arbitrage.</p>
  </div>;
}
