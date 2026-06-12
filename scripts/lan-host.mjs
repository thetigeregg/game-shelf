import { networkInterfaces } from 'node:os';

const PREFERRED_INTERFACE_PREFIXES = ['en0', 'en1', 'en2', 'en3', 'wlan0', 'eth0'];

function isPrivateIpv4(address) {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  if (parts[0] === 10) {
    return true;
  }

  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }

  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }

  return false;
}

function collectIpv4Addresses(networkInterfacesFn = networkInterfaces) {
  const interfaces = networkInterfacesFn();
  const addresses = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) {
        continue;
      }

      addresses.push({ name, address: entry.address });
    }
  }

  return addresses;
}

export function resolveLanHost(envValues = {}, options = {}) {
  const explicitHost = envValues.IOS_LAN_HOST?.trim();
  if (explicitHost) {
    return explicitHost;
  }

  const addresses = collectIpv4Addresses(options.networkInterfaces);

  for (const prefix of PREFERRED_INTERFACE_PREFIXES) {
    const match = addresses.find((entry) => entry.name === prefix && isPrivateIpv4(entry.address));
    if (match) {
      return match.address;
    }
  }

  const fallback = addresses.find((entry) => isPrivateIpv4(entry.address));
  return fallback?.address ?? null;
}

export function composeLocalBackendOrigin(host, edgePort) {
  if (typeof host !== 'string' || host.trim().length === 0) {
    return null;
  }

  const port = Number.parseInt(String(edgePort), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }

  return `http://${host.trim()}:${port}`;
}

export function formatSuggestedIosLocalOrigin(host, edgePort) {
  const origin = composeLocalBackendOrigin(host, edgePort);
  if (!origin) {
    return null;
  }

  return origin;
}

export function resolveAssetPublicBaseUrl(envValues = {}, edgePort, mountPath, options = {}) {
  const normalizedMountPath =
    typeof mountPath === 'string' && mountPath.trim().length > 0 ? mountPath.trim() : 'manuals';
  const envKey =
    normalizedMountPath === 'roms' ? 'ROMS_PUBLIC_BASE_URL' : 'MANUALS_PUBLIC_BASE_URL';
  const fallbackRelativePath = `/${normalizedMountPath}`;
  const explicit = typeof envValues[envKey] === 'string' ? envValues[envKey].trim() : '';

  if (/^https?:\/\//i.test(explicit)) {
    return explicit.replace(/\/+$/, '');
  }

  const lanHost = resolveLanHost(envValues, options);
  const origin = composeLocalBackendOrigin(lanHost, edgePort);
  if (origin) {
    return `${origin}/${normalizedMountPath}`;
  }

  const port = Number.parseInt(String(edgePort), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return fallbackRelativePath;
  }

  return `http://127.0.0.1:${port}/${normalizedMountPath}`;
}

export function resolveManualsPublicBaseUrl(envValues = {}, edgePort, options = {}) {
  return resolveAssetPublicBaseUrl(envValues, edgePort, 'manuals', options);
}

export function resolveRomsPublicBaseUrl(envValues = {}, edgePort, options = {}) {
  return resolveAssetPublicBaseUrl(envValues, edgePort, 'roms', options);
}
