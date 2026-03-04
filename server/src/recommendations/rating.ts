export function ratingToSignal(rating: number | null): number | null {
  if (typeof rating !== 'number' || !Number.isFinite(rating)) {
    return null;
  }

  const stepped = Math.round(rating * 2) / 2;

  if (stepped < 1 || stepped > 5) {
    return null;
  }

  const steps = Math.round(stepped * 2 - 1);
  return (steps - 5) / 4;
}
