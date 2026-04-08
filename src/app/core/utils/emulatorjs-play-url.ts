const DEFAULT_PLAY_SHELL_PATH = '/assets/emulatorjs/play.html';

export interface BuildEmulatorJsPlayShellUrlParams {
  /** Page origin, e.g. `https://example.com` (no trailing slash). */
  origin: string;
  core: string;
  /** Absolute or same-origin ROM URL (validated in play shell). */
  romUrl: string;
  gameTitle?: string | null;
  pathToData: string;
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

  return pageUrl.href;
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
