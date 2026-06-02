import path from 'node:path';
import { mkdir, writeFile, copyFile, access } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import type { AppConfig } from '../config.js';
import { getRenderData } from '../store/repositories.js';
import { atomicReplaceDirectory, MANAGED_MARKER } from '../utils/atomicWrite.js';
import { renderConversationMarkdown, mediaOutputName } from './renderConversationMarkdown.js';
import { renderConversations, renderIndex } from './renderIndex.js';
import { dedupeWarnings, renderImports, renderWarnings } from './renderImports.js';
import { toPosix } from '../utils/paths.js';

export async function renderArchive(db: Database.Database, config: AppConfig, outputDir = config.paths.outputDir, force = false): Promise<{ threads: number; messages: number; media: number }> {
  const data = getRenderData(db);
  await atomicReplaceDirectory(path.resolve(outputDir), async (stage) => {
    await writeFile(path.join(stage, MANAGED_MARKER), 'managed by ig-dm-md\n');
    await writeFile(path.join(stage, '.gitignore'), '*\n!.gitignore\n!.ig-dm-md-managed\n!README.md\n!index.md\n!conversations.md\n!imports.md\n!_unsupported/\n');
    await writeFile(path.join(stage, 'README.md'), archiveReadme());
    await writeFile(path.join(stage, 'index.md'), renderIndex(data, config));
    await writeFile(path.join(stage, 'conversations.md'), renderConversations(data, config));
    await writeFile(path.join(stage, 'imports.md'), renderImports(data));
    await mkdir(path.join(stage, '_unsupported'), { recursive: true });
    await writeFile(path.join(stage, '_unsupported', 'warnings.md'), renderWarnings(data));
    await mkdir(path.join(stage, '_system'), { recursive: true });
    await writeFile(path.join(stage, '_system', 'imports.md'), renderImports(data));
    await writeFile(path.join(stage, '_system', 'parser-warnings.md'), renderWarnings(data));
    const generatedPaths: string[] = ['README.md', 'index.md', 'conversations.md', 'imports.md'];
    for (const thread of data.threads) {
      const dir = path.join(stage, thread.output_dir);
      await mkdir(dir, { recursive: true });
      await copyMedia(thread, dir, data);
      await writeFile(path.join(dir, 'chat.md'), renderConversationMarkdown(thread, config));
      const metadata = {
        sourceConversationId: thread.source_thread_key,
        sourceThreadKey: thread.source_thread_key,
        title: thread.title,
        kind: thread.thread_kind,
        sourceCategory: thread.source_category,
        participants: thread.participantNames,
        firstMessageAt: thread.first_message_at,
        lastMessageAt: thread.last_message_at,
        messageCount: thread.messages.length,
        mediaCount: thread.media.length,
        sourcePaths: JSON.parse(thread.raw_metadata_json || '{}').sourcePaths ?? [],
        sourceExports: data.exports.filter((e: any) => e.status !== 'skipped_no_messages').map((e: any) => e.name),
        renderedFiles: ['chat.md'],
        warnings: dedupeWarnings(thread.warnings).map((w: any) => ({ code: w.code, severity: w.severity, message: w.message }))
      };
      await writeFile(path.join(dir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
      generatedPaths.push(`${toPosix(thread.output_dir)}/chat.md`, `${toPosix(thread.output_dir)}/metadata.json`);
    }
    const totalMessages = data.threads.reduce((n: number, t: any) => n + t.messages.length, 0);
    const totalMedia = data.threads.reduce((n: number, t: any) => n + t.media.length, 0);
    await writeFile(path.join(stage, '_system', 'render-manifest.json'), `${JSON.stringify({ app: 'ig-dm-md', version: '0.1.0', config: { source: config.source.kind, timezone: config.render.timezone, outputDir }, sourceExports: data.exports.filter((e: any) => e.status !== 'skipped_no_messages').map((e: any) => ({ id: e.id, name: e.name })), totalThreads: data.threads.length, totalMessages, totalMedia, outputPathsGenerated: generatedPaths }, null, 2)}\n`);
    await writeFile(path.join(stage, '_system', 'sync-log.md'), syncLog(data));
  }, force);
  return { threads: data.threads.length, messages: data.threads.reduce((n: number, t: any) => n + t.messages.length, 0), media: data.threads.reduce((n: number, t: any) => n + t.media.length, 0) };
}

async function copyMedia(thread: any, dir: string, data: any): Promise<void> {
  const mediaDir = path.join(dir, 'media');
  const sourceFolder = path.dirname((JSON.parse(thread.raw_metadata_json || '{}').sourcePaths ?? [])[0] ?? '');
  for (const item of thread.media) {
    if (!item.source_uri) continue;
    const src = path.resolve(sourceFolder, item.source_uri);
    try {
      await access(src);
      await mkdir(mediaDir, { recursive: true });
      const outName = mediaOutputName(item.source_uri, String(item.message_id));
      await copyFile(src, path.join(mediaDir, outName));
      item.output_relative_path = `media/${outName}`;
    } catch { /* represented as missing in transcript */ }
  }
}
function archiveReadme(): string { return `# Instagram DM Markdown Archive\n\nThis is generated output from ig-dm-md and contains private conversations. Do not casually commit, share, or sync this folder.\n\nMarkdown is a reading copy; the canonical local state is the SQLite database in .igdm/state.sqlite.\n`; }

function syncLog(data: any): string {
  const skipped = data.exports.filter((e: any) => e.status === 'skipped_no_messages').length;
  return `# Sync log\n\nSee imports.md for imported exports and skipped source diagnostics.\n\n- Source records: ${data.exports.length}\n- Skipped no-message sources: ${skipped}\n`;
}
