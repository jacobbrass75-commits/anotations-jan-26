const MARKETING_HOSTS = new Set(["scholarmark.ai", "www.scholarmark.ai"]);
const FAST_MARKETING_PATHS = ["/", "/start", "/summer", "/invite"];

export function isFastMarketingEntry(hostname: string, pathname: string): boolean {
  if (!MARKETING_HOSTS.has(hostname.toLowerCase())) return false;
  return FAST_MARKETING_PATHS.some(
    (path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)),
  );
}
