#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import { mkdir, access } from 'node:fs/promises';
import { loadConfig, writeDefaultConfig, type AppConfig } from './config.js';
import { discoverExports } from './ingest/discoverSources.js';
import { importExport } from './ingest/importExport.js';
import { openDatabase } from './store/sqlite.js';
import { renderArchive } from './render/renderTree.js';
import { createLogger } from './utils/logging.js';
import { runDriveAuth } from './drive/auth.js';

const program = new Command();
program.name('igdm').description('Local-first Instagram DM exports to Markdown').version('0.1.0');

program.command('init').description('Create igdm.config.json and local state/cache directories').action(async () => {
  const config = await writeDefaultConfig();
  console.log(`Created ${path.resolve('igdm.config.json')}`);
  console.log(`State directory: ${config.paths.stateDir}`);
});

program.command('sync').description('Import local exports and render Markdown archive')
  .option('--local-source <path>', 'local export folder, folder containing exports, or zip')
  .option('--source <kind>', 'source kind (local)')
  .option('--input <path>', 'local input path')
  .option('--output <path>', 'output archive directory')
  .option('--state-dir <path>', 'SQLite state directory')
  .option('--once', 'use configured source')
  .option('--force', 'replace unmarked output directory')
  .action(async (opts) => {
    const logger = createLogger();
    const config = await withOverrides(await loadConfig(), opts);
    await mkdir(config.paths.cacheDir, { recursive: true, mode: 0o700 });
    const db = openDatabase(config.paths.stateDir);
    const sourcePath = opts.localSource ?? opts.input ?? config.source.path;
    const exports = await discoverExports(sourcePath);
    let exportsImported = 0, conversationsParsed = 0, messagesImported = 0, duplicateMessagesSkipped = 0, mediaItemsImported = 0, warnings = 0;
    for (const exp of exports) {
      const stats = await importExport(db, exp, config.paths.cacheDir, config.identity.selfNames);
      exportsImported++;
      conversationsParsed += stats.conversationsParsed;
      messagesImported += stats.messagesImported;
      duplicateMessagesSkipped += stats.duplicateMessagesSkipped;
      mediaItemsImported += stats.mediaItemsImported;
      warnings += stats.warnings;
    }
    const rendered = await renderArchive(db, config, config.paths.outputDir, Boolean(opts.force));
    logger.info({ exportsDiscovered: exports.length, exportsImported, conversationsParsed, messagesImported, duplicateMessagesSkipped, mediaItemsImported, warnings, renderedConversations: rendered.threads }, 'sync complete');
    console.log(JSON.stringify({ exportsDiscovered: exports.length, exportsImported, conversationsParsed, messagesImported, duplicateMessagesSkipped, mediaItemsImported, warnings }, null, 2));
    db.close();
  });

program.command('render').description('Re-render Markdown from SQLite without importing')
  .option('--output <path>', 'output archive directory')
  .option('--state-dir <path>', 'SQLite state directory')
  .option('--force', 'replace unmarked output directory')
  .action(async (opts) => {
    const config = await withOverrides(await loadConfig(), opts);
    const db = openDatabase(config.paths.stateDir);
    const rendered = await renderArchive(db, config, config.paths.outputDir, Boolean(opts.force));
    console.log(JSON.stringify({ conversationsRendered: rendered.threads, messagesRendered: rendered.messages, mediaItems: rendered.media }, null, 2));
    db.close();
  });

program.command('watch').description('Poll and watch a local source folder').option('--interval-minutes <n>').action(async (opts) => {
  const { watch } = await import('chokidar');
  const config = await loadConfig();
  const interval = Number(opts.intervalMinutes ?? config.source.pollIntervalMinutes) * 60_000;
  const run = async () => program.parseAsync(['node', 'igdm', 'sync', '--local-source', config.source.path, '--output', config.paths.outputDir], { from: 'user' }).catch((e) => console.error(e.message));
  await run();
  const watcher = watch(config.source.path, { ignoreInitial: true });
  watcher.on('add', run).on('change', run);
  setInterval(run, interval);
  console.log(`Watching ${config.source.path}; polling every ${interval / 60000} minutes.`);
});

program.command('auth').description('Run Google Drive OAuth desktop flow').action(async () => {
  const config = await loadConfig();
  await runDriveAuth(config.paths.stateDir);
  console.log('Google Drive auth completed; token stored locally with restrictive permissions.');
});

program.command('doctor').description('Check config, paths, SQLite, and Drive auth status')
  .option('--state-dir <path>', 'SQLite state directory')
  .action(async (opts) => {
  const checks: Record<string, string> = {};
  try { const config = await withOverrides(await loadConfig(), opts); checks.config = 'ok'; await mkdir(config.paths.stateDir, { recursive: true, mode: 0o700 }); checks.stateDir = 'ok'; await mkdir(config.paths.cacheDir, { recursive: true, mode: 0o700 }); checks.cacheDir = 'ok'; await mkdir(config.paths.outputDir, { recursive: true }); checks.outputDir = 'ok'; const db = openDatabase(config.paths.stateDir); db.prepare('SELECT 1').get(); db.close(); checks.sqlite = 'ok'; if (config.source.kind === 'google-drive') { try { await access(path.join(config.paths.stateDir, 'token.json')); checks.driveAuth = 'token present'; } catch { checks.driveAuth = 'missing token; run igdm auth'; } } else checks.driveAuth = 'not required for local source'; }
  catch (e) { checks.error = e instanceof Error ? e.message : String(e); }
  console.log(JSON.stringify(checks, null, 2));
});

async function withOverrides(config: AppConfig, opts: any): Promise<AppConfig> {
  const out = structuredClone(config) as AppConfig;
  if (opts.output) out.paths.outputDir = opts.output;
  if (opts.stateDir) {
    out.paths.stateDir = opts.stateDir;
    out.paths.cacheDir = path.join(opts.stateDir, 'cache');
  }
  if (opts.localSource || opts.input) { out.source.kind = opts.input?.endsWith('.zip') ? 'local-zip' : 'local-folder'; out.source.path = opts.localSource ?? opts.input; }
  return out;
}

program.parseAsync().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
