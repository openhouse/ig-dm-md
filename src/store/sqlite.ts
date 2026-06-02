import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

export function openDatabase(stateDir: string): Database.Database {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const db = new Database(path.join(stateDir, 'state.sqlite'));
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

export function migrate(db: Database.Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS source_exports (id INTEGER PRIMARY KEY, source_kind TEXT NOT NULL, source_identifier TEXT NOT NULL UNIQUE, name TEXT NOT NULL, mime_type TEXT, checksum TEXT, size INTEGER, modified_time TEXT, imported_at TEXT, status TEXT NOT NULL, warning_count INTEGER DEFAULT 0, error_count INTEGER DEFAULT 0, raw_metadata_json TEXT);
CREATE TABLE IF NOT EXISTS threads (id INTEGER PRIMARY KEY, source_thread_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, thread_kind TEXT NOT NULL, source_category TEXT NOT NULL, participant_names_json TEXT NOT NULL, first_message_at TEXT, last_message_at TEXT, message_count INTEGER DEFAULT 0, media_count INTEGER DEFAULT 0, output_dir TEXT, raw_metadata_json TEXT);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL, synthetic_key TEXT NOT NULL UNIQUE, sender_name TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, timestamp_iso TEXT NOT NULL, content_text TEXT, normalized_text TEXT, message_kind TEXT NOT NULL, raw_json TEXT NOT NULL, first_seen_export_id INTEGER, last_seen_export_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(thread_id) REFERENCES threads(id));
CREATE TABLE IF NOT EXISTS media (id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL, thread_id INTEGER NOT NULL, source_uri TEXT, original_filename TEXT, output_relative_path TEXT, mime_guess TEXT, checksum TEXT, raw_json TEXT, UNIQUE(message_id, source_uri), FOREIGN KEY(message_id) REFERENCES messages(id));
CREATE TABLE IF NOT EXISTS reactions (id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL, actor TEXT, reaction TEXT, timestamp_ms INTEGER, raw_json TEXT, UNIQUE(message_id, actor, reaction, timestamp_ms), FOREIGN KEY(message_id) REFERENCES messages(id));
CREATE TABLE IF NOT EXISTS warnings (id INTEGER PRIMARY KEY, source_export_id INTEGER, thread_id INTEGER, message_id INTEGER, severity TEXT NOT NULL, code TEXT NOT NULL, message TEXT NOT NULL, source_path TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_runs (id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, source_kind TEXT NOT NULL, exports_discovered INTEGER DEFAULT 0, exports_imported INTEGER DEFAULT 0, conversations_parsed INTEGER DEFAULT 0, messages_imported INTEGER DEFAULT 0, duplicate_messages_skipped INTEGER DEFAULT 0, media_items_imported INTEGER DEFAULT 0, warning_count INTEGER DEFAULT 0, error_count INTEGER DEFAULT 0);
`);
}
