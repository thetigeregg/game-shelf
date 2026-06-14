export interface IosLiveUpdateManifest {
  bundleId: string;
  semver: string;
  nativeBuildNumber: string;
  url: string;
  checksum: string;
  signature: string;
}

export type LiveUpdateStageDecisionReason =
  | 'invalid_manifest'
  | 'missing_native_build_number'
  | 'native_build_mismatch'
  | 'already_staged_or_active'
  | 'update_available';

export interface LiveUpdateStageDecision {
  shouldStage: boolean;
  reason: LiveUpdateStageDecisionReason;
}

export function parseIosLiveUpdateManifest(value: unknown): IosLiveUpdateManifest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<IosLiveUpdateManifest>;
  const bundleId = typeof candidate.bundleId === 'string' ? candidate.bundleId.trim() : '';
  const semver = typeof candidate.semver === 'string' ? candidate.semver.trim() : '';
  const nativeBuildNumber =
    typeof candidate.nativeBuildNumber === 'string' ? candidate.nativeBuildNumber.trim() : '';
  const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
  const checksum = typeof candidate.checksum === 'string' ? candidate.checksum.trim() : '';
  const signature = typeof candidate.signature === 'string' ? candidate.signature.trim() : '';

  if (
    bundleId.length === 0 ||
    semver.length === 0 ||
    nativeBuildNumber.length === 0 ||
    url.length === 0 ||
    checksum.length === 0 ||
    signature.length === 0
  ) {
    return null;
  }

  return { bundleId, semver, nativeBuildNumber, url, checksum, signature };
}

export function shouldStageLiveUpdateManifest(options: {
  manifest: IosLiveUpdateManifest | null;
  nativeBuildNumber: string | null;
  currentBundleId: string | null;
  nextBundleId: string | null;
}): LiveUpdateStageDecision {
  const { manifest, nativeBuildNumber, currentBundleId, nextBundleId } = options;

  if (manifest === null) {
    return { shouldStage: false, reason: 'invalid_manifest' };
  }

  const deviceBuild = nativeBuildNumber?.trim() ?? '';
  if (deviceBuild.length === 0) {
    return { shouldStage: false, reason: 'missing_native_build_number' };
  }

  if (manifest.nativeBuildNumber !== deviceBuild) {
    return { shouldStage: false, reason: 'native_build_mismatch' };
  }

  if (manifest.bundleId === currentBundleId || manifest.bundleId === nextBundleId) {
    return { shouldStage: false, reason: 'already_staged_or_active' };
  }

  return { shouldStage: true, reason: 'update_available' };
}

export function buildLiveUpdateManifestUrl(
  backendOrigin: string,
  nativeBuildNumber: string
): string {
  const origin = backendOrigin.replace(/\/+$/, '');
  const buildSegment = nativeBuildNumber.trim();
  return `${origin}/ota/ios/${buildSegment}/manifest.json`;
}

export function resolveBackendOriginFromGameApiBaseUrl(gameApiBaseUrl: string): string | null {
  if (typeof gameApiBaseUrl !== 'string' || gameApiBaseUrl.trim().length === 0) {
    return null;
  }

  try {
    const parsed = new URL(gameApiBaseUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }

    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}
