import path from 'node:path';
import { createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import unzipper from 'unzipper';

export async function extractIfZip(inputPath: string, cacheDir: string): Promise<string> {
  if (!inputPath.toLowerCase().endsWith('.zip')) return inputPath;
  const target = path.join(cacheDir, 'extracted', path.basename(inputPath, '.zip'));
  await safeExtractZip(inputPath, target);
  return target;
}

export async function safeExtractZip(zipPath: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const targetResolved = path.resolve(targetDir);
  const directory = await unzipper.Open.file(zipPath);
  for (const entry of directory.files) {
    const outPath = path.resolve(targetDir, entry.path);
    if (!outPath.startsWith(`${targetResolved}${path.sep}`) && outPath !== targetResolved) throw new Error(`Unsafe ZIP entry rejected: ${entry.path}`);
  }
  await createReadStream(zipPath).pipe(unzipper.Extract({ path: targetDir })).promise();
}
