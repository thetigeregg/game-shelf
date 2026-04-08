const DEFAULT_PLAY_SHELL_PATH = '/assets/emulatorjs/play.html';

export interface BuildEmulatorJsPlayShellUrlParams {
  /** Page origin, e.g. `https://example.com` (no trailing slash). */
  origin: string;
  core: string;
  /** Absolute or same-origin ROM URL (validated in play shell). */
  romUrl: string;
  gameTitle?: string | null;
  pathToData: string;
  /** Same-origin absolute BIOS asset URL under `/bios/` (validated; optional). */
  biosUrl?: string | null;
  /** When true, appends `debug=1` so the play shell sets `EJS_DEBUG_XX` (verbose logs, unminified scripts). */
  debug?: boolean;
  /** Override play shell path for tests. */
  playShellPath?: string;
}

function normalizePathToData(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'https://cdn.emulatorjs.org/stable/data/';
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/**
 * Builds the same-origin play shell URL passed to the EmulatorJS iframe.
 * ROM and BIOS allowlisting is enforced in `play.html`.
 */
export function buildEmulatorJsPlayShellUrl(params: BuildEmulatorJsPlayShellUrlParams): string {
  const normalizedOrigin = params.origin.replace(/\/+$/, '');
  const shellPath = params.playShellPath ?? DEFAULT_PLAY_SHELL_PATH;
  const pageUrl = new URL(
    shellPath.startsWith('/') ? shellPath : `/${shellPath}`,
    `${normalizedOrigin}/`
  );

  pageUrl.searchParams.set('core', params.core);

  const resolvedRom = new URL(params.romUrl, `${normalizedOrigin}/`);
  pageUrl.searchParams.set('rom', resolvedRom.href);

  const title = typeof params.gameTitle === 'string' ? params.gameTitle.trim() : '';
  if (title.length > 0) {
    pageUrl.searchParams.set('title', title);
  }

  pageUrl.searchParams.set('pathtodata', normalizePathToData(params.pathToData));

  if (params.debug === true) {
    pageUrl.searchParams.set('debug', '1');
  }

  const biosCandidate = typeof params.biosUrl === 'string' ? params.biosUrl.trim() : '';
  if (biosCandidate.length > 0) {
    if (!isAllowedEmulatorJsBiosUrl(biosCandidate, normalizedOrigin)) {
      throw new Error('Invalid BIOS URL for EmulatorJS play shell');
    }
    let resolvedBios: URL;
    try {
      resolvedBios = new URL(biosCandidate, `${normalizedOrigin}/`);
    } catch {
      throw new Error('Invalid BIOS URL for EmulatorJS play shell');
    }
    if (!isAllowedEmulatorJsBiosUrl(resolvedBios.href, normalizedOrigin)) {
      throw new Error('Invalid BIOS URL for EmulatorJS play shell');
    }
    pageUrl.searchParams.set('bios', resolvedBios.href);
  }

  return pageUrl.href;
}

/** Rejects path traversal and absolute paths (mirrors safe relative paths under the BIOS mount). */
export function isSafeEmulatorJsBiosRelativePath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.startsWith('/')) {
    return false;
  }

  for (const segment of trimmed.split('/')) {
    if (segment.length === 0 || segment === '.' || segment === '..') {
      return false;
    }
  }

  return true;
}

/**
 * Builds an absolute same-origin BIOS URL under `biosBaseUrl` (e.g. `/bios`).
 * Returns null if the path is unsafe or the result is not under `/bios/`.
 */
export function buildEmulatorJsBiosUrl(
  pageOrigin: string,
  biosBaseUrl: string,
  biosRelativePath: string
): string | null {
  if (!isSafeEmulatorJsBiosRelativePath(biosRelativePath)) {
    return null;
  }

  const origin = pageOrigin.replace(/\/+$/, '');
  const baseRaw = biosBaseUrl.trim();
  const normalizedBase = (baseRaw.length === 0 ? '/bios' : baseRaw).replace(/\/+$/, '');
  const basePath = normalizedBase.startsWith('/') ? normalizedBase : `/${normalizedBase}`;

  let resolved: URL;
  try {
    resolved = new URL(biosRelativePath, `${origin}${basePath}/`);
  } catch {
    return null;
  }

  if (!isAllowedEmulatorJsBiosUrl(resolved.href, origin)) {
    return null;
  }

  return resolved.href;
}

/** Same-origin `/bios/` check (mirrors play shell rules) for unit tests. */
export function isAllowedEmulatorJsBiosUrl(biosUrl: string, pageOrigin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(biosUrl, `${pageOrigin.replace(/\/+$/, '')}/`);
  } catch {
    return false;
  }

  const origin = pageOrigin.replace(/\/+$/, '');
  if (parsed.origin !== origin) {
    return false;
  }

  return parsed.pathname.startsWith('/bios/');
}

/** Same-origin `/roms/` check (mirrors play shell rules) for unit tests. */
export function isAllowedEmulatorJsRomUrl(romUrl: string, pageOrigin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(romUrl, `${pageOrigin.replace(/\/+$/, '')}/`);
  } catch {
    return false;
  }

  const origin = pageOrigin.replace(/\/+$/, '');
  if (parsed.origin !== origin) {
    return false;
  }

  return parsed.pathname.startsWith('/roms/');
}
