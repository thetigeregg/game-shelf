import {
  EMULATORJS_PINNED_PATH_TO_DATA,
  EMULATORJS_REMOTE_BASE_PATH,
} from '../config/emulatorjs.constants';

const DEFAULT_PLAY_SHELL_PATH = '/assets/emulatorjs/play.html';
const DEFAULT_PATH_TO_DATA = EMULATORJS_PINNED_PATH_TO_DATA;
const SELF_HOSTED_PATH_TO_DATA = '/assets/emulatorjs/data/';

export interface BuildEmulatorJsPlayShellUrlParams {
  /** Page origin, e.g. `https://example.com` (no trailing slash). */
  origin: string;
  core: string;
  /** Absolute or same-origin ROM URL (validated in play shell). */
  romUrl: string;
  gameTitle?: string | null;
  pathToData: string;
  /** Same-origin absolute BIOS asset URL under the normalized `biosBaseUrl` (validated; optional). */
  biosUrl?: string | null;
  /** Same-origin BIOS base path (defaults to `/bios`). */
  biosBaseUrl?: string | null;
  /** Same-origin ROM base path (defaults to `/roms`). */
  romBaseUrl?: string | null;
  /** When true, appends `debug=1` so the play shell sets `EJS_DEBUG_XX` (verbose logs, unminified scripts). */
  debug?: boolean;
  /** Override play shell path for tests. */
  playShellPath?: string;
  /**
   * EmulatorJS preset shader value (e.g. `crt-lottes` or `crt-geom.glslp`).
   * Omitted from the URL when null/empty. Validated with `isSafeEmulatorJsShaderFileName`.
   */
  defaultShader?: string | null;
  /** Optional script integrity value for `loader.js` (e.g. `sha384-...`). */
  loaderIntegrity?: string | null;
}

/** Single-segment shader preset value safe to pass in the play shell query string. */
export function isSafeEmulatorJsShaderFileName(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    return false;
  }

  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\.glslp)?$/.test(trimmed);
}

function getAllowedPathToDataPrefixes(pageOrigin: string): string[] {
  const normalizedOrigin = pageOrigin.replace(/\/+$/, '');
  return [new URL(SELF_HOSTED_PATH_TO_DATA, `${normalizedOrigin}/`).href, DEFAULT_PATH_TO_DATA];
}

function isTrustedRemotePathToData(url: URL, normalizedUrl: string): boolean {
  const normalizedBase = EMULATORJS_REMOTE_BASE_PATH.replace(/\/+$/, '/');
  return (
    url.protocol === 'https:' &&
    normalizedUrl.startsWith(normalizedBase) &&
    /^\/game-shelf-assets\/third-party\/emulatorjs\/[^/]+\/?$/.test(url.pathname)
  );
}

function normalizePathToData(value: string, pageOrigin: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return DEFAULT_PATH_TO_DATA;
  }

  const normalizedPageOrigin = pageOrigin.replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed, `${normalizedPageOrigin}/`);
  } catch {
    throw new Error('Invalid EmulatorJS pathToData URL');
  }

  const normalized = parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/`;
  const allowedPrefixes = getAllowedPathToDataPrefixes(pageOrigin);
  if (allowedPrefixes.includes(normalized)) {
    if (normalized === DEFAULT_PATH_TO_DATA && parsed.protocol !== 'https:') {
      throw new Error('Invalid EmulatorJS pathToData URL');
    }
    return normalized;
  }

  if (isTrustedRemotePathToData(parsed, normalized)) {
    return normalized;
  }
  throw new Error('Invalid EmulatorJS pathToData URL');
}

function normalizeBiosBasePath(value: string | null | undefined): string {
  const baseRaw = typeof value === 'string' ? value.trim() : '';
  const normalizedBase = (baseRaw.length === 0 ? '/bios' : baseRaw).replace(/\/+$/, '');
  return normalizedBase.startsWith('/') ? normalizedBase : `/${normalizedBase}`;
}

function normalizeRomBasePath(value: string | null | undefined): string {
  const baseRaw = typeof value === 'string' ? value.trim() : '';
  const normalizedBase = (baseRaw.length === 0 ? '/roms' : baseRaw).replace(/\/+$/, '');
  return normalizedBase.startsWith('/') ? normalizedBase : `/${normalizedBase}`;
}

function containsDotSegments(pathname: string): boolean {
  const segments = pathname.split('/');
  for (let i = 0; i < segments.length; i += 1) {
    let segment = segments[i];
    if (segment === '.' || segment === '..') {
      return true;
    }
    let decoded = segment;
    for (let j = 0; j < 3; j += 1) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        return true;
      }
      if (decoded === '.' || decoded === '..') {
        return true;
      }
      if (decoded === segment) {
        break;
      }
      segment = decoded;
    }
  }

  return false;
}

/** Restricts core names to a simple token (mirrors `play.html`). */
export function isSafeEmulatorJsCoreToken(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) {
    return false;
  }

  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(trimmed);
}

/**
 * Builds the same-origin play shell URL passed to the EmulatorJS iframe.
 * ROM and BIOS allowlisting is enforced in `play.html`.
 */
export function buildEmulatorJsPlayShellUrl(params: BuildEmulatorJsPlayShellUrlParams): string {
  const normalizedOrigin = params.origin.replace(/\/+$/, '');
  const coreCandidate = params.core.trim();
  if (!isSafeEmulatorJsCoreToken(coreCandidate)) {
    throw new Error('Invalid emulator core for EmulatorJS play shell');
  }
  const shellPath = params.playShellPath ?? DEFAULT_PLAY_SHELL_PATH;
  const pageUrl = new URL(
    shellPath.startsWith('/') ? shellPath : `/${shellPath}`,
    `${normalizedOrigin}/`
  );

  pageUrl.searchParams.set('core', coreCandidate);

  const resolvedRom = new URL(params.romUrl, `${normalizedOrigin}/`);
  const normalizedRomBasePath = normalizeRomBasePath(params.romBaseUrl);
  if (!isAllowedEmulatorJsRomUrl(resolvedRom.href, normalizedOrigin, normalizedRomBasePath)) {
    throw new Error('Invalid ROM URL for EmulatorJS play shell');
  }
  pageUrl.searchParams.set('rom', resolvedRom.href);
  if (normalizedRomBasePath !== '/roms') {
    pageUrl.searchParams.set('rombase', normalizedRomBasePath);
  }

  const title = typeof params.gameTitle === 'string' ? params.gameTitle.trim() : '';
  if (title.length > 0) {
    pageUrl.searchParams.set('title', title);
  }

  pageUrl.searchParams.set('pathtodata', normalizePathToData(params.pathToData, normalizedOrigin));

  if (params.debug === true) {
    pageUrl.searchParams.set('debug', '1');
  }

  const biosCandidate = typeof params.biosUrl === 'string' ? params.biosUrl.trim() : '';
  if (biosCandidate.length > 0) {
    const normalizedBiosBasePath = normalizeBiosBasePath(params.biosBaseUrl);
    if (!isAllowedEmulatorJsBiosUrl(biosCandidate, normalizedOrigin, normalizedBiosBasePath)) {
      throw new Error('Invalid BIOS URL for EmulatorJS play shell');
    }
    let resolvedBios: URL;
    try {
      resolvedBios = new URL(biosCandidate, `${normalizedOrigin}/`);
    } catch {
      throw new Error('Invalid BIOS URL for EmulatorJS play shell');
    }
    if (!isAllowedEmulatorJsBiosUrl(resolvedBios.href, normalizedOrigin, normalizedBiosBasePath)) {
      throw new Error('Invalid BIOS URL for EmulatorJS play shell');
    }
    pageUrl.searchParams.set('bios', resolvedBios.href);
    if (normalizedBiosBasePath !== '/bios') {
      pageUrl.searchParams.set('biosbase', normalizedBiosBasePath);
    }
  }

  const shaderCandidate =
    typeof params.defaultShader === 'string' ? params.defaultShader.trim() : '';
  if (shaderCandidate.length > 0) {
    if (!isSafeEmulatorJsShaderFileName(shaderCandidate)) {
      throw new Error('Invalid default shader for EmulatorJS play shell');
    }
    pageUrl.searchParams.set('shader', shaderCandidate);
  }

  const loaderIntegrity =
    typeof params.loaderIntegrity === 'string' ? params.loaderIntegrity.trim() : '';
  if (loaderIntegrity.length > 0) {
    if (!isValidEmulatorJsLoaderIntegrity(loaderIntegrity)) {
      throw new Error('Invalid loader integrity for EmulatorJS play shell');
    }
    pageUrl.searchParams.set('loader_integrity', loaderIntegrity);
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
 * Returns null if the path is unsafe or the result is not under the normalized `biosBaseUrl`.
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
  const basePath = normalizeBiosBasePath(biosBaseUrl);

  let resolved: URL;
  try {
    resolved = new URL(biosRelativePath, `${origin}${basePath}/`);
  } catch {
    return null;
  }

  if (!isAllowedEmulatorJsBiosUrl(resolved.href, origin, basePath)) {
    return null;
  }

  return resolved.href;
}

/** Same-origin BIOS-base-path check (mirrors play shell rules) for unit tests. */
export function isAllowedEmulatorJsBiosUrl(
  biosUrl: string,
  pageOrigin: string,
  biosBaseUrl = '/bios'
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(biosUrl, `${pageOrigin.replace(/\/+$/, '')}/`);
  } catch {
    return false;
  }

  const origin = pageOrigin.replace(/\/+$/, '');
  if (parsed.origin !== origin || parsed.username.length > 0 || parsed.password.length > 0) {
    return false;
  }

  const basePath = normalizeBiosBasePath(biosBaseUrl);
  const prefix = `${basePath}/`;
  return !containsDotSegments(parsed.pathname) && parsed.pathname.startsWith(prefix);
}

/** Same-origin `/roms/` check (mirrors play shell rules) for unit tests. */
export function isAllowedEmulatorJsRomUrl(
  romUrl: string,
  pageOrigin: string,
  romBaseUrl = '/roms'
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(romUrl, `${pageOrigin.replace(/\/+$/, '')}/`);
  } catch {
    return false;
  }

  const origin = pageOrigin.replace(/\/+$/, '');
  if (parsed.origin !== origin || parsed.username.length > 0 || parsed.password.length > 0) {
    return false;
  }

  const basePath = normalizeRomBasePath(romBaseUrl);
  const prefix = `${basePath}/`;
  return !containsDotSegments(parsed.pathname) && parsed.pathname.startsWith(prefix);
}

const EMULATORJS_LOADER_INTEGRITY_PATTERN = /^(?:sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/;

export function isValidEmulatorJsLoaderIntegrity(value: string): boolean {
  return EMULATORJS_LOADER_INTEGRITY_PATTERN.test(value.trim());
}
