export function isProviderMatchLocked(payload: Record<string, unknown>, key: string): boolean {
  return payload[key] === true;
}
