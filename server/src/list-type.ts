export function isDiscoveryListType(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'discovery';
}
