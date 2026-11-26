// Paliers lisibles, communs à tous les scénarios visibles.
// La borne supérieure est arrondie vers le haut pour ne couper aucune courbe.
export function projectionAxis(values: number[], startAtMinimum = false) {
  const finite = values.filter(v => Number.isFinite(v) && v >= 0);
  const minimum = startAtMinimum && finite.length ? Math.min(...finite) : 0;
  const maximum = Math.max(0, ...finite);
  const bound = maximum > minimum ? Math.max(1, maximum - minimum) : Math.max(1000, minimum * .05);
  const magnitude = 10 ** Math.floor(Math.log10(bound / 5));
  const ratio = bound / 5 / magnitude;
  const step = ([1, 2, 2.5, 5, 10].find(n => n >= ratio) ?? 10) * magnitude;
  const top = Math.ceil((maximum > minimum ? maximum : minimum + bound) / step) * step;
  const first = Math.ceil(minimum / step);
  const intervals = Math.round(top / step) - first;
  const ticks = [minimum, ...Array.from({ length: intervals + 1 }, (_, i) => Number(((first + i) * step).toPrecision(15)))
    .filter(value => value - minimum >= step / 2)];
  return { domain: [minimum, ticks.at(-1)!] as [number, number], ticks };
}
export function projectionAxisLabel(value: number) {
  return `${new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 2 }).format(value)} €`;
}
