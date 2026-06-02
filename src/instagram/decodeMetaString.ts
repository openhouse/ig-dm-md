export type RepairMode = 'auto' | 'off';
const MOJIBAKE_RE = /(?:Ã.|Â.|â€|â€™|â€œ|â€\x9d|ðŸ|�)/;
export function decodeMetaString(value: unknown, mode: RepairMode = 'auto'): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (mode === 'off' || !MOJIBAKE_RE.test(value)) return value;
  const repaired = Buffer.from(value, 'latin1').toString('utf8');
  return mojibakeScore(repaired) < mojibakeScore(value) ? repaired : value;
}
function mojibakeScore(s: string): number {
  const matches = s.match(MOJIBAKE_RE);
  return (matches ? matches.length * 5 : 0) + (s.match(/�/g)?.length ?? 0) * 10;
}
