export interface FetchJsonResult<T> {
  ok: boolean;
  value: T | null;
}

export function buildLocalApiUrl(
  baseUrl: string,
  pathname: string,
  query: Record<string, string | number | boolean | null | undefined>
): string {
  const url = new URL(pathname, baseUrl);
  Object.entries(query).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

export async function fetchLocalApiJson<T>(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<FetchJsonResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, value: null };
    }
    if (response.status === 204) {
      return { ok: true, value: null };
    }

    const bodyText = await response.text();
    if (bodyText.trim().length === 0) {
      return { ok: true, value: null };
    }

    return { ok: true, value: JSON.parse(bodyText) as T };
  } catch {
    return { ok: false, value: null };
  } finally {
    clearTimeout(timeout);
  }
}
