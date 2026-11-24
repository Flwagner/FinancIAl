export type DistributionSlice = { name: string; value: number };

// Seuil strict sur les valeurs brutes : une part de 1 % reste distincte.
// Fusionner aussi la catégorie « Autres » existante pour ne pas la dupliquer.
export function groupSmallSlices(data: DistributionSlice[], otherLabel = 'Autres'): DistributionSlice[] {
  const positive = data.filter(d => Number.isFinite(d.value) && d.value > 0);
  const total = positive.reduce((s, d) => s + d.value, 0);
  const result: DistributionSlice[] = [];
  let other = 0;
  for (const d of positive) {
    if (d.name === otherLabel || d.value < total / 100) other += d.value;
    else result.push({ ...d });
  }
  if (other > 0) result.push({ name: otherLabel, value: other });
  return result;
}
