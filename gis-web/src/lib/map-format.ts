import type { Survey } from './sites.ts';

export const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
export const area = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const coordinate = new Intl.NumberFormat('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 5 });

type Round = { date: string; average: number; count: number };

export function surveyRounds(items: Survey[]): Round[] {
  const byDate = new Map<string, number[]>();
  for (const item of items) byDate.set(item.surveyed_on, [...(byDate.get(item.surveyed_on) ?? []), item.cover_percent]);
  return Array.from(byDate, ([date, covers]) => ({
    date,
    average: covers.reduce((sum, value) => sum + value, 0) / covers.length,
    count: covers.length,
  })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
