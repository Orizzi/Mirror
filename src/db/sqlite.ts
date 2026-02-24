import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import type { MirrorEvent, MirrorEventKind, MirrorEventLevel, MirrorRecord } from '../types.js';

export class MirrorDb {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mirrors (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        target_origin TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_path TEXT,
        disabled INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        level TEXT NOT NULL,
        kind TEXT NOT NULL,
        slug TEXT,
        message TEXT NOT NULL,
        meta_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_events_at ON events(at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
    `);
  }

  private rowToMirror(row: any): MirrorRecord {
    return {
      id: row.id,
      slug: row.slug,
      targetOrigin: row.target_origin,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastPath: row.last_path,
      disabled: Boolean(row.disabled)
    };
  }

  private rowToEvent(row: any): MirrorEvent {
    return {
      id: row.id,
      at: row.at,
      level: row.level,
      kind: row.kind,
      slug: row.slug,
      message: row.message,
      meta: row.meta_json ? JSON.parse(row.meta_json) : undefined
    };
  }

  private id(prefix: string) {
    return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
  }

  findMirrorBySlug(slug: string): MirrorRecord | null {
    const row = this.db
      .prepare('SELECT * FROM mirrors WHERE slug = ?')
      .get(slug);
    return row ? this.rowToMirror(row) : null;
  }

  findMirrorByOrigin(targetOrigin: string): MirrorRecord | null {
    const row = this.db
      .prepare('SELECT * FROM mirrors WHERE target_origin = ? AND disabled = 0')
      .get(targetOrigin);
    return row ? this.rowToMirror(row) : null;
  }

  listMirrorsRecent(limit = 20): MirrorRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM mirrors ORDER BY updated_at DESC LIMIT ?')
      .all(limit);
    return rows.map((row: any) => this.rowToMirror(row));
  }

  countMirrors(): number {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM mirrors').get() as { c: number };
    return row.c;
  }

  createMirror(slug: string, targetOrigin: string, lastPath: string | null) {
    const now = new Date().toISOString();
    const id = this.id('mir');
    this.db
      .prepare(
        `INSERT INTO mirrors (id, slug, target_origin, created_at, updated_at, last_path, disabled)
         VALUES (?, ?, ?, ?, ?, ?, 0)`
      )
      .run(id, slug, targetOrigin, now, now, lastPath);
    return this.findMirrorBySlug(slug)!;
  }

  touchMirror(slug: string, lastPath: string | null) {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE mirrors SET updated_at = ?, last_path = COALESCE(?, last_path) WHERE slug = ?')
      .run(now, lastPath, slug);
  }

  setMirrorDisabled(slug: string, disabled: boolean) {
    this.db
      .prepare('UPDATE mirrors SET disabled = ?, updated_at = ? WHERE slug = ?')
      .run(disabled ? 1 : 0, new Date().toISOString(), slug);
    return this.findMirrorBySlug(slug);
  }

  logEvent(params: {
    level: MirrorEventLevel;
    kind: MirrorEventKind;
    message: string;
    slug?: string | null;
    meta?: Record<string, unknown>;
  }): MirrorEvent {
    const event: MirrorEvent = {
      id: this.id('evt'),
      at: new Date().toISOString(),
      level: params.level,
      kind: params.kind,
      slug: params.slug ?? null,
      message: params.message,
      meta: params.meta
    };
    this.db
      .prepare(
        'INSERT INTO events (id, at, level, kind, slug, message, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        event.id,
        event.at,
        event.level,
        event.kind,
        event.slug,
        event.message,
        event.meta ? JSON.stringify(event.meta) : null
      );
    return event;
  }

  listEventsRecent(limit = 50): MirrorEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events ORDER BY at DESC LIMIT ?')
      .all(limit);
    return rows.map((row: any) => this.rowToEvent(row));
  }
}
