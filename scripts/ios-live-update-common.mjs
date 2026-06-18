import { createHash, createPrivateKey, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * SHA-256 checksum of a bundle zip as lowercase hex (Capawesome self-hosted format).
 */
export function computeBundleChecksum(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * RSA-SHA256 signature of the full bundle bytes, base64-encoded.
 * Matches @capawesome/capacitor-live-update verifySignatureForFile (SHA256withRSA over file).
 */
export function signBundleBuffer(buffer, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  const signer = createSign('RSA-SHA256');
  signer.update(buffer);
  signer.end();
  return signer.sign(key, 'base64');
}

export function signBundleFile(filePath, privateKeyPem, readFileSyncFn = readFileSync) {
  const buffer = readFileSyncFn(filePath);
  const checksum = computeBundleChecksum(buffer);
  const signature = signBundleBuffer(buffer, privateKeyPem);
  return { checksum, signature, sizeBytes: buffer.length };
}

export function buildIosLiveUpdateBundleId(semver, nativeBuildNumber) {
  const normalizedSemver =
    typeof semver === 'string' && semver.trim().length > 0 ? semver.trim() : '0.0.0';
  const normalizedBuild =
    typeof nativeBuildNumber === 'string' || typeof nativeBuildNumber === 'number'
      ? String(nativeBuildNumber).trim()
      : '';

  if (normalizedBuild.length === 0) {
    throw new Error('nativeBuildNumber is required to build an iOS live-update bundle id');
  }

  return `v${normalizedSemver}-b${normalizedBuild}`;
}

export function buildIosLiveUpdateManifest({
  bundleId,
  semver,
  nativeBuildNumber,
  backendOrigin,
  checksum,
  signature,
}) {
  const origin = normalizeBackendOrigin(backendOrigin);
  const buildSegment = String(nativeBuildNumber).trim();
  const zipFileName = `${bundleId}.zip`;

  return {
    bundleId,
    semver: semver.trim(),
    nativeBuildNumber: buildSegment,
    url: `${origin}/ota/ios/${buildSegment}/${zipFileName}`,
    checksum,
    signature,
  };
}

export function normalizeBackendOrigin(value) {
  if (typeof value !== 'string') {
    throw new Error('backendOrigin must be a string');
  }

  const trimmed = value.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) {
    throw new Error('backendOrigin must not be empty');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid backendOrigin: ${value}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('backendOrigin must use https for production OTA delivery');
  }

  return `${parsed.protocol}//${parsed.host}`;
}

export function parseIosLiveUpdateManifest(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value;
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

export function shouldStageLiveUpdateManifest({
  manifest,
  nativeBuildNumber,
  currentBundleId = null,
  nextBundleId = null,
}) {
  if (manifest === null) {
    return { shouldStage: false, reason: 'invalid_manifest' };
  }

  const deviceBuild = String(nativeBuildNumber ?? '').trim();
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
