import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const path = process.env.DB_PATH ?? join(import.meta.dir, "..", "data", "blog.sqlite");
/** Folder holding the database and uploaded media. */
export const DATA_DIR = dirname(path);
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path, { create: true, strict: true });

// WAL = readers never block the writer; NORMAL sync is safe with WAL and much cheaper on slow disks.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

// Each entry runs once, in order; PRAGMA user_version records how far a database has got.
const MIGRATIONS = [
  // 1: initial schema
  `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY,
    author_id  INTEGER NOT NULL REFERENCES users(id),
    title      TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    body       TEXT NOT NULL,
    published  INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS posts_published_created ON posts (published, created_at DESC);
  CREATE TABLE IF NOT EXISTS login_attempts (
    key          TEXT PRIMARY KEY,
    count        INTEGER NOT NULL,
    window_start INTEGER NOT NULL
  ) WITHOUT ROWID;
  `,
  // 2: Markdown, cover images, media, tags, slug redirects
  `
  CREATE TABLE media (
    id         TEXT PRIMARY KEY,
    ext        TEXT NOT NULL,
    widths     TEXT NOT NULL,
    width      INTEGER NOT NULL,
    height     INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  ) WITHOUT ROWID;

  ALTER TABLE posts ADD COLUMN description    TEXT NOT NULL DEFAULT '';
  ALTER TABLE posts ADD COLUMN body_html      TEXT NOT NULL DEFAULT '';
  ALTER TABLE posts ADD COLUMN excerpt        TEXT NOT NULL DEFAULT '';
  ALTER TABLE posts ADD COLUMN reading_min    INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE posts ADD COLUMN cover_media_id TEXT REFERENCES media(id) ON DELETE SET NULL;
  ALTER TABLE posts ADD COLUMN published_at   INTEGER;
  UPDATE posts SET published_at = created_at WHERE published = 1;
  DROP INDEX IF EXISTS posts_published_created;
  CREATE INDEX posts_feed ON posts (published, published_at DESC);

  CREATE TABLE tags (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE
  );
  CREATE TABLE post_tags (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
  ) WITHOUT ROWID;
  CREATE INDEX post_tags_tag ON post_tags (tag_id);

  CREATE TABLE slug_redirects (
    old_slug TEXT PRIMARY KEY,
    post_id  INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE
  ) WITHOUT ROWID;
  `,
];

const current = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
for (let v = current; v < MIGRATIONS.length; v++) {
  db.transaction(() => {
    db.exec(MIGRATIONS[v]!);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  })();
  if (current > 0 || v > 0) console.log(`[db] migrated to schema v${v + 1}`);
}
