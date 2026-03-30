export function formatAccountTier(tier: string): string {
  switch (tier) {
    case "max":
      return "Max";
    case "pro":
      return "Pro";
    default:
      return "Free";
  }
}

export function formatUsagePercent(used: number, limit: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

export function formatAccountDate(value: string | null | undefined): string {
  if (!value) {
    return "Not available";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not available";
  }

  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatAccountBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);

  return `${value.toFixed(exponent === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[exponent]}`;
}
