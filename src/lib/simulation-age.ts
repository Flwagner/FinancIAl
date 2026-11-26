// Dates civiles uniquement : pas de décalage de l’anniversaire selon le fuseau.
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function localCalendarDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function ageOnDate(birthDate: string | undefined, date: string): number | null {
  if (!isCalendarDate(birthDate) || !isCalendarDate(date) || date < birthDate) return null;
  const yearDifference = Number(date.slice(0, 4)) - Number(birthDate.slice(0, 4));
  // Pour le 29 février, l’âge change le 1er mars les années non bissextiles.
  return yearDifference - (date.slice(5) < birthDate.slice(5) ? 1 : 0);
}
export function projectionDate(startDate: string, years: number): string | null {
  if (!isCalendarDate(startDate) || !Number.isInteger(years) || years < 0 || years > 120) return null;
  const year = Number(startDate.slice(0, 4)) + years;
  if (year > 9999) return null;
  const month = Number(startDate.slice(5, 7));
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(Number(startDate.slice(8)), maxDay)).padStart(2, '0')}`;
}
export function projectionAge(birthDate: string | undefined, startDate: string, years: number) {
  const date = projectionDate(startDate, years);
  return date ? ageOnDate(birthDate, date) : null;
}
export function calendarDateLabel(date: string) {
  return isCalendarDate(date) ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)) : '';
}
