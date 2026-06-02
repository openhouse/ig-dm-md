import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import fg from 'fast-glob';
import { decodeMetaString } from './decodeMetaString.js';
import type { AttachmentKind, NormalizedAttachment, NormalizedConversation, NormalizedMessage, NormalizedReaction, ParseWarning, SourceCategory } from './types.js';
import { sha256Text } from '../utils/hash.js';
import { stableJson } from '../utils/stableJson.js';
import { toPosix } from '../utils/paths.js';

export async function discoverConversationFolders(exportRoot: string): Promise<string[]> {
  const files = await fg(['**/message_*.json'], { cwd: exportRoot, absolute: true, onlyFiles: true, dot: false });
  const folders = new Set<string>();
  for (const file of files) {
    const posix = toPosix(path.relative(exportRoot, file));
    if (/(^|\/)messages\//.test(posix) || /(^|\/)(inbox|archived_threads|message_requests|filtered_threads)\//.test(posix)) folders.add(path.dirname(file));
  }
  return [...folders].sort();
}

export async function parseExportRoot(exportRoot: string): Promise<NormalizedConversation[]> {
  const folders = await discoverConversationFolders(exportRoot);
  const conversations: NormalizedConversation[] = [];
  for (const folder of folders) conversations.push(await parseConversation(folder, exportRoot));
  return conversations;
}

export async function parseConversation(folder: string, exportRoot = folder): Promise<NormalizedConversation> {
  const files = (await fg(['message_*.json'], { cwd: folder, absolute: true, onlyFiles: true })).sort((a, b) => messageFileNumber(a) - messageFileNumber(b));
  const warnings: ParseWarning[] = [];
  const chunks: any[] = [];
  for (const file of files) {
    try { chunks.push({ file, json: JSON.parse(await readFile(file, 'utf8')) }); }
    catch { warnings.push({ severity: 'error', code: 'invalid_json', message: 'Message JSON could not be parsed', sourcePath: file }); }
  }
  const first = chunks[0]?.json ?? {};
  const relFolder = toPosix(path.relative(exportRoot, folder));
  const participants = Array.isArray(first.participants) ? first.participants.map((p: any) => ({ name: decodeMetaString(p?.name) || 'Unknown' })) : [];
  if (!participants.length) warnings.push({ severity: 'warning', code: 'missing_participants', message: 'Conversation is missing participants', sourcePath: folder });
  const sourceThreadKey = relFolder || path.basename(folder);
  const title = decodeMetaString(first.title) || participants.map((p: { name: string }) => p.name).join(', ') || path.basename(folder) || 'Untitled conversation';
  const allMessages: NormalizedMessage[] = [];
  for (const chunk of chunks) {
    const rawMessages = Array.isArray(chunk.json.messages) ? chunk.json.messages : [];
    if (!Array.isArray(chunk.json.messages)) warnings.push({ severity: 'warning', code: 'missing_messages_array', message: 'Message JSON lacks a messages array', sourcePath: chunk.file, sourceThreadKey });
    for (const raw of rawMessages) allMessages.push(normalizeMessage(raw, sourceThreadKey, warnings, chunk.file));
  }
  allMessages.sort((a, b) => a.timestampMs - b.timestampMs || a.fingerprint.localeCompare(b.fingerprint));
  if (!allMessages.length) warnings.push({ severity: 'warning', code: 'zero_messages', message: 'Conversation had zero parseable messages', sourcePath: folder, sourceThreadKey });
  return {
    sourceConversationId: sourceThreadKey,
    sourceThreadKey,
    sourceCategory: categoryFromPath(relFolder),
    kind: participants.length > 2 ? 'group' : participants.length > 0 ? 'direct' : 'unknown',
    title,
    participants,
    sourcePaths: files,
    sourceFolder: folder,
    messages: allMessages,
    rawMetadata: { title: first.title, participants: first.participants },
    warnings
  };
}

function normalizeMessage(raw: any, sourceThreadKey: string, warnings: ParseWarning[], sourcePath: string): NormalizedMessage {
  const timestampMs = Number(raw?.timestamp_ms ?? 0);
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) warnings.push({ severity: 'warning', code: 'invalid_timestamp', message: 'Message had an invalid timestamp', sourcePath, sourceThreadKey });
  const senderName = decodeMetaString(raw?.sender_name) || 'Unknown';
  const text = decodeMetaString(raw?.content);
  const attachments = collectAttachments(raw);
  const reactions = collectReactions(raw);
  const share = raw?.share ? { link: decodeMetaString(raw.share.link), text: decodeMetaString(raw.share.share_text ?? raw.share.text), title: decodeMetaString(raw.share.title), raw: raw.share } : undefined;
  const isUnavailable = Boolean(raw?.is_unsent || raw?.is_deleted || raw?.deleted || raw?.is_unavailable);
  const call = raw?.call_duration || raw?.missed || String(raw?.type ?? '').toLowerCase().includes('call') ? { type: decodeMetaString(raw?.type), durationSeconds: Number(raw?.call_duration ?? 0) || undefined, missed: Boolean(raw?.missed), raw } : undefined;
  const known = Boolean(text || attachments.length || reactions.length || share || isUnavailable || call);
  const messageKind = isUnavailable ? 'unavailable' : call ? 'call' : share && !text && !attachments.length ? 'share' : attachments.length && !text ? 'media' : text ? (attachments.length || share ? 'mixed' : 'text') : known ? 'mixed' : 'unsupported';
  if (messageKind === 'unsupported') warnings.push({ severity: 'warning', code: 'unsupported_message', message: `Unsupported Instagram message type: ${String(raw?.type ?? 'unknown')}`, sourcePath, sourceThreadKey });
  const keyMaterial = { sourceThreadKey, timestampMs, senderName, text, attachments: attachments.map((a) => [a.kind, a.sourceUri, a.originalFilename]), share: share ? { link: share.link, text: share.text, title: share.title } : undefined, type: raw?.type, isUnavailable };
  return { fingerprint: sha256Text(stableJson(keyMaterial)), timestampMs, timestampIso: new Date(timestampMs || 0).toISOString(), senderName, text, attachments, reactions, share, call, isUnavailable, messageKind, raw };
}

function collectAttachments(raw: any): NormalizedAttachment[] {
  const out: NormalizedAttachment[] = [];
  const specs: [string, AttachmentKind][] = [['photos','photo'], ['videos','video'], ['audio_files','audio'], ['files','file'], ['gifs','gif']];
  for (const [field, kind] of specs) for (const item of Array.isArray(raw?.[field]) ? raw[field] : []) out.push(makeAttachment(kind, item));
  if (raw?.sticker) out.push(makeAttachment('sticker', raw.sticker));
  return out;
}
function makeAttachment(kind: AttachmentKind, item: any): NormalizedAttachment {
  const uri = decodeMetaString(item?.uri ?? item?.href ?? item?.src);
  return { kind, sourceUri: uri, originalFilename: uri ? path.basename(uri) : undefined, mimeType: decodeMetaString(item?.mime_type), raw: item };
}
function collectReactions(raw: any): NormalizedReaction[] {
  return (Array.isArray(raw?.reactions) ? raw.reactions : []).map((r: any) => ({ actor: decodeMetaString(r?.actor), reaction: decodeMetaString(r?.reaction), timestampMs: Number(r?.timestamp_ms) || undefined, raw: r }));
}
function messageFileNumber(file: string): number { return Number(path.basename(file).match(/message_(\d+)\.json/)?.[1] ?? '0'); }
function categoryFromPath(p: string): SourceCategory {
  if (p.includes('archived_threads')) return 'archived';
  if (p.includes('message_requests')) return 'message_requests';
  if (p.includes('filtered_threads')) return 'filtered';
  if (p.includes('inbox')) return 'inbox';
  return 'unknown';
}
export async function attachmentExists(conversationFolder: string, sourceUri: string): Promise<boolean> {
  try { await stat(path.resolve(conversationFolder, sourceUri)); return true; } catch { return false; }
}
