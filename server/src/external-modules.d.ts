declare module '*.mjs' {
  export function handleRequest(
    request: Request,
    env: Record<string, unknown>,
    fetchImpl: typeof fetch,
    now: () => number
  ): Promise<Response>;
}
