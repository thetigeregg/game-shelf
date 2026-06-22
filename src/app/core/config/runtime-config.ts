import { environment } from '../../../environments/environment';
import { readPreference, writePreference } from '../storage/preference-storage.service';

const PERSISTED_RUNTIME_CONFIG_STORAGE_KEY = 'game-shelf:runtime-config:v1';

// Tracks the last value actually written so redundant persists become no-ops.
// resolveRuntimeConfig() runs on every feature-flag read — frequently inside
// change detection (e.g. isTasFeatureEnabled() from a template) — and the live
// path used to persist on every call. Persisting issues an async
// Preferences.set; starting async work on every change-detection pass keeps the
// app from stabilizing and produces an infinite change-detection loop. Writing
// only when the config actually changes prevents that.
let lastPersistedSerializedConfig: string | null = null;

interface RuntimeFeatureFlags {
  showMgcImport?: boolean;
  e2eFixtures?: boolean;
  recommendationsExploreEnabled?: boolean;
  tasEnabled?: boolean;
  requireAuth?: boolean;
}

interface RuntimeConfig {
  appVersion?: string;
  featureFlags?: RuntimeFeatureFlags;
}

export type RuntimeConfigSource = 'live' | 'persisted' | 'default';

export interface AppVersionInfo {
  value: string;
  source: RuntimeConfigSource;
  isFallback: boolean;
}

declare global {
  interface Window {
    __GAME_SHELF_RUNTIME_CONFIG__?: RuntimeConfig;
  }
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return null;
}

function normalizeRuntimeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRuntimeConfig(value: unknown): RuntimeConfig | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as RuntimeConfig;
  const appVersion = normalizeRuntimeString(candidate.appVersion) ?? undefined;
  const featureFlagsCandidate = candidate.featureFlags;
  const featureFlags =
    featureFlagsCandidate && typeof featureFlagsCandidate === 'object'
      ? {
          ...(parseBoolean(featureFlagsCandidate.showMgcImport) !== null
            ? { showMgcImport: parseBoolean(featureFlagsCandidate.showMgcImport) ?? undefined }
            : {}),
          ...(parseBoolean(featureFlagsCandidate.e2eFixtures) !== null
            ? { e2eFixtures: parseBoolean(featureFlagsCandidate.e2eFixtures) ?? undefined }
            : {}),
          ...(parseBoolean(featureFlagsCandidate.recommendationsExploreEnabled) !== null
            ? {
                recommendationsExploreEnabled:
                  parseBoolean(featureFlagsCandidate.recommendationsExploreEnabled) ?? undefined,
              }
            : {}),
          ...(parseBoolean(featureFlagsCandidate.tasEnabled) !== null
            ? { tasEnabled: parseBoolean(featureFlagsCandidate.tasEnabled) ?? undefined }
            : {}),
          ...(parseBoolean(featureFlagsCandidate.requireAuth) !== null
            ? { requireAuth: parseBoolean(featureFlagsCandidate.requireAuth) ?? undefined }
            : {}),
        }
      : undefined;

  if (appVersion === undefined && featureFlags === undefined) {
    return {};
  }

  return {
    ...(appVersion !== undefined ? { appVersion } : {}),
    ...(featureFlags !== undefined ? { featureFlags } : {}),
  };
}

function readPersistedRuntimeConfig(): RuntimeConfig | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = readPreference(PERSISTED_RUNTIME_CONFIG_STORAGE_KEY);
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return null;
    }

    return normalizeRuntimeConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writePersistedRuntimeConfig(config: RuntimeConfig): void {
  if (typeof window === 'undefined') {
    return;
  }

  const serialized = JSON.stringify(config);
  if (serialized === lastPersistedSerializedConfig) {
    return;
  }

  try {
    writePreference(PERSISTED_RUNTIME_CONFIG_STORAGE_KEY, serialized);
    lastPersistedSerializedConfig = serialized;
  } catch {
    // Ignore storage failures.
  }
}

function resolveRuntimeConfig(): { config: RuntimeConfig | null; source: RuntimeConfigSource } {
  if (typeof window !== 'undefined') {
    const liveConfig = normalizeRuntimeConfig(window.__GAME_SHELF_RUNTIME_CONFIG__);
    if (liveConfig !== null) {
      writePersistedRuntimeConfig(liveConfig);
      return { config: liveConfig, source: 'live' };
    }

    const persistedConfig = readPersistedRuntimeConfig();
    if (persistedConfig !== null) {
      return { config: persistedConfig, source: 'persisted' };
    }
  }

  return { config: null, source: 'default' };
}

export function resetRuntimeConfigPersistenceCacheForTesting(): void {
  lastPersistedSerializedConfig = null;
}

export function persistRuntimeConfig(config: unknown): RuntimeConfig | null {
  const normalized = normalizeRuntimeConfig(config);
  if (normalized === null) {
    return null;
  }

  writePersistedRuntimeConfig(normalized);
  return normalized;
}

export function setLiveRuntimeConfig(config: unknown): RuntimeConfig | null {
  const normalized = normalizeRuntimeConfig(config);
  if (typeof window !== 'undefined') {
    window.__GAME_SHELF_RUNTIME_CONFIG__ = normalized ?? undefined;
  }

  if (normalized !== null) {
    writePersistedRuntimeConfig(normalized);
  }

  return normalized;
}

export function getRuntimeConfigSource(): RuntimeConfigSource {
  return resolveRuntimeConfig().source;
}

export function hasLiveRuntimeConfig(): boolean {
  return getRuntimeConfigSource() === 'live';
}

export function isMgcImportFeatureEnabled(): boolean {
  const runtimeValue = parseBoolean(resolveRuntimeConfig().config?.featureFlags?.showMgcImport);

  if (runtimeValue !== null) {
    return runtimeValue;
  }

  return environment.featureFlags.showMgcImport;
}

export function isE2eFixturesEnabled(): boolean {
  const runtimeValue = parseBoolean(resolveRuntimeConfig().config?.featureFlags?.e2eFixtures);

  if (runtimeValue !== null) {
    return runtimeValue;
  }

  return environment.featureFlags.e2eFixtures;
}

export function getAppVersion(): string {
  return getAppVersionInfo().value;
}

export function getAppVersionInfo(): AppVersionInfo {
  const { config, source } = resolveRuntimeConfig();
  const value = normalizeRuntimeString(config?.appVersion) ?? '0.0.0';
  return {
    value,
    source,
    isFallback: value === '0.0.0',
  };
}

export function isRecommendationsExploreEnabled(): boolean {
  const runtimeValue = parseBoolean(
    resolveRuntimeConfig().config?.featureFlags?.recommendationsExploreEnabled
  );

  if (runtimeValue !== null) {
    return runtimeValue;
  }

  return environment.featureFlags.recommendationsExploreEnabled;
}

export function isExploreEnabled(): boolean {
  return isRecommendationsExploreEnabled();
}

export function isTasFeatureEnabled(): boolean {
  const runtimeValue = parseBoolean(resolveRuntimeConfig().config?.featureFlags?.tasEnabled);

  if (runtimeValue !== null) {
    return runtimeValue;
  }

  return environment.featureFlags.tasEnabled;
}

export function isAuthRequired(): boolean {
  const runtimeValue = parseBoolean(resolveRuntimeConfig().config?.featureFlags?.requireAuth);

  if (runtimeValue !== null) {
    return runtimeValue;
  }

  return environment.featureFlags.requireAuth;
}
