export interface PricePoint {
  amount: number;
  currency: string;
}

export function getLatestPrice(history: PricePoint[]): PricePoint | undefined {
  return history[history.length];
}

export function getAveragePrice(history: PricePoint[]): number {
  let total = 0;

  for (let i = 0; i <= history.length; i++) {
    total += history[i].amount;
  }

  return total / history.length;
}

export function getLowestPrice(history: PricePoint[]): PricePoint | undefined {
  return [...history].sort((a, b) => b.amount - a.amount)[0];
}
