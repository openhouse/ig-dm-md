import { DateTime } from 'luxon';
import path from 'node:path';
import type { AppConfig } from '../config.js';

export function formatDate(isoOrMs: string | number, config: AppConfig, header = false): string {
  const dt = typeof isoOrMs === 'number' ? DateTime.fromMillis(isoOrMs) : DateTime.fromISO(isoOrMs);
  const zoned = dt.setZone(config.render.timezone);
  return header ? `${zoned.toFormat('yyyy-LL-dd h:mm a')} ${config.render.timezone}` : zoned.toFormat(config.render.dateFormat);
}

export function renderConversationMarkdown(thread: any, config: AppConfig): string {
  const lines: string[] = [];
  lines.push(`# Instagram DM: ${escapeMd(thread.title)}`, '');
  lines.push(`Participants: ${thread.participantNames.join(', ')}`);
  lines.push(`Source category: ${thread.source_category}`);
  lines.push(`Messages: ${thread.messages.length}`);
  if (thread.first_message_at) lines.push(`First message: ${formatDate(thread.first_message_at, config, true)}`);
  if (thread.last_message_at) lines.push(`Last message: ${formatDate(thread.last_message_at, config, true)}`);
  lines.push('', '---', '');
  const reactionsByMessage = new Map<string, any[]>();
  for (const r of thread.reactions) reactionsByMessage.set(r.synthetic_key, [...(reactionsByMessage.get(r.synthetic_key) ?? []), r]);
  const mediaByMessage = new Map<number, any[]>();
  for (const m of thread.media) mediaByMessage.set(m.message_id, [...(mediaByMessage.get(m.message_id) ?? []), m]);
  for (const m of thread.messages) {
    const prefix = `[${formatDate(m.timestamp_ms, config)}] ${escapeMd(m.sender_name)}: `;
    const raw = JSON.parse(m.raw_json);
    const rendered = renderMessageBody(m, raw, mediaByMessage.get(m.id) ?? [], config);
    const parts = rendered.split('\n');
    lines.push(`${prefix}${parts[0] ?? ''}`);
    for (const part of parts.slice(1)) lines.push(`    ${part}`);
    if (config.render.includeReactions) for (const reaction of reactionsByMessage.get(m.synthetic_key) ?? []) lines.push(`    ↳ Reaction from ${escapeMd(reaction.actor ?? 'Unknown')}: ${escapeMd(reaction.reaction ?? '')}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderMessageBody(m: any, raw: any, media: any[], config: AppConfig): string {
  const bodies: string[] = [];
  if (m.content_text) bodies.push(escapeMessage(m.content_text, config));
  if (raw?.is_unsent || raw?.is_deleted || raw?.deleted || raw?.is_unavailable || m.message_kind === 'unavailable') bodies.push('<Message unavailable>');
  for (const item of media) {
    const name = item.original_filename || item.source_uri || 'attachment';
    if (item.output_relative_path) bodies.push(`<Media omitted: ${escapeMd(name)}> [${item.output_relative_path}]`);
    else bodies.push(`<Media omitted: ${escapeMd(item.source_uri || name)}>`);
  }
  if (raw?.share) bodies.push(`<Shared link: ${escapeMd(raw.share.link ?? raw.share.href ?? raw.share.share_text ?? 'unknown')}>`);
  if (raw?.call_duration) bodies.push(`<Call duration: ${duration(Number(raw.call_duration))}>`);
  else if (raw?.missed || String(raw?.type ?? '').toLowerCase().includes('call')) bodies.push(`<Call event: ${raw?.missed ? 'missed ' : ''}${escapeMd(String(raw?.type ?? 'call'))}>`);
  if (!bodies.length && m.message_kind === 'unsupported') bodies.push(`<unsupported Instagram message type: ${escapeMd(String(raw?.type ?? 'unknown'))}>`);
  return bodies.join('\n');
}
function duration(seconds: number): string { const s = Math.max(0, seconds); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60; return [h,m,sec].map((n) => String(n).padStart(2,'0')).join(':'); }
export function escapeMd(s: string): string { return s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/^([#!>\-*])/gm, '\\$1').replace(/!\[/g, '!\\['); }
function escapeMessage(s: string, config: AppConfig): string { return config.render.escapeMarkdownMessageContent ? escapeMd(s) : s; }
export function mediaOutputName(sourceUri: string, syntheticKey: string): string { const ext = path.extname(sourceUri) || ''; const base = path.basename(sourceUri, ext).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40) || 'media'; return `${base}--${syntheticKey.slice(0,8)}${ext}`; }
