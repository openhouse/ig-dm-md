import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import fg from 'fast-glob';
import { parseExportRoot } from '../instagram/parser.js';
import { sha256File, sha256Text } from '../utils/hash.js';
import { stableJson } from '../utils/stableJson.js';

export type DiscoveredExport = { kind: 'local'; path: string; name: string; sourceIdentifier: string; checksum: string; size: number; modifiedTime: string; isZip: boolean };
export type SkippedExport = { kind: 'local'; path: string; name: string; sourceIdentifier: string; modifiedTime: string; reason: string; notableFiles: string[]; status: 'skipped_no_messages' };
export type DiscoveryResult = { exports: DiscoveredExport[]; skipped: SkippedExport[]; sourceFoldersScanned: number; exportsSkippedNoMessages: number };

export async function discoverExports(sourcePath: string): Promise<DiscoveredExport[]> {
  return (await discoverExportSources(sourcePath)).exports;
}

export async function discoverExportSources(sourcePath: string): Promise<DiscoveryResult> {
  const st = await stat(sourcePath);
  if (st.isFile()) return { exports: [await fileExport(sourcePath)], skipped: [], sourceFoldersScanned: 1, exportsSkippedNoMessages: 0 };
  const zips = await fg(['**/*.zip'], { cwd: sourcePath, absolute: true, onlyFiles: true, ignore: ['**/node_modules/**'] });
  const dirs = new Set<string>();
  const messageFiles = await fg(['**/message_*.json'], { cwd: sourcePath, absolute: true, onlyFiles: true });
  for (const file of messageFiles) {
    const parts = path.relative(sourcePath, file).split(path.sep);
    const messagesIndex = parts.findIndex((p) => p === 'messages' || p === 'your_instagram_activity');
    dirs.add(messagesIndex > 0 ? path.join(sourcePath, parts[0]) : sourcePath);
  }

  const candidates = await folderCandidates(sourcePath, dirs);
  const skipped: SkippedExport[] = [];
  for (const dir of candidates) {
    if (dirs.has(dir)) continue;
    const notableFiles = (await fg(['**/secret_conversations.json'], { cwd: dir, onlyFiles: true, dot: false })).sort();
    if (notableFiles.length) skipped.push(await skippedFolder(dir, 'no message_*.json files found', notableFiles));
  }

  const exports = [...zips].map(fileExport);
  for (const dir of dirs) exports.push(folderExport(dir));
  const resolvedExports = (await Promise.all(exports)).sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime));
  const resolvedSkipped = skipped.sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime));
  const sourceFoldersScanned = candidates.length || (dirs.has(sourcePath) ? 1 : 0);
  return { exports: resolvedExports, skipped: resolvedSkipped, sourceFoldersScanned, exportsSkippedNoMessages: resolvedSkipped.length };
}

async function folderCandidates(sourcePath: string, discoveredDirs: Set<string>): Promise<string[]> {
  const entries = await readdir(sourcePath, { withFileTypes: true });
  const childDirs = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => path.join(sourcePath, entry.name));
  if (childDirs.length) return childDirs.sort();
  return discoveredDirs.has(sourcePath) ? [sourcePath] : [];
}

async function fileExport(file: string): Promise<DiscoveredExport> {
  const st = await stat(file); const checksum = await sha256File(file);
  return { kind: 'local', path: file, name: path.basename(file), sourceIdentifier: `local-file:${path.resolve(file)}:${st.size}:${Math.trunc(st.mtimeMs)}:${checksum}`, checksum, size: st.size, modifiedTime: st.mtime.toISOString(), isZip: true };
}
async function folderExport(dir: string): Promise<DiscoveredExport> {
  const files = await fg(['**/message_*.json', '**/*.{jpg,jpeg,png,gif,mp4,mov,m4a,mp3,pdf,txt}'], { cwd: dir, absolute: true, onlyFiles: true });
  let total = 0; let latest = 0; const manifest = [];
  for (const f of files.sort()) { const st = await stat(f); total += st.size; latest = Math.max(latest, st.mtimeMs); manifest.push([path.relative(dir, f), st.size, Math.trunc(st.mtimeMs)]); }
  const checksum = sha256Text(stableJson(manifest));
  return { kind: 'local', path: dir, name: path.basename(dir), sourceIdentifier: `local-folder:${path.resolve(dir)}:${checksum}`, checksum, size: total, modifiedTime: new Date(latest || Date.now()).toISOString(), isZip: false };
}
async function skippedFolder(dir: string, reason: string, notableFiles: string[]): Promise<SkippedExport> {
  const st = await stat(dir);
  return { kind: 'local', path: dir, name: path.basename(dir), sourceIdentifier: `local-folder-skipped:${path.resolve(dir)}`, modifiedTime: st.mtime.toISOString(), reason, notableFiles, status: 'skipped_no_messages' };
}

export async function hasInstagramMessages(root: string): Promise<boolean> { return (await parseExportRoot(root)).length > 0; }
