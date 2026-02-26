export function normalizeHttpError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') {
    return { value: String(error) };
  }

  const source = error as Record<string, unknown>;
  return {
    name: typeof source['name'] === 'string' ? source['name'] : null,
    message: typeof source['message'] === 'string' ? source['message'] : null,
    status: typeof source['status'] === 'number' ? source['status'] : null,
    statusText: typeof source['statusText'] === 'string' ? source['statusText'] : null,
    url: typeof source['url'] === 'string' ? source['url'] : null,
    ok: typeof source['ok'] === 'boolean' ? source['ok'] : null
  };
}
