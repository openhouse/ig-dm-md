import { readFile, writeFile, mkdir, chmod, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const ConfigSchema = z.object({
  source: z.object({
    kind: z.enum(['local-folder', 'local-zip', 'google-drive']).default('local-folder'),
    path: z.string().default('./fixtures/exports'),
    driveFolderId: z.string().default(''),
    pollIntervalMinutes: z.number().positive().default(30),
    queryHints: z.array(z.string()).default(['instagram', 'meta', 'transfer', 'messages'])
  }).default({} as any),
  paths: z.object({
    stateDir: z.string().default('./.igdm'),
    cacheDir: z.string().default('./.igdm/cache'),
    outputDir: z.string().default('./instagram-dm-markdown-archive')
  }).default({} as any),
  render: z.object({
    timezone: z.string().default('America/New_York'),
    locale: z.string().default('en-US'),
    dateFormat: z.string().default('M/d/yy, h:mm:ss a'),
    copyMedia: z.boolean().default(true),
    includeMediaLinks: z.boolean().default(true),
    includeReactions: z.boolean().default(true),
    escapeMarkdownMessageContent: z.boolean().default(true),
    writeIndex: z.boolean().default(true),
    writeMetadata: z.boolean().default(true)
  }).default({} as any),
  archive: z.object({
    mode: z.literal('archive').default('archive'),
    preservePreviouslyImportedMessages: z.boolean().default(true),
    pruneMissingMessages: z.boolean().default(false)
  }).default({} as any),
  privacy: z.object({ logMessageContents: z.literal(false).default(false) }).default({} as any),
  identity: z.object({ selfNames: z.array(z.string()).default(['Jamie Burkart', 'jamieburkart']) }).default({} as any)
});
export type AppConfig = z.infer<typeof ConfigSchema>;
export const CONFIG_FILE = 'igdm.config.json';
export const defaultConfig: AppConfig = ConfigSchema.parse({
  source: { kind: 'local-folder', path: './fixtures/exports', driveFolderId: '', pollIntervalMinutes: 30, queryHints: ['instagram', 'meta', 'transfer', 'messages'] },
  paths: { stateDir: './.igdm', cacheDir: './.igdm/cache', outputDir: './instagram-dm-markdown-archive' },
  render: { timezone: 'America/New_York', locale: 'en-US', dateFormat: 'M/d/yy, h:mm:ss a', copyMedia: true, includeMediaLinks: true, includeReactions: true, escapeMarkdownMessageContent: true, writeIndex: true, writeMetadata: true },
  archive: { mode: 'archive', preservePreviouslyImportedMessages: true, pruneMissingMessages: false },
  privacy: { logMessageContents: false },
  identity: { selfNames: ['Jamie Burkart', 'jamieburkart'] }
});

export async function loadConfig(configPath = CONFIG_FILE): Promise<AppConfig> {
  if (!existsSync(configPath)) return defaultConfig;
  return ConfigSchema.parse(deepMerge(defaultConfig, JSON.parse(await readFile(configPath, 'utf8'))));
}

export async function writeDefaultConfig(configPath = CONFIG_FILE): Promise<AppConfig> {
  const config = defaultConfig;
  if (!existsSync(configPath)) await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await mkdir(config.paths.stateDir, { recursive: true, mode: 0o700 });
  await mkdir(config.paths.cacheDir, { recursive: true, mode: 0o700 });
  await mkdir(path.join(config.paths.stateDir, 'logs'), { recursive: true, mode: 0o700 });
  await chmod(config.paths.stateDir, 0o700).catch(() => undefined);
  await ensureGitignoreEntries();
  return config;
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!override || typeof override !== 'object') return structuredClone(base) as T;
  const result: any = Array.isArray(base) ? [...base] : { ...(base as any) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    const current = (result as Record<string, unknown>)[key];
    result[key] = current && typeof current === 'object' && !Array.isArray(current) && value && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(current, value)
      : value;
  }
  return result;
}

async function ensureGitignoreEntries(): Promise<void> {
  const entries = ['.igdm/', 'credentials.json', 'token.json', 'instagram-dm-markdown-archive/', 'instagram-dm-md-archive/', 'rendered-instagram-chats/', 'raw-exports/', '*.zip', 'tmp/', 'dist/'];
  const gitignore = '.gitignore';
  const existing = existsSync(gitignore) ? await readFile(gitignore, 'utf8') : '';
  const missing = entries.filter((entry) => !existing.split(/\r?\n/).includes(entry));
  if (missing.length) await appendFile(gitignore, `${existing.endsWith('\n') || existing.length === 0 ? '' : '\n'}${missing.join('\n')}\n`);
}
