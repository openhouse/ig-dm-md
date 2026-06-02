import type Database from 'better-sqlite3';
import type { NormalizedConversation, ParseWarning } from '../instagram/types.js';
import { stableConversationDir } from '../utils/slug.js';

export type ImportStats = { conversationsParsed: number; messagesImported: number; duplicateMessagesSkipped: number; mediaItemsImported: number; warnings: number; exportImported: boolean };
export type ExportRecord = { id: number; source_kind: string; source_identifier: string; name: string; modified_time?: string; imported_at?: string; warning_count: number; error_count: number };

export function upsertExport(db: Database.Database, source: { sourceKind: string; sourceIdentifier: string; name: string; checksum?: string; size?: number; modifiedTime?: string; raw?: unknown }): number {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO source_exports (source_kind, source_identifier, name, checksum, size, modified_time, imported_at, status, raw_metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', ?)
    ON CONFLICT(source_identifier) DO UPDATE SET checksum=excluded.checksum, size=excluded.size, modified_time=excluded.modified_time, imported_at=excluded.imported_at, status='imported'`).run(source.sourceKind, source.sourceIdentifier, source.name, source.checksum, source.size, source.modifiedTime, now, JSON.stringify(source.raw ?? {}));
  return Number((db.prepare('SELECT id FROM source_exports WHERE source_identifier = ?').get(source.sourceIdentifier) as { id: number }).id);
}

export function importConversations(db: Database.Database, exportId: number, conversations: NormalizedConversation[], selfNames: string[]): ImportStats {
  const stats: ImportStats = { conversationsParsed: conversations.length, messagesImported: 0, duplicateMessagesSkipped: 0, mediaItemsImported: 0, warnings: 0, exportImported: true };
  const tx = db.transaction(() => {
    for (const conv of conversations) {
      const first = conv.messages[0]?.timestampIso;
      const last = conv.messages.at(-1)?.timestampIso;
      const mediaCount = conv.messages.reduce((n, m) => n + m.attachments.length, 0);
      const label = conv.kind === 'direct' ? directLabel(conv.participants.map((p) => p.name), selfNames, conv.title) : conv.title;
      const outputDir = `${conv.sourceCategory}/${conv.kind === 'group' ? 'groups' : conv.kind}/${stableConversationDir(label, conv.sourceThreadKey)}`;
      db.prepare(`INSERT INTO threads (source_thread_key,title,thread_kind,source_category,participant_names_json,first_message_at,last_message_at,message_count,media_count,output_dir,raw_metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_thread_key) DO UPDATE SET title=excluded.title, thread_kind=excluded.thread_kind, source_category=excluded.source_category, participant_names_json=excluded.participant_names_json, first_message_at=COALESCE(MIN(threads.first_message_at, excluded.first_message_at), excluded.first_message_at), last_message_at=MAX(COALESCE(threads.last_message_at,''), COALESCE(excluded.last_message_at,'')), output_dir=excluded.output_dir, raw_metadata_json=threads.raw_metadata_json`).run(conv.sourceThreadKey, conv.title, conv.kind, conv.sourceCategory, JSON.stringify(conv.participants.map((p) => p.name)), first, last, conv.messages.length, mediaCount, outputDir, JSON.stringify({ ...(typeof conv.rawMetadata === 'object' && conv.rawMetadata ? conv.rawMetadata : {}), sourcePaths: conv.sourcePaths }));
      const threadId = Number((db.prepare('SELECT id FROM threads WHERE source_thread_key = ?').get(conv.sourceThreadKey) as { id: number }).id);
      for (const warning of conv.warnings) insertWarning(db, exportId, threadId, warning), stats.warnings++;
      for (const message of conv.messages) {
        const now = new Date().toISOString();
        const res = db.prepare(`INSERT OR IGNORE INTO messages (thread_id, synthetic_key, sender_name, timestamp_ms, timestamp_iso, content_text, normalized_text, message_kind, raw_json, first_seen_export_id, last_seen_export_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(threadId, message.fingerprint, message.senderName, message.timestampMs, message.timestampIso, message.text, message.text, message.messageKind, JSON.stringify(message.raw), exportId, exportId, now, now);
        const row = db.prepare('SELECT id FROM messages WHERE synthetic_key = ?').get(message.fingerprint) as { id: number };
        if (res.changes === 0) { stats.duplicateMessagesSkipped++; db.prepare('UPDATE messages SET last_seen_export_id = ?, updated_at = ? WHERE id = ?').run(exportId, now, row.id); }
        else stats.messagesImported++;
        for (const media of message.attachments) {
          const mres = db.prepare('INSERT OR IGNORE INTO media (message_id, thread_id, source_uri, original_filename, output_relative_path, mime_guess, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(row.id, threadId, media.sourceUri, media.originalFilename, media.outputRelativePath, media.mimeType, JSON.stringify(media.raw ?? {}));
          if (mres.changes) stats.mediaItemsImported++;
        }
        for (const reaction of message.reactions) db.prepare('INSERT OR IGNORE INTO reactions (message_id, actor, reaction, timestamp_ms, raw_json) VALUES (?, ?, ?, ?, ?)').run(row.id, reaction.actor, reaction.reaction, reaction.timestampMs, JSON.stringify(reaction.raw ?? {}));
      }
      const counts = db.prepare('SELECT COUNT(*) message_count, (SELECT COUNT(*) FROM media WHERE thread_id = ?) media_count FROM messages WHERE thread_id = ?').get(threadId, threadId) as any;
      db.prepare('UPDATE threads SET message_count = ?, media_count = ?, first_message_at = (SELECT MIN(timestamp_iso) FROM messages WHERE thread_id=?), last_message_at=(SELECT MAX(timestamp_iso) FROM messages WHERE thread_id=?) WHERE id=?').run(counts.message_count, counts.media_count, threadId, threadId, threadId);
    }
    db.prepare('UPDATE source_exports SET warning_count = ? WHERE id = ?').run(stats.warnings, exportId);
  });
  tx();
  return stats;
}

function insertWarning(db: Database.Database, exportId: number, threadId: number | undefined, warning: ParseWarning) { db.prepare('INSERT INTO warnings (source_export_id, thread_id, severity, code, message, source_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(exportId, threadId, warning.severity, warning.code, warning.message, warning.sourcePath, new Date().toISOString()); }
function directLabel(names: string[], selfNames: string[], title: string): string { return names.find((n) => !selfNames.includes(n)) ?? title ?? names[0] ?? 'Direct chat'; }
export function getRenderData(db: Database.Database) {
  const threads = db.prepare('SELECT * FROM threads ORDER BY source_category, thread_kind, title').all() as any[];
  return {
    threads: threads.map((t) => ({ ...t, participantNames: JSON.parse(t.participant_names_json), messages: db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY timestamp_ms, synthetic_key').all(t.id), media: db.prepare('SELECT * FROM media WHERE thread_id = ?').all(t.id), reactions: db.prepare('SELECT r.*, m.synthetic_key FROM reactions r JOIN messages m ON m.id=r.message_id WHERE m.thread_id = ?').all(t.id), warnings: db.prepare('SELECT * FROM warnings WHERE thread_id = ?').all(t.id) })),
    exports: db.prepare('SELECT * FROM source_exports ORDER BY imported_at').all() as ExportRecord[],
    warnings: db.prepare('SELECT w.*, s.name source_name, t.title thread_title FROM warnings w LEFT JOIN source_exports s ON s.id=w.source_export_id LEFT JOIN threads t ON t.id=w.thread_id ORDER BY w.id').all() as any[]
  };
}
