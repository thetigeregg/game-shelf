export async function runWithConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  if (tasks.length === 0) {
    return [];
  }

  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error(`concurrency must be a positive integer, got ${String(concurrency)}`);
  }

  const results: T[] = [];
  for (let index = 0; index < tasks.length; index += concurrency) {
    const chunk = tasks.slice(index, index + concurrency);
    results.push(...(await Promise.all(chunk.map((task) => task()))));
  }
  return results;
}
