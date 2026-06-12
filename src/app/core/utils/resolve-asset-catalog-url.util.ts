import { isNativePlatform } from './native-platform.util';

export function resolveAssetCatalogUrl(
  relativePath: string,
  serverUrl: string,
  buildFromClientBase: (relativePath: string) => string
): string {
  if (isNativePlatform()) {
    return buildFromClientBase(relativePath);
  }

  const trimmedServerUrl = serverUrl.trim();
  return trimmedServerUrl.length > 0 ? trimmedServerUrl : buildFromClientBase(relativePath);
}
