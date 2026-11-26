// Référence indépendante : aucun import du moteur de l’application.
// La transformation mensuelle est une matrice affine élevée à 12 × années
// par exponentiation rapide, et non une nouvelle boucle de simulation mensuelle.
export type OraclePocket = {
  name: string; allocation: number; growth: number; income: number;
  reinvest: boolean; investmentWeight: number;
};
export type OraclePlan = { capital: number; monthly: number; redirect: number; pockets: OraclePocket[] };
type Matrix = number[][];
function multiply(a: Matrix, b: Matrix): Matrix {
  return a.map(row => b[0].map((_, column) => row.reduce((value, factor, k) => value + factor * b[k][column], 0)));
}
function power(matrix: Matrix, exponent: number): Matrix {
  let result: Matrix = matrix.map((row, i) => row.map((_, j) => i === j ? 1 : 0));
  let factor = matrix;
  for (let n = exponent; n > 0; n = Math.floor(n / 2)) {
    if (n % 2 === 1) result = multiply(result, factor);
    factor = multiply(factor, factor);
  }
  return result;
}
export function referenceProjection(plan: OraclePlan, years: number) {
  const count = plan.pockets.length;
  const consumedIndex = count, distributedIndex = count + 1, redirectedIndex = count + 2, constantIndex = count + 3;
  const size = count + 4;
  const matrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const allocationTotal = plan.pockets.reduce((sum, pocket) => sum + pocket.allocation, 0);
  const investmentTotal = plan.pockets.reduce((sum, pocket) => sum + pocket.investmentWeight, 0);
  const redirectedFraction = plan.redirect / 100;
  const distributedRates = plan.pockets.map(p => p.reinvest ? 0 : p.income / 1200);
  plan.pockets.forEach((pocket, i) => {
    const weight = pocket.investmentWeight / investmentTotal;
    const monthlyGrowth = Math.exp(Math.log1p(pocket.growth / 100) / 12);
    matrix[i][i] = monthlyGrowth + (pocket.reinvest ? pocket.income / 1200 : 0);
    distributedRates.forEach((rate, j) => { matrix[i][j] += weight * redirectedFraction * rate; });
    matrix[i][constantIndex] = plan.monthly * weight;
  });
  for (let j = 0; j < count; j++) {
    matrix[consumedIndex][j] = (1 - redirectedFraction) * distributedRates[j];
    matrix[distributedIndex][j] = distributedRates[j];
    matrix[redirectedIndex][j] = redirectedFraction * distributedRates[j];
  }
  for (const i of [consumedIndex, distributedIndex, redirectedIndex, constantIndex]) matrix[i][i] = 1;
  const initial = [...plan.pockets.map(p => plan.capital * p.allocation / allocationTotal), 0, 0, 0, 1];
  const end = power(matrix, years * 12).map(row => row.reduce((sum, value, i) => sum + value * initial[i], 0));
  const balances = end.slice(0, count);
  const invested = balances.reduce((sum, balance) => sum + balance, 0);
  const consumed = end[consumedIndex];
  const total = invested;
  const contributions = plan.capital + plan.monthly * years * 12;
  return {
    balances, invested, consumed, total, contributions, gains: total - contributions,
    annualIncome: balances.reduce((sum, balance, i) => sum + balance * plan.pockets[i].income / 100, 0),
    distributions: end[distributedIndex], redirected: end[redirectedIndex],
  };
}
