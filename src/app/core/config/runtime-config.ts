import { environment } from '../../../environments/environment';

interface RuntimeFeatureFlags {
  showMgcImport?: boolean;
  e2eFixtures?: boolean;
  recommendationsExploreEnabled?: boolean;
}

interface RuntimeFirebaseConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

interface RuntimeConfig {
  appVersion?: string;
  featureFlags?: RuntimeFeatureFlags;
  firebase?: RuntimeFirebaseConfig;
  firebaseVapidKey?: string;
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

  return environment.featureFlags.showMgcImport;
}

export function isE2eFixturesEnabled(): boolean {
  if (typeof window !== 'undefined') {
    const runtimeValue = parseBoolean(
      window.__GAME_SHELF_RUNTIME_CONFIG__?.featureFlags?.e2eFixtures
    );

    if (runtimeValue !== null) {
      return runtimeValue;
    }
  }

  return environment.featureFlags.e2eFixtures;
}

export function getAppVersion(): string {
  if (typeof window !== 'undefined') {
    const value = window.__GAME_SHELF_RUNTIME_CONFIG__?.appVersion;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return '0.0.0';
}

export function isRecommendationsExploreEnabled(): boolean {
  if (typeof window !== 'undefined') {
    const runtimeValue = parseBoolean(
      window.__GAME_SHELF_RUNTIME_CONFIG__?.featureFlags?.recommendationsExploreEnabled
    );

    if (runtimeValue !== null) {
      return runtimeValue;
    }
  }

  return environment.featureFlags.recommendationsExploreEnabled;
}

export function getFirebaseWebConfig(): {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
} {
  const fallback = environment.firebase;

  if (typeof window === 'undefined') {
    return fallback;
  }

  const candidate = window.__GAME_SHELF_RUNTIME_CONFIG__?.firebase;
  if (!candidate || typeof candidate !== 'object') {
    return fallback;
  }

  return {
    apiKey: normalizeRuntimeString(candidate.apiKey) ?? fallback.apiKey,
    authDomain: normalizeRuntimeString(candidate.authDomain) ?? fallback.authDomain,
    projectId: normalizeRuntimeString(candidate.projectId) ?? fallback.projectId,
    storageBucket: normalizeRuntimeString(candidate.storageBucket) ?? fallback.storageBucket,
    messagingSenderId:
      normalizeRuntimeString(candidate.messagingSenderId) ?? fallback.messagingSenderId,
    appId: normalizeRuntimeString(candidate.appId) ?? fallback.appId
  };
}

export function getFirebaseVapidKey(): string {
  if (typeof window !== 'undefined') {
    const runtimeValue = normalizeRuntimeString(
      window.__GAME_SHELF_RUNTIME_CONFIG__?.firebaseVapidKey
    );
    if (runtimeValue !== null) {
      return runtimeValue;
    }
  }

  return environment.firebaseVapidKey;
}

function normalizeRuntimeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
