export type SimulationLine = {
  id: string; name: string; allocation: number; growth: number; income: number;
  reinvest: boolean; investmentWeight: number;
  sourcePositionId?: string; sourceCategory?: string;
  displayGroup?: string;
};
export type Scenario = {
  id: string; name: string; capital: number; monthly: number; redirect: number;
  lines: SimulationLine[];
};
export type ProjectionPoint = {
  year: number; invested: number; consumed: number; total: number; contributions: number;
  gains: number; annualIncome: number; distributions: number; redirected: number;
  balances: number[];
};
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export function normalizeSimulationInputs(scenario: Scenario): Scenario {
  return { ...scenario, capital: Math.round(scenario.capital), monthly: Math.round(scenario.monthly),
    redirect: Number(scenario.redirect.toFixed(2)) };
}
export function scenarioErrors(s: Scenario): string[] {
  const errors: string[] = [];
  if (!s.name.trim()) errors.push('Donne un nom au scénario.');
  if (!Number.isFinite(s.capital) || s.capital < 0 || s.capital > 1e12) errors.push('Le capital doit être compris entre 0 et 1 000 milliards d’euros.');
  if (!Number.isFinite(s.monthly) || s.monthly < 0 || s.monthly > 1e9) errors.push('Le versement mensuel doit être compris entre 0 et 1 milliard d’euros.');
  if (!Number.isFinite(s.redirect) || s.redirect < 0 || s.redirect > 100) errors.push('La redirection des revenus doit être comprise entre 0 et 100 %.');
  if (!s.lines.length || s.lines.length > 100) errors.push('Ajoute entre 1 et 100 lignes.');
  if (new Set(s.lines.map(l => l.id)).size !== s.lines.length) errors.push('Les identifiants des lignes doivent être uniques.');
  if (s.lines.some(l => !l.name.trim() || typeof l.reinvest !== 'boolean'
    || ![l.allocation, l.growth, l.income, l.investmentWeight].every(Number.isFinite)
    || l.allocation < 0 || l.allocation > 100 || l.investmentWeight < 0 || l.investmentWeight > 100
    || l.growth < -100 || l.growth > 100 || l.income < 0 || l.income > 100)) {
    errors.push('Chaque ligne doit avoir un nom, des répartitions de 0 à 100 %, une variation de −100 à 100 % et des revenus de 0 à 100 %.');
  }
  if (Math.abs(sum(s.lines.map(l => l.allocation)) - 100) > .011) errors.push('L’allocation initiale doit totaliser 100 %.');
  if (Math.abs(sum(s.lines.map(l => l.investmentWeight)) - 100) > .011) errors.push('La répartition des investissements libres doit totaliser 100 %.');
  return errors;
}
// Pas de prélèvement fiscal, d’inflation, de frais ni de rééquilibrage.
// Revenus versés sur le capital de début de mois ; apports en fin de mois.
// La valeur et les revenus sont deux hypothèses distinctes : un ETF capitalisant
// utilise un rendement global dans growth, avec income = 0.
export function projectScenario(s: Scenario, years = 20): ProjectionPoint[] {
  const errors = scenarioErrors(s);
  if (errors.length) throw new Error(errors.join(' '));
  if (!Number.isInteger(years) || years < 1 || years > 30) throw new Error('Horizon invalide.');
  const { capital, monthly, redirect } = normalizeSimulationInputs(s);
  // Tolérance de saisie pour les centièmes : normaliser le léger résidu
  // évite de créer/perdre du capital avec une somme affichée à 99,99 %.
  const allocationTotal = sum(s.lines.map(l => l.allocation));
  const investmentTotal = sum(s.lines.map(l => l.investmentWeight));
  let balances = s.lines.map(l => capital * l.allocation / allocationTotal);
  let contributions = capital, distributions = 0, redirected = 0;
  const points: ProjectionPoint[] = [];
  const point = (year: number) => {
    const invested = sum(balances);
    const total = invested;
    points.push({ year, invested, consumed: distributions - redirected, total, contributions, gains: total - contributions,
      annualIncome: sum(balances.map((b, i) => b * s.lines[i].income / 100)),
      distributions, redirected, balances: [...balances] });
  };
  point(0);
  for (let month = 1; month <= years * 12; month++) {
    let availableIncome = 0;
    balances = balances.map((balance, i) => {
      const l = s.lines[i];
      const income = balance * l.income / 1200;
      const growth = Math.pow(1 + l.growth / 100, 1 / 12);
      if (!l.reinvest) availableIncome += income;
      return balance * growth + (l.reinvest ? income : 0);
    });
    const reinjected = availableIncome * (redirect / 100);
    distributions += availableIncome;
    redirected += reinjected;
    // Les revenus non réinvestis sont consommés, jamais ajoutés au patrimoine.
    contributions += monthly;
    balances = balances.map((b, i) => b + (monthly + reinjected) * s.lines[i].investmentWeight / investmentTotal);
    if (month % 12 === 0) point(month / 12);
  }
  return points;
}
// Lecture défensive : le stockage navigateur peut être ancien ou altéré.
export function parseScenarios(raw: string): Scenario[] | null {
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || value.length < 1 || value.length > 3) return null;
    if (value.some(s => !s || typeof s.id !== 'string' || typeof s.name !== 'string'
      || !Array.isArray(s.lines) || s.lines.some((l: SimulationLine) => !l || typeof l.id !== 'string' || typeof l.name !== 'string')
      || scenarioErrors(s).length)) return null;
    if (new Set(value.map(s => s.id)).size !== value.length) return null;
    return value;
  } catch { return null; }
}
