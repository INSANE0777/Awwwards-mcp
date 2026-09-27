import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ElementRecord, MotionDna, SiteSummary } from "./types.js";

// Freshness window applied by getSite() when the caller does not pass one.
// Expired lookups are misses (single-arg getSite returns null for rows older
// than this window); getSites(Infinity) remains the stale fallback.
const DEFAULT_SITE_TTL_MS = 10_000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sites (
    slug TEXT PRIMARY KEY, id INTEGER, title TEXT, createdAt INTEGER,
    tags TEXT, thumbnailPath TEXT, liveUrl TEXT, detailPath TEXT,
    awards TEXT, fetchedAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY, value TEXT, fetchedAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS elements (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    cid TEXT,               -- normalized category id (Task 5 fills the taxonomy; raw title until then)
    category TEXT,
    author TEXT,
    builtWith TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
    related TEXT NOT NULL DEFAULT '[]',     -- JSON string[]
    mediaPath TEXT,
    mediaType TEXT,                         -- 'video' | 'image' | NULL
    source TEXT NOT NULL,                   -- 'gallery' | 'site'
    projectId TEXT,
    fetchedAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS motion_dna (
    url TEXT PRIMARY KEY,
    data TEXT NOT NULL,      -- whole MotionDna record as JSON — small corpus, filters run in JS
    capturedAt INTEGER NOT NULL
  );
`;

// FTS5 layer over the elements table — same standalone variant as sites_fts
// (columns stored in the fts table itself, triggers delete+reinsert by the
// unindexed slug; NOT the external-content content= variant). builtWith stays
// a JSON string — unicode61 tokenizes around brackets/quotes, so tokens
// extract cleanly.
const ELEMENTS_FTS_SCHEMA = `
  CREATE VIRTUAL TABLE IF NOT EXISTS elements_fts USING fts5(
    slug UNINDEXED, title, author, builtWith, category, tokenize='porter unicode61'
  );
  CREATE TRIGGER IF NOT EXISTS elements_fts_ai AFTER INSERT ON elements BEGIN
    INSERT INTO elements_fts (slug, title, author, builtWith, category)
    VALUES (new.slug, new.title, new.author, new.builtWith, new.category);
  END;
  CREATE TRIGGER IF NOT EXISTS elements_fts_au AFTER UPDATE OF title, author, builtWith, category ON elements BEGIN
    DELETE FROM elements_fts WHERE slug = new.slug;
    INSERT INTO elements_fts (slug, title, author, builtWith, category)
    VALUES (new.slug, new.title, new.author, new.builtWith, new.category);
  END;
  CREATE TRIGGER IF NOT EXISTS elements_fts_ad AFTER DELETE ON elements BEGIN
    DELETE FROM elements_fts WHERE slug = old.slug;
  END;
`;

// FTS5 full-text layer over the sites table (derived — rebuildable at any
// time). Probe-guarded: if this Node build ships without FTS5, every fts
// statement is skipped and searchSites returns null (server keeps the legacy
// substring path). Columns mirror sites; tags/awards stay JSON strings —
// unicode61 tokenizes around brackets/quotes, so tokens extract cleanly.
const FTS_SCHEMA = `
  CREATE VIRTUAL TABLE IF NOT EXISTS sites_fts USING fts5(
    slug UNINDEXED, title, tags, awards, tokenize='porter unicode61'
  );
  CREATE TRIGGER IF NOT EXISTS sites_fts_ai AFTER INSERT ON sites BEGIN
    INSERT INTO sites_fts (slug, title, tags, awards)
    VALUES (new.slug, new.title, new.tags, new.awards);
  END;
  CREATE TRIGGER IF NOT EXISTS sites_fts_au AFTER UPDATE OF title, tags, awards ON sites BEGIN
    DELETE FROM sites_fts WHERE slug = new.slug;
    INSERT INTO sites_fts (slug, title, tags, awards)
    VALUES (new.slug, new.title, new.tags, new.awards);
  END;
  CREATE TRIGGER IF NOT EXISTS sites_fts_ad AFTER DELETE ON sites BEGIN
    DELETE FROM sites_fts WHERE slug = old.slug;
  END;
`;

interface SiteRow {
  slug: string;
  id: number;
  title: string;
  createdAt: number;
  tags: string;
  thumbnailPath: string;
  liveUrl: string | null;
  detailPath: string;
  awards: string;
  fetchedAt: number;
}

function rowToSite(r: SiteRow): SiteSummary {
  return {
    slug: r.slug,
    id: r.id,
    title: r.title,
    createdAt: r.createdAt,
    tags: JSON.parse(r.tags),
    thumbnailPath: r.thumbnailPath,
    liveUrl: r.liveUrl,
    detailPath: r.detailPath,
    awards: JSON.parse(r.awards),
  };
}

interface ElementRow {
  slug: string;
  title: string;
  cid: string | null;
  category: string | null;
  author: string | null;
  builtWith: string;
  related: string;
  mediaPath: string | null;
  mediaType: "video" | "image" | null;
  source: "gallery" | "site";
  projectId: string | null;
  fetchedAt: number;
}

function rowToElement(r: ElementRow): ElementRecord {
  return {
    slug: r.slug,
    title: r.title,
    cid: r.cid ?? "",
    category: r.category ?? "",
    author: r.author ?? "",
    builtWith: JSON.parse(r.builtWith),
    related: JSON.parse(r.related),
    mediaPath: r.mediaPath ?? "",
    mediaType: r.mediaType,
    source: r.source,
    projectId: r.projectId,
    fetchedAt: r.fetchedAt,
  };
}

export class Cache {
  private readonly dbPath: string;
  private readonly now: () => number;
  readonly imagesDir: string;
  // FTS5 capability of this Node build, probed on the first DB open (the
  // constructor's eager withDb). null = not yet probed; false = FTS5 compiled
  // out → searchSites returns null and callers keep the legacy substring
  // path. Instance-cached so searchSites never re-probes; public so the
  // server layer and tests can branch on it.
  ftsAvailable: boolean | null = null;

  constructor(rootDir: string, now: () => number = Date.now) {
    this.now = now;
    mkdirSync(rootDir, { recursive: true });
    this.imagesDir = join(rootDir, "images");
    mkdirSync(this.imagesDir, { recursive: true });
    this.dbPath = join(rootDir, "cache.db");
    // Create cache.db + schema eagerly so the storage layout exists right
    // after construction. The handle is closed immediately (see withDb).
    this.withDb(() => {});
  }

  // Open → run → close per operation. node:sqlite keeps cache.db open until
  // close(); on Windows an open handle makes the file and its directory
  // undeletable, which broke temp-dir cleanup in tests. Per-operation
  // open/close keeps the same public API with no lingering handles.
  private withDb<T>(fn: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(this.dbPath);
    try {
      db.exec(SCHEMA);
      if (this.ftsAvailable === null) {
        try {
          db.exec(FTS_SCHEMA);
          db.exec(ELEMENTS_FTS_SCHEMA);
          this.ftsAvailable = true;
        } catch {
          this.ftsAvailable = false; // FTS5 compiled out → legacy fallback
        }
      }
      if (this.ftsAvailable) {
        // The fts table is derived and must never gate correctness: if sites
        // has rows but sites_fts is empty (pre-FTS database opened for the
        // first time), rebuild the index. The guard lives inside the INSERT
        // itself (slug NOT IN sites_fts), not only in the counts above: the
        // counts are read non-atomically, so `npm run index` and a first open
        // can both pass them and both run this statement — sites_fts.slug has
        // no unique constraint, so an unguarded re-run would double-index.
        // Afterwards triggers keep it synced.
        const { s: sitesN } = db.prepare("SELECT COUNT(*) AS s FROM sites").get() as { s: number };
        const { s: ftsN } = db.prepare("SELECT COUNT(*) AS s FROM sites_fts").get() as { s: number };
        if (sitesN > 0 && ftsN === 0) {
          db.exec("INSERT INTO sites_fts (slug, title, tags, awards) SELECT slug, title, tags, awards FROM sites WHERE slug NOT IN (SELECT slug FROM sites_fts)");
        }
      }
      return fn(db);
    } finally {
      db.close();
    }
  }

  /** @visibleForTesting */
  withDbForTest(fn: (db: DatabaseSync) => void): void {
    this.withDb(fn);
  }

  upsertSites(sites: SiteSummary[]): void {
    this.withDb((db) => {
      const stmt = db.prepare(
        `INSERT INTO sites (slug, id, title, createdAt, tags, thumbnailPath, liveUrl, detailPath, awards, fetchedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           id=excluded.id, title=excluded.title, createdAt=excluded.createdAt,
           tags=excluded.tags, thumbnailPath=excluded.thumbnailPath,
           liveUrl=excluded.liveUrl, detailPath=excluded.detailPath,
           awards=excluded.awards, fetchedAt=excluded.fetchedAt`,
      );
      const t = this.now();
      // One transaction for the whole batch: each autocommitted INSERT pays a
      // disk sync (~4ms on Windows), which made a 31-card upsert ~150ms and a
      // full index crawl take minutes. A single commit syncs once.
      db.exec("BEGIN");
      try {
        for (const s of sites) {
          stmt.run(
            s.slug, s.id, s.title, s.createdAt, JSON.stringify(s.tags),
            s.thumbnailPath, s.liveUrl, s.detailPath, JSON.stringify(s.awards), t,
          );
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    });
  }

  getSites(maxAgeMs: number): SiteSummary[] {
    return this.withDb((db) => {
      const min = this.now() - maxAgeMs;
      const rows = db.prepare(
        "SELECT * FROM sites WHERE fetchedAt > ? ORDER BY createdAt DESC",
      ).all(min) as unknown as SiteRow[];
      return rows.map(rowToSite);
    });
  }

  countSites(): number {
    return this.withDb((db) =>
      (db.prepare("SELECT COUNT(*) AS count FROM sites").get() as { count: number }).count,
    );
  }

  getSite(slug: string, maxAgeMs: number = DEFAULT_SITE_TTL_MS): SiteSummary | null {
    return this.withDb((db) => {
      const row = db.prepare("SELECT * FROM sites WHERE slug = ?").get(slug) as
        | SiteRow
        | undefined;
      if (!row || row.fetchedAt <= this.now() - maxAgeMs) return null;
      return rowToSite(row);
    });
  }

  // Full-text search over cached sites. matchMode "AND" (default) requires
  // every token; "OR" matches rows containing any token (the server uses OR
  // for its zero-result "loose matches" hint). Each token is a porter-stemmed
  // prefix term, so multi-word queries match rows where the words are
  // scattered across title/tags/awards. Results are bm25-ascending (best
  // match first). Returns all fresh matches unless a limit is passed (e.g.
  // for OR hints). Returns null when FTS5 is unavailable on this build or the
  // query has no usable tokens — callers fall back to legacy search.
  searchSites(
    query: string,
    maxAgeMs: number,
    limit?: number,
    matchMode: "AND" | "OR" = "AND",
  ): SiteSummary[] | null {
    // Sanitization strips quotes/parens/operators, leaving [a-z0-9-] only —
    // the quoted `"tok"*` MATCH string below cannot inject FTS syntax.
    const tokens = query.toLowerCase().split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9-]/g, ""))
      .filter((t) => t.length > 0);
    if (!tokens.length) return null;
    return this.withDb((db) => {
      if (!this.ftsAvailable) return null;
      const match = tokens.map((t) => `"${t}"*`).join(matchMode === "OR" ? " OR " : " AND ");
      const min = this.now() - maxAgeMs;
      const stmt = db.prepare(
        `SELECT s.* FROM sites_fts
         JOIN sites s ON s.slug = sites_fts.slug
         WHERE sites_fts MATCH ? AND s.fetchedAt > ?
         ORDER BY bm25(sites_fts) ASC${limit === undefined ? "" : " LIMIT ?"}`,
      );
      const rows = (limit === undefined ? stmt.all(match, min) : stmt.all(match, min, limit)) as unknown as SiteRow[];
      return rows.map(rowToSite);
    });
  }

  setMeta(key: string, value: unknown): void {
    this.withDb((db) => {
      db.prepare(
        `INSERT INTO meta (key, value, fetchedAt) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, fetchedAt=excluded.fetchedAt`,
      ).run(key, JSON.stringify(value), this.now());
    });
  }

  getMeta<T>(key: string, maxAgeMs: number): T | null {
    return this.withDb((db) => {
      const row = db.prepare("SELECT value, fetchedAt FROM meta WHERE key = ?").get(key) as
        | { value: string; fetchedAt: number }
        | undefined;
      if (!row || row.fetchedAt <= this.now() - maxAgeMs) return null;
      return JSON.parse(row.value) as T;
    });
  }

  deleteMeta(key: string): void {
    this.withDb((db) => {
      db.prepare("DELETE FROM meta WHERE key = ?").run(key);
    });
  }

  // ---- elements (gallery items) ----

  upsertElements(records: ElementRecord[]): void {
    if (records.length === 0) return;
    this.withDb((db) => {
      const stmt = db.prepare(
        `INSERT INTO elements (slug, title, cid, category, author, builtWith, related, mediaPath, mediaType, source, projectId, fetchedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           title=excluded.title, cid=excluded.cid, category=excluded.category,
           author=excluded.author, builtWith=excluded.builtWith, related=excluded.related,
           mediaPath=excluded.mediaPath, mediaType=excluded.mediaType,
           source=excluded.source, projectId=excluded.projectId, fetchedAt=excluded.fetchedAt`,
      );
      // One transaction for the whole batch — same reason as upsertSites.
      db.exec("BEGIN");
      try {
        for (const r of records) {
          stmt.run(
            r.slug, r.title, r.cid, r.category, r.author,
            JSON.stringify(r.builtWith), JSON.stringify(r.related),
            r.mediaPath, r.mediaType, r.source, r.projectId, r.fetchedAt,
          );
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    });
  }

  getElements(slugs: string[]): ElementRecord[] {
    if (slugs.length === 0) return [];
    return this.withDb((db) => {
      const rows = db.prepare(
        `SELECT * FROM elements WHERE slug IN (${slugs.map(() => "?").join(",")})`,
      ).all(...slugs) as unknown as ElementRow[];
      return rows.map(rowToElement);
    });
  }

  // Full-text search over elements. Caller passes a prebuilt FTS query (the
  // server layer owns sanitization/token shaping). Raw FTS match over ALL
  // rows — NO Tier A filter here: any source='gallery' gating is the caller's
  // job (Task 5). No TTL: element rows are reused across gallery pages,
  // staleness is not a correctness gate.
  searchElements(ftsQuery: string, limit: number): ElementRecord[] {
    return this.withDb((db) => {
      if (!this.ftsAvailable) return [];
      const rows = db.prepare(
        `SELECT e.* FROM elements_fts
         JOIN elements e ON e.slug = elements_fts.slug
         WHERE elements_fts MATCH ?
         ORDER BY bm25(elements_fts) ASC
         LIMIT ?`,
      ).all(ftsQuery, limit) as unknown as ElementRow[];
      return rows.map(rowToElement);
    });
  }

  countElements(): number {
    return this.withDb((db) =>
      (db.prepare("SELECT COUNT(*) AS count FROM elements WHERE source='gallery'").get() as { count: number }).count,
    );
  }

  listElements(limit: number): ElementRecord[] {
    return this.withDb((db) => {
      const rows = db.prepare(
        "SELECT * FROM elements ORDER BY fetchedAt DESC LIMIT ?",
      ).all(limit) as unknown as ElementRow[];
      return rows.map(rowToElement);
    });
  }

  // Disk cache keyed by the awwwards asset path (immutable content → no TTL).
  async getImage(assetPath: string, fetcher: () => Promise<Buffer>): Promise<Buffer> {
    const ext = assetPath.endsWith(".png") ? ".png" : ".jpg";
    const file = join(this.imagesDir, createHash("sha1").update(assetPath).digest("hex") + ext);
    try {
      return await readFile(file);
    } catch {
      const buf = await fetcher();
      await writeFile(file, buf);
      return buf;
    }
  }

  // ---- motion dna ----

  upsertMotionDna(dna: MotionDna): void {
    this.withDb((db) => {
      db.prepare(
        `INSERT INTO motion_dna (url, data, capturedAt) VALUES (?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET data=excluded.data, capturedAt=excluded.capturedAt`,
      ).run(dna.url, JSON.stringify(dna), dna.capturedAt);
    });
  }

  getMotionDna(url: string): MotionDna | null {
    return this.withDb((db) => {
      const row = db.prepare("SELECT data FROM motion_dna WHERE url = ?").get(url) as
        | { data: string }
        | undefined;
      return row ? (JSON.parse(row.data) as MotionDna) : null;
    });
  }

  // JS filter over parsed records: small corpora make SQL columns premature.
  // scrubOnly matches the brief exactly: scrubCount >= 2 OR scrubRatio >= 0.5.
  searchMotion(filter: { lib?: string; scrubOnly?: boolean; hasPins?: boolean }): MotionDna[] {
    return this.withDb((db) => {
      const rows = db.prepare("SELECT data FROM motion_dna").all() as { data: string }[];
      return rows
        .map((r) => JSON.parse(r.data) as MotionDna)
        .filter((d) => {
          if (filter.lib && !d.stack.libs.includes(filter.lib)) return false;
          if (filter.scrubOnly && !(d.scroll.scrubCount >= 2 || d.scroll.scrubRatio >= 0.5)) return false;
          if (filter.hasPins && d.scroll.pinCount === 0) return false;
          return true;
        });
    });
  }
}
