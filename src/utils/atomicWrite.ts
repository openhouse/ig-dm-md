import path from 'node:path';
import { mkdtemp, rm, rename, stat, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';

export const MANAGED_MARKER = '.ig-dm-md-managed';

export async function atomicReplaceDirectory(targetDir: string, populate: (stagingDir: string) => Promise<void>, force = false): Promise<void> {
  const parent = path.dirname(targetDir);
  await mkdir(parent || tmpdir(), { recursive: true });
  const staging = await mkdtemp(path.join(parent || tmpdir(), '.igdm-render-'));
  const backup = `${targetDir}.backup-${Date.now()}`;
  try {
    await populate(staging);
    const marker = path.join(staging, MANAGED_MARKER);
    await access(marker);
    let exists = false;
    try { await stat(targetDir); exists = true; } catch {}
    if (exists) {
      try { await access(path.join(targetDir, MANAGED_MARKER)); } catch {
        if (!force) throw new Error(`Refusing to replace ${targetDir}: missing ${MANAGED_MARKER}`);
      }
      await rename(targetDir, backup);
    }
    await rename(staging, targetDir);
    if (exists) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    try { await stat(backup); await rename(backup, targetDir); } catch {}
    throw error;
  }
}
