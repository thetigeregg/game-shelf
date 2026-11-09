/** Rounds to two decimal places (prices, percentages and match scores). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
