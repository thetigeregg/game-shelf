import { environment } from '../../../environments/environment';

interface RuntimeFeatureFlags {
  showMgcImport?: boolean;
}

interface RuntimeConfig {
  featureFlags?: RuntimeFeatureFlags;
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

export function isMgcImportFeatureEnabled(): boolean {
  if (typeof window !== 'undefined') {
    const runtimeValue = parseBoolean(
      window.__GAME_SHELF_RUNTIME_CONFIG__?.featureFlags?.showMgcImport
    );

    if (runtimeValue !== null) {
      return runtimeValue;
    }
  }

  return environment.featureFlags?.showMgcImport === true;
}
