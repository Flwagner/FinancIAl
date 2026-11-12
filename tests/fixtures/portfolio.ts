import { defaultGoals, type Portfolio, type Position } from '../../src/lib/portfolio';
// Jeu de données fictives réservé aux tests, jamais chargé par l'application.
const positions: Position[] = [
  ['Horizon Pierre', 'SCPI', 'Direct', 28000, 6.5], ['Métropole Europe', 'SCPI', 'Direct', 22000, 7.2], ['Avenir Immo', 'SCPI', 'Direct', 18000, 6],
  ['ETF Monde', 'Actions', 'PEA', 24500, 12], ['ETF Europe', 'Actions', 'PEA', 6500, 9], ['Entreprise', 'Actions', 'PEE', 4500, 8],
  ['Projets immobiliers', 'Bricks', 'Direct', 9000, 8], ['Épargne disponible', 'Livret A', 'Livret A', 12000, 1.7],
  ['Fonds euros', 'Assurance vie (fonds €)', 'Assurance vie', 8000, 3], ['Obligations Europe', 'Obligations', 'CTO', 3500, 4],
  ['Or physique', 'Or', 'Direct', 2500, -2], ['Panier crypto', 'Crypto', 'Direct', 1800, 8], ['Bitcoin', 'Bitcoin', 'Direct', 1200, -10],
].map(([name, category, envelope, amount, rate], i) => ({ id: `demo-${i}`, name: String(name), category: String(category), envelope: String(envelope), code: '', amount: Number(amount), rate: Number(rate) }));
const total = positions.reduce((s, p) => s + p.amount, 0);
export const demo: Portfolio = {
  goals: { ...defaultGoals, capital: 180000, annual: 18000, monthly: 1500 },
  readings: [124000, 126200, 125800, 130600, 132200, 131800, 134900, 137100, 136400, 139200, total].map((value, i) => ({ id: `history-${i}`, date: `2026-${String(i + 1).padStart(2, '0')}-01`, projected: false, total: value, positions: i === 10 ? positions : [] })).concat([{ id: 'projection', date: '2026-12-01', projected: true, total: total + 1200, positions: [] }]),
};
