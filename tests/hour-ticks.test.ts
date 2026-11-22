import { describe, expect, it } from 'vitest';
import { hourTickLabel, hourTicks } from '../src/features/charts/time';

// A non-leap year starting on January 1.
const LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const dates: [number, number][] = LENGTHS.flatMap((n, m) =>
  Array.from({ length: n }, (_, d) => [m + 1, d + 1] as [number, number]),
);
const hours = dates.length * 24;
const pct = (hour: number) => (hour / hours) * 100;

describe('hourTicks', () => {
  const ticks = hourTicks(dates, hours);

  it('puts one tick on each day of a week, each labeled once', () => {
    // March 2 06:00 to March 8 20:00, as in the house example.
    const start = (31 + 28 + 1) * 24 + 6;
    const values = ticks(pct(start), pct(start + 6 * 24 + 14), 1600);
    const labels = values.map((h) => hourTickLabel(h, dates));
    expect(labels).toEqual(['Mar 3', 'Mar 4', 'Mar 5', 'Mar 6', 'Mar 7', 'Mar 8']);
  });

  it('uses month starts for the whole year', () => {
    const labels = ticks(0, 100, 1000).map((h) => hourTickLabel(h, dates));
    expect(labels.every((l) => l.endsWith(' 1'))).toBe(true);
    expect(labels[0]).toBe('Jan 1');
    expect(labels.length).toBeLessThanOrEqual(12);
  });

  it('labels hours under two days', () => {
    const start = 100 * 24 + 3;
    const labels = ticks(pct(start), pct(start + 30), 800).map((h) => hourTickLabel(h, dates));
    expect(labels).toContain('Apr 12');
    expect(labels.some((l) => l.endsWith(':00'))).toBe(true);
    // Each day is labeled once, at its midnight.
    expect(labels.filter((l) => !l.endsWith(':00'))).toEqual(['Apr 12']);
  });

  it('never repeats a label', () => {
    for (const width of [300, 600, 1200, 1800])
      for (const span of [24 * 3, 24 * 10, 24 * 45, 24 * 200]) {
        const labels = ticks(pct(500), pct(500 + span), width).map((h) => hourTickLabel(h, dates));
        expect(new Set(labels).size).toBe(labels.length);
        expect(labels.length).toBeLessThanOrEqual(Math.floor(width / 80));
      }
  });
});
