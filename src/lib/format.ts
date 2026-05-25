export function formatAmount(amount: number | null): string {
  if (amount === null) return "-";
  if (amount === 0) return "$0.00";
  return `$${amount.toFixed(2)}`;
}

export function formatAssets(assets: number | null): string {
  if (!assets) return "N/A";
  if (assets > 1_000_000) return `$${(assets / 1_000_000).toFixed(1)}B`;
  if (assets > 1_000) return `$${(assets / 1_000).toFixed(0)}M`;
  return `$${assets}K`;
}

export function timeAgo(dateString: string | Date | null | undefined): string {
  if (!dateString) return "";
  const then =
    dateString instanceof Date ? dateString.getTime() : new Date(dateString).getTime();
  if (isNaN(then)) return "";
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("en-US");
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
