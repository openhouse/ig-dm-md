import type Database from 'better-sqlite3';
import { parseExportRoot } from '../instagram/parser.js';
import { extractIfZip } from './extractArchive.js';
import type { DiscoveredExport } from './discoverSources.js';
import { importConversations, upsertExport, type ImportStats } from '../store/repositories.js';

export async function importExport(db: Database.Database, exp: DiscoveredExport, cacheDir: string, selfNames: string[]): Promise<ImportStats> {
  const root = await extractIfZip(exp.path, cacheDir);
  const conversations = await parseExportRoot(root);
  const exportId = upsertExport(db, { sourceKind: exp.kind, sourceIdentifier: exp.sourceIdentifier, name: exp.name, checksum: exp.checksum, size: exp.size, modifiedTime: exp.modifiedTime, raw: exp });
  return importConversations(db, exportId, conversations, selfNames);
}
