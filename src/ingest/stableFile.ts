import { stat } from 'node:fs/promises';
export async function isStableFile(path: string, stableMs = 60_000): Promise<boolean> {
  if (/\.(crdownload|part|tmp|download)$/i.test(path)) return false;
  const a = await stat(path); await new Promise((r) => setTimeout(r, Math.min(stableMs, 1000))); const b = await stat(path);
  return a.size === b.size;
}
