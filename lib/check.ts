// Self-check helper. console.assert only logs, so `npm run check` would pass with failing checks; this throws.
export function check(cond: unknown, msg: string, ...detail: unknown[]): void {
  if (!cond) throw new Error(`check failed: ${msg} ${detail.map((d) => JSON.stringify(d)).join(" ")}`);
}
