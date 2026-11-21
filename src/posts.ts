import { db } from "./db";
import { renderMarkdown } from "./markdown";
import { fromRow, type Media, mediaById } from "./media";

export type Tag = { name: string; slug: string };

export type Post = {
  id: number;
  author_id: number;
  author: string;
  title: string;
  slug: string;
  description: string;
  body: string; // Markdown source
  body_html: string; // rendered at save time, so page views never parse Markdown
  excerpt: string;
  reading_min: number;
  cover_media_id: string | null;
  cover: Media | null;
  published: number;
  published_at: number | null;
  created_at: number;
  updated_at: number;
};

type Row = Omit<Post, "cover"> & {
  c_ext: string | null;
  c_widths: string | null;
  c_width: number | null;
  c_height: number | null;
};

export const PAGE_SIZE = 10;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SELECT = `
  SELECT p.id, p.author_id, u.username AS author, p.title, p.slug, p.description, p.body, p.body_html,
         p.excerpt, p.reading_min, p.cover_media_id, p.published, p.published_at, p.created_at, p.updated_at,
         m.ext AS c_ext, m.widths AS c_widths, m.width AS c_width, m.height AS c_height
  FROM posts p
  JOIN users u ON u.id = p.author_id
  LEFT JOIN media m ON m.id = p.cover_media_id`;
const NEWEST = "ORDER BY p.published_at DESC, p.id DESC";

function toPost({ c_ext, c_widths, c_width, c_height, ...p }: Row): Post {
  const cover =
    p.cover_media_id && c_ext && c_widths
      ? fromRow({ id: p.cover_media_id, ext: c_ext, widths: c_widths, width: c_width!, height: c_height! })
      : null;
  return { ...p, cover };
}

const qPublished = db.query<Row, [number, number]>(`${SELECT} WHERE p.published = 1 ${NEWEST} LIMIT ? OFFSET ?`);
const qPublishedByTag = db.query<Row, [number, number, number]>(
  `${SELECT} JOIN post_tags pt ON pt.post_id = p.id WHERE pt.tag_id = ? AND p.published = 1 ${NEWEST} LIMIT ? OFFSET ?`,
);
const qAll = db.query<Row, []>(`${SELECT} ORDER BY p.published = 1, COALESCE(p.published_at, p.created_at) DESC`);
const qBySlug = db.query<Row, [string]>(`${SELECT} WHERE p.slug = ?`);
const qById = db.query<Row, [number]>(`${SELECT} WHERE p.id = ?`);
const qRedirect = db.query<{ slug: string }, [string]>(
  "SELECT p.slug FROM slug_redirects r JOIN posts p ON p.id = r.post_id WHERE r.old_slug = ?",
);
const qSlugOwner = db.query<{ id: number }, [string]>("SELECT id FROM posts WHERE slug = ?");

const qTagsFor = db.query<Tag, [number]>(
  "SELECT t.name, t.slug FROM tags t JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ? ORDER BY t.name COLLATE NOCASE",
);
const qTagBySlug = db.query<Tag & { id: number }, [string]>("SELECT id, name, slug FROM tags WHERE slug = ?");
const qTagCounts = db.query<Tag & { count: number; lastmod: number }, []>(`
  SELECT t.name, t.slug, COUNT(*) AS count, MAX(p.updated_at) AS lastmod
  FROM tags t JOIN post_tags pt ON pt.tag_id = t.id JOIN posts p ON p.id = pt.post_id AND p.published = 1
  GROUP BY t.id ORDER BY t.name COLLATE NOCASE`);

const qInsert = db.query<{ id: number }, [number, string, string, string, string, string, string, number, string | null, number, number | null, number, number]>(`
  INSERT INTO posts (author_id, title, slug, description, body, body_html, excerpt, reading_min, cover_media_id, published, published_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`);
const qUpdate = db.query(`
  UPDATE posts SET title = ?, slug = ?, description = ?, body = ?, body_html = ?, excerpt = ?, reading_min = ?,
                   cover_media_id = ?, published = ?, published_at = ?, updated_at = ?
  WHERE id = ?`);
const qSetRendered = db.query("UPDATE posts SET body_html = ?, excerpt = ?, reading_min = ? WHERE id = ?");
const qDelete = db.query("DELETE FROM posts WHERE id = ?");

const qAddRedirect = db.query(
  "INSERT INTO slug_redirects (old_slug, post_id) VALUES (?, ?) ON CONFLICT (old_slug) DO UPDATE SET post_id = excluded.post_id",
);
const qDropRedirect = db.query("DELETE FROM slug_redirects WHERE old_slug = ?");
const qClearTags = db.query("DELETE FROM post_tags WHERE post_id = ?");
const qUpsertTag = db.query<{ id: number }, [string, string]>(
  "INSERT INTO tags (name, slug) VALUES (?, ?) ON CONFLICT (slug) DO UPDATE SET slug = slug RETURNING id",
);
const qLinkTag = db.query("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)");
const qPruneTags = db.query("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM post_tags)");

// ---- reads

function page(rows: Row[]) {
  return { items: rows.slice(0, PAGE_SIZE).map(toPost), hasNext: rows.length > PAGE_SIZE };
}
// Fetch one extra row to know whether an "Older" link is needed.
export const listPublished = (pageNum: number) => page(qPublished.all(PAGE_SIZE + 1, (pageNum - 1) * PAGE_SIZE));
export const listByTag = (tagId: number, pageNum: number) =>
  page(qPublishedByTag.all(tagId, PAGE_SIZE + 1, (pageNum - 1) * PAGE_SIZE));
export const latest = (n: number) => qPublished.all(n, 0).map(toPost);
export const listAll = () => qAll.all().map(toPost);

const maybe = (r: Row | null) => (r ? toPost(r) : null);
export const bySlug = (slug: string) => maybe(qBySlug.get(slug));
export const byId = (id: number) => maybe(qById.get(id));
/** Current slug for a post that used to live at `oldSlug`, if any. */
export const redirectFor = (oldSlug: string) => qRedirect.get(oldSlug)?.slug ?? null;

export const tagsFor = (postId: number) => qTagsFor.all(postId);
export const tagBySlug = (slug: string) => qTagBySlug.get(slug);
export const tagCounts = () => qTagCounts.all();

// ---- writes

export function slugify(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

export type PostInput = {
  title: string;
  slug: string;
  description: string;
  tags: string; // comma separated
  cover: string; // media id or ""
  body: string;
  published: boolean;
};

export function readInput(form: { get(name: string): unknown }): PostInput {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  return {
    title: s("title"),
    slug: s("slug").toLowerCase(),
    description: s("description").replace(/\s+/g, " "),
    tags: s("tags"),
    cover: s("cover"),
    body: String(form.get("body") ?? "").replace(/\r\n/g, "\n").trim(),
    published: form.get("published") === "on",
  };
}

export const inputFrom = (p: Post, tags: Tag[]): PostInput => ({
  title: p.title,
  slug: p.slug,
  description: p.description,
  tags: tags.map((t) => t.name).join(", "),
  cover: p.cover_media_id ?? "",
  body: p.body,
  published: !!p.published,
});

function parseTags(raw: string): Tag[] {
  const bySlug = new Map<string, string>();
  for (const name of raw.split(",").map((t) => t.trim().replace(/\s+/g, " "))) {
    const slug = slugify(name);
    if (slug && !bySlug.has(slug)) bySlug.set(slug, name);
  }
  return [...bySlug].map(([slug, name]) => ({ slug, name }));
}

/** Creates (no `id`) or updates a post. Returns its slug, or an error message for the form. */
export function save(authorId: number, input: PostInput, id?: number): { slug: string } | { error: string } {
  const { title, description, body, published } = input;
  if (!title || title.length > 200) return { error: "Title is required (max 200 characters)." };
  if (!body || body.length > 200_000) return { error: "Body is required (max 200,000 characters)." };
  if (description.length > 300) return { error: "Description must be at most 300 characters (aim for ~155)." };

  const tags = parseTags(input.tags);
  if (tags.length > 10 || tags.some((t) => t.name.length > 40)) return { error: "Up to 10 tags, each at most 40 characters." };

  let slug = input.slug;
  if (!slug) {
    // No slug given: derive one from the title and add -2, -3… if it is taken.
    const base = slugify(title) || "post";
    slug = base;
    for (let n = 2; (qSlugOwner.get(slug)?.id ?? id) !== id; n++) slug = `${base}-${n}`;
  }
  if (!SLUG_RE.test(slug) || slug.length > 100) return { error: "Slug may only contain a-z, 0-9 and single dashes (max 100)." };
  const owner = qSlugOwner.get(slug);
  if (owner && owner.id !== id) return { error: `The slug "${slug}" is already used by another post.` };

  const cover = input.cover || null;
  if (cover && !mediaById(cover)) return { error: "Cover image not found. Please upload it again." };

  const existing = id ? byId(id) : null;
  if (id && !existing) return { error: "Post not found." };

  const r = renderMarkdown(body);
  const now = Date.now();
  // First time a post is published fixes its public date; unpublishing and republishing keeps it.
  const publishedAt = existing?.published_at ?? (published ? now : null);

  db.transaction(() => {
    let postId: number;
    if (existing) {
      postId = existing.id;
      qUpdate.run(title, slug, description, body, r.html, r.excerpt, r.readingMin, cover, published ? 1 : 0, publishedAt, now, postId);
      // Keep old links working: /posts/old-slug → 301 → /posts/new-slug
      if (existing.slug !== slug) qAddRedirect.run(existing.slug, postId);
    } else {
      postId = qInsert.get(authorId, title, slug, description, body, r.html, r.excerpt, r.readingMin, cover, published ? 1 : 0, publishedAt, now, now)!.id;
    }
    qDropRedirect.run(slug);

    qClearTags.run(postId);
    for (const t of tags) qLinkTag.run(postId, qUpsertTag.get(t.name, t.slug)!.id);
    qPruneTags.run();
  })();

  return { slug };
}

export function remove(id: number) {
  db.transaction(() => {
    qDelete.run(id);
    qPruneTags.run();
  })();
}

/** Re-renders every post's HTML. Runs at startup so renderer changes apply after a deploy. */
export function rerenderAll() {
  const rows = db.query<{ id: number; body: string; body_html: string }, []>("SELECT id, body, body_html FROM posts").all();
  let changed = 0;
  db.transaction(() => {
    for (const row of rows) {
      const r = renderMarkdown(row.body);
      if (r.html === row.body_html) continue;
      qSetRendered.run(r.html, r.excerpt, r.readingMin, row.id);
      changed++;
    }
  })();
  if (changed) console.log(`[posts] re-rendered ${changed} post(s)`);
}
