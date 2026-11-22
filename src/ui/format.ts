const integer = new Intl.NumberFormat('en-US');
const decimals = (digits: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
const oneDecimal = decimals(1);
const twoDecimals = decimals(2);

export function formatInt(n: number): string {
  return integer.format(n);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Number with up to 2 decimals depending on its size, without trailing zeros. */
export function formatNumber(n: number): string {
  const abs = Math.abs(n);
  // Small values keep two significant digits instead of rounding to 0 (Cd 0.001).
  if (abs > 0 && abs < 0.01) return String(Number(n.toPrecision(2)));
  if (abs >= 1000) return integer.format(Math.round(n));
  if (abs >= 10) return oneDecimal.format(n);
  return twoDecimals.format(n);
}

export function formatArea(m2: number): string {
  return `${formatNumber(m2)} m²`;
}
