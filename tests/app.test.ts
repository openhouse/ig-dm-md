import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, cp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fg from 'fast-glob';
import { discoverConversationFolders, parseConversation, parseExportRoot } from '../src/instagram/parser.js';
import { decodeMetaString } from '../src/instagram/decodeMetaString.js';
import { openDatabase } from '../src/store/sqlite.js';
import { discoverExports } from '../src/ingest/discoverSources.js';
import { importExport } from '../src/ingest/importExport.js';
import { renderArchive } from '../src/render/renderTree.js';
import { safeExtractZip } from '../src/ingest/extractArchive.js';
import { stableConversationDir } from '../src/utils/slug.js';
import { createLogger } from '../src/utils/logging.js';
import { defaultConfig, type AppConfig } from '../src/config.js';

const fixtureRoot = path.resolve('fixtures/exports');
let temp: string;
let config: AppConfig;

beforeEach(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'igdm-test-'));
  config = structuredClone(defaultConfig) as AppConfig;
  config.paths.stateDir = path.join(temp, '.igdm');
  config.paths.cacheDir = path.join(temp, '.igdm/cache');
  config.paths.outputDir = path.join(temp, 'archive');
});

describe('Instagram parser', () => {
  it('discovers conversations from nested Instagram paths', async () => {
    const folders = await discoverConversationFolders(path.join(fixtureRoot, 'export-a'));
    expect(folders.map((f) => path.basename(f)).sort()).toEqual(['alice_123', 'groupchat_456', 'split_789']);
  });
  it('imports a direct conversation with text, emoji, media, reactions, shares, multiline, mojibake, and unsupported warnings', async () => {
    const conv = await parseConversation(path.join(fixtureRoot, 'export-a/messages/inbox/alice_123'), path.join(fixtureRoot, 'export-a'));
    expect(conv.kind).toBe('direct');
    expect(conv.title).toBe('Alice Example');
    expect(conv.messages[0].text).toContain('😊');
    expect(conv.messages.some((m) => m.attachments.length)).toBe(true);
    expect(conv.messages.some((m) => m.reactions.length)).toBe(true);
    expect(conv.messages.some((m) => m.share?.link === 'https://example.com')).toBe(true);
    expect(conv.messages.some((m) => m.text?.includes('\nSecond line'))).toBe(true);
    expect(conv.messages.some((m) => m.text === 'François says hi')).toBe(true);
    expect(conv.warnings.some((w) => w.code === 'unsupported_message')).toBe(true);
  });
  it('imports a group conversation', async () => {
    const conv = await parseConversation(path.join(fixtureRoot, 'export-a/messages/inbox/groupchat_456'), path.join(fixtureRoot, 'export-a'));
    expect(conv.kind).toBe('group');
    expect(conv.participants).toHaveLength(3);
  });
  it('combines message_1.json and message_2.json and sorts ascending', async () => {
    const conv = await parseConversation(path.join(fixtureRoot, 'export-a/your_instagram_activity/messages/archived_threads/split_789'), path.join(fixtureRoot, 'export-a'));
    expect(conv.messages.map((m) => m.text)).toEqual(['First file earlier', 'Second file later']);
  });
  it('preserves valid Unicode and repairs only clear mojibake', () => {
    expect(decodeMetaString('Hello 😊 café “quote” 東京')).toBe('Hello 😊 café “quote” 東京');
    expect(decodeMetaString('FranÃ§ois')).toBe('François');
  });
});

describe('store and renderer', () => {
  it('dedupes same export and appends only new messages from overlap', async () => {
    const db = openDatabase(config.paths.stateDir);
    const exports = await discoverExports(fixtureRoot);
    const a = exports.find((e) => e.name === 'export-a')!;
    const b = exports.find((e) => e.name === 'export-b-overlap')!;
    let stats = await importExport(db, a, config.paths.cacheDir, config.identity.selfNames);
    expect(stats.messagesImported).toBe(13);
    stats = await importExport(db, a, config.paths.cacheDir, config.identity.selfNames);
    expect(stats.messagesImported).toBe(0);
    expect(stats.duplicateMessagesSkipped).toBe(13);
    stats = await importExport(db, b, config.paths.cacheDir, config.identity.selfNames);
    expect(stats.messagesImported).toBe(1);
    db.close();
  });
  it('renders chat, index, conversations, imports, metadata, warnings, relative media links, and can regenerate from SQLite', async () => {
    const db = openDatabase(config.paths.stateDir);
    for (const exp of await discoverExports(fixtureRoot)) await importExport(db, exp, config.paths.cacheDir, config.identity.selfNames);
    await renderArchive(db, config);
    const aliceDir = path.join(config.paths.outputDir, 'inbox/direct/alice-example--8ca8a481');
    const chat = await readFile(path.join(aliceDir, 'chat.md'), 'utf8');
    expect(chat).toContain('[5/31/24, 8:00:00 PM] Alice Example: Hey Jamie 😊 — café mañana');
    expect(chat).toContain('    Second line');
    expect(chat).toContain('↳ Reaction from Alice Example: ❤️');
    expect(chat).toContain('<Shared link: https://example.com>');
    expect(chat).toContain('[media/');
    expect(chat).toContain('<Media omitted: media/missing.jpg>');
    expect(chat).toContain('<unsupported Instagram message type: weird_event>');
    expect(await readFile(path.join(config.paths.outputDir, 'index.md'), 'utf8')).toContain('Total conversations: 3');
    expect(await readFile(path.join(config.paths.outputDir, 'conversations.md'), 'utf8')).toContain('Residency Planning');
    expect(await readFile(path.join(config.paths.outputDir, 'imports.md'), 'utf8')).toContain('export-a');
    expect(await readFile(path.join(aliceDir, 'metadata.json'), 'utf8')).toContain('Alice Example');
    expect(await readFile(path.join(config.paths.outputDir, '_unsupported/warnings.md'), 'utf8')).toContain('unsupported_message');
    const before = await readFile(path.join(aliceDir, 'chat.md'), 'utf8');
    await renderArchive(db, config);
    expect(await readFile(path.join(aliceDir, 'chat.md'), 'utf8')).toBe(before);
    db.close();
  });

  it('keeps child records and stable archive files idempotent across repeated fixture syncs', async () => {
    const syncOnce = async () => {
      const db = openDatabase(config.paths.stateDir);
      let messagesImported = 0;
      let duplicateMessagesSkipped = 0;
      for (const exp of await discoverExports(fixtureRoot)) {
        const stats = await importExport(db, exp, config.paths.cacheDir, config.identity.selfNames);
        messagesImported += stats.messagesImported;
        duplicateMessagesSkipped += stats.duplicateMessagesSkipped;
      }
      await renderArchive(db, config);
      const counts = {
        messages: Number((db.prepare('SELECT COUNT(*) count FROM messages').get() as { count: number }).count),
        reactions: Number((db.prepare('SELECT COUNT(*) count FROM reactions').get() as { count: number }).count),
        warnings: Number((db.prepare('SELECT COUNT(*) count FROM warnings').get() as { count: number }).count),
        media: Number((db.prepare('SELECT COUNT(*) count FROM media').get() as { count: number }).count)
      };
      db.close();
      return { messagesImported, duplicateMessagesSkipped, counts };
    };

    const first = await syncOnce();
    const aliceDir = path.join(config.paths.outputDir, 'inbox/direct/alice-example--8ca8a481');
    const chatBefore = await readFile(path.join(aliceDir, 'chat.md'), 'utf8');
    const metadataBefore = await readFile(path.join(aliceDir, 'metadata.json'), 'utf8');
    const parserWarningsBefore = await readFile(path.join(config.paths.outputDir, '_system/parser-warnings.md'), 'utf8');
    const unsupportedWarningsBefore = await readFile(path.join(config.paths.outputDir, '_unsupported/warnings.md'), 'utf8');
    const importsBefore = await readFile(path.join(config.paths.outputDir, 'imports.md'), 'utf8');
    const manifestBefore = await readFile(path.join(config.paths.outputDir, '_system/render-manifest.json'), 'utf8');
    const chatSnapshotsBefore = await readChatSnapshots(config.paths.outputDir);

    const second = await syncOnce();
    const chatAfter = await readFile(path.join(aliceDir, 'chat.md'), 'utf8');
    const metadataAfter = await readFile(path.join(aliceDir, 'metadata.json'), 'utf8');
    const parserWarningsAfter = await readFile(path.join(config.paths.outputDir, '_system/parser-warnings.md'), 'utf8');
    const unsupportedWarningsAfter = await readFile(path.join(config.paths.outputDir, '_unsupported/warnings.md'), 'utf8');
    const importsAfter = await readFile(path.join(config.paths.outputDir, 'imports.md'), 'utf8');
    const manifestAfter = await readFile(path.join(config.paths.outputDir, '_system/render-manifest.json'), 'utf8');

    expect(first.messagesImported).toBe(14);
    expect(second.messagesImported).toBe(0);
    expect(second.duplicateMessagesSkipped).toBe(16);
    expect(second.counts).toEqual(first.counts);
    expect(countOccurrences(chatAfter, 'Reaction from Alice Example')).toBe(1);
    expect(countOccurrences(unsupportedWarningsAfter, 'unsupported_message')).toBe(1);
    expect(JSON.parse(metadataAfter).warnings).toHaveLength(1);
    expect(chatAfter).toBe(chatBefore);
    expect(await readChatSnapshots(config.paths.outputDir)).toEqual(chatSnapshotsBefore);
    expect(metadataAfter).toBe(metadataBefore);
    expect(parserWarningsAfter).toBe(parserWarningsBefore);
    expect(unsupportedWarningsAfter).toBe(unsupportedWarningsBefore);
    expect(importsAfter).toBe(importsBefore);
    expect(manifestAfter).toBe(manifestBefore);
  });

  it('slug generation is stable and collision-resistant', () => {
    expect(stableConversationDir('Alice Example', 'key-1')).toBe(stableConversationDir('Alice Example', 'key-1'));
    expect(stableConversationDir('Alice Example', 'key-1')).not.toBe(stableConversationDir('Alice Example', 'key-2'));
  });
});

describe('ZIP, atomic safety, logging, doctor', () => {
  it('rejects path traversal ZIP entries', async () => {
    const zipDir = path.join(temp, 'zip-src'); await mkdir(zipDir); await writeFile(path.join(zipDir, 'safe.txt'), 'safe');
    const zipPath = path.join(temp, 'bad.zip');
    await writeFile(path.join(temp, 'evil.txt'), 'evil');
    execFileSync('zip', ['-q', zipPath, '../evil.txt'], { cwd: zipDir });
    await expect(safeExtractZip(zipPath, path.join(temp, 'extract'))).rejects.toThrow(/Unsafe ZIP entry/);
  });
  it('atomic render does not leave partial files on failure', async () => {
    const db = openDatabase(config.paths.stateDir);
    for (const exp of await discoverExports(path.join(fixtureRoot, 'export-a'))) await importExport(db, exp, config.paths.cacheDir, config.identity.selfNames);
    await renderArchive(db, config);
    const indexBefore = await readFile(path.join(config.paths.outputDir, 'index.md'), 'utf8');
    await rm(path.join(config.paths.outputDir, '.ig-dm-md-managed'));
    await expect(renderArchive(db, config)).rejects.toThrow(/missing/);
    expect(await readFile(path.join(config.paths.outputDir, 'index.md'), 'utf8')).toBe(indexBefore);
    db.close();
  });
  it('normal logger does not include message contents', () => {
    const chunks: string[] = [];
    const logger = createLogger({ write: (s: string) => chunks.push(s) } as any);
    logger.info({ content: 'secret private message', count: 1 }, 'imported');
    expect(chunks.join('')).not.toContain('secret private message');
  });
  it('doctor reports missing Drive credentials without secrets', () => {
    execFileSync('npm', ['run', 'build'], { stdio: 'ignore' });
    const out = execFileSync('node', [path.resolve('dist/cli.js'), 'doctor'], { cwd: temp }).toString();
    expect(out).toContain('driveAuth');
    expect(out).not.toContain('secret');
  });
  it('supports isolated state directories for sync, render, and doctor', async () => {
    execFileSync('npm', ['run', 'build'], { stdio: 'ignore' });
    const stateDir = path.join(temp, 'manual-state');
    const outputDir = path.join(temp, 'manual-archive');
    const cli = path.resolve('dist/cli.js');

    const syncOut = execFileSync('node', [cli, 'sync', '--local-source', fixtureRoot, '--output', outputDir, '--state-dir', stateDir], { cwd: temp }).toString();
    expect(syncOut).toContain('"messagesImported": 14');
    expect(await readFile(path.join(outputDir, 'inbox/direct/alice-example--8ca8a481/chat.md'), 'utf8')).toContain('Reaction from Alice Example');

    const renderOut = execFileSync('node', [cli, 'render', '--output', outputDir, '--state-dir', stateDir, '--force'], { cwd: temp }).toString();
    expect(renderOut).toContain('"conversationsRendered": 3');

    const doctorOut = execFileSync('node', [cli, 'doctor', '--state-dir', stateDir], { cwd: temp }).toString();
    expect(doctorOut).toContain('"stateDir": "ok"');
  }, 15_000);
});

async function readChatSnapshots(outputDir: string): Promise<Record<string, string>> {
  const files = await fg('**/chat.md', { cwd: outputDir, dot: true });
  const snapshots: Record<string, string> = {};
  for (const file of files.sort()) snapshots[file] = await readFile(path.join(outputDir, file), 'utf8');
  return snapshots;
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
