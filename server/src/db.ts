import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";

export const dataDir = process.env.DATA_DIR || path.resolve("data");
export const mediaDir = process.env.MEDIA_DIR || path.resolve("media");

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(mediaDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "ad-terminal.sqlite"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

export function now() {
  return new Date().toISOString();
}

export function json<T>(value: T): string {
  return JSON.stringify(value ?? null);
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      last_login_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER,
      original_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('image', 'video')),
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      duration_seconds REAL,
      width INTEGER,
      height INTEGER,
      storage_name TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(folder_id) REFERENCES media_folders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS media_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_asset_tag_links (
      asset_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY(asset_id, tag_id),
      FOREIGN KEY(asset_id) REFERENCES media_assets(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES media_tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS device_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      device_code TEXT NOT NULL UNIQUE,
      token TEXT UNIQUE,
      pending_token TEXT UNIQUE,
      pairing_code TEXT UNIQUE,
      bound_at TEXT,
      last_heartbeat_at TEXT,
      current_item TEXT,
      current_version INTEGER,
      ip_address TEXT,
      app_version TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_tag_links (
      device_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY(device_id, tag_id),
      FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES device_tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      default_image_duration INTEGER NOT NULL DEFAULT 8,
      is_draft INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      asset_id INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      image_duration INTEGER,
      image_fit TEXT NOT NULL DEFAULT 'contain' CHECK (image_fit IN ('contain', 'cover')),
      FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY(asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS publish_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      target_tag_ids TEXT NOT NULL,
      target_device_ids TEXT NOT NULL,
      resolved_device_ids TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS device_assignments (
      device_id INTEGER PRIMARY KEY,
      playlist_id INTEGER NOT NULL,
      publish_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      assigned_at TEXT NOT NULL,
      FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
      FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY(publish_id) REFERENCES publish_records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS default_playlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      image_duration INTEGER,
      image_fit TEXT NOT NULL DEFAULT 'contain' CHECK (image_fit IN ('contain', 'cover')),
      FOREIGN KEY(asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );
  `);

  const row = db.prepare("SELECT id FROM admin_users WHERE id = 1").get();
  if (!row) {
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD || "admin123";
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO admin_users (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)").run(username, hash, now());
  }
}

export function all<T = any>(sql: string, params: any[] = []): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T = any>(sql: string, params: any[] = []): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
