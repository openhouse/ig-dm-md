import path from 'node:path';
import { mkdir } from 'node:fs/promises';

export function resolveFromCwd(p: string): string { return path.resolve(process.cwd(), p); }
export async function ensureDir(p: string): Promise<void> { await mkdir(p, { recursive: true }); }
export function toPosix(p: string): string { return p.split(path.sep).join('/'); }
