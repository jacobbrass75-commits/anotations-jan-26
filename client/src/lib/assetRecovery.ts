export const STALE_ASSET_RECOVERY_PARAM = "sm_asset_retry";
export const STALE_ASSET_RECOVERY_STORAGE_PREFIX = "sm_asset_recovery:";
export const STALE_ASSET_STABILITY_MS = 10_000;

export function getStaleAssetRecoveryStorageKey(pathname: string): string {
  return `${STALE_ASSET_RECOVERY_STORAGE_PREFIX}${pathname}`;
}

export function buildStaleAssetRecoveryUrl(href: string, token = Date.now().toString(36)) {
  const url = new URL(href);
  if (url.searchParams.has(STALE_ASSET_RECOVERY_PARAM)) return null;
  url.searchParams.set(STALE_ASSET_RECOVERY_PARAM, token);
  return url.toString();
}

export function stripStaleAssetRecoveryParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(STALE_ASSET_RECOVERY_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}
