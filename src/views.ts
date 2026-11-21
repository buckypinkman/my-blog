import { adminJs, css } from "./assets";
import type { User } from "./auth";
import * as cfg from "./config";
import { html, jsonLd, raw, type Safe } from "./html";
import { heightAt, type Media, mediaUrl, srcset, widthNear } from "./media";
import type { Post, PostInput, Tag } from "./posts";

// ---------- helpers

const abs = (path: string) => cfg.SITE_URL + path;
const iso = (ms: number) => new Date(ms).toISOString();
const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(cfg.SITE_LANG, { year: "numeric", month: "long", day: "numeric" });
const authorName = (p: Post) => cfg.AUTHOR_NAME || p.author;
const postDate = (p: Post) => p.published_at ?? p.created_at;
const summary = (p: Post) => p.description || p.excerpt;

function img(m: Media, opts: { sizes: string; alt?: string; eager?: boolean; target?: number }) {
  const w = widthNear(m, opts.target ?? 960);
  return html`<img src="${mediaUrl(m, w)}" srcset="${srcset(m)}" sizes="${opts.sizes}" width="${m.width}" height="${m.height}"
    alt="${opts.alt ?? ""}" decoding="async" ${opts.eager ? raw(`fetchpriority="high"`) : raw(`loading="lazy"`)}>`;
}

// ---------- layout + <head> SEO

type Meta = {
  title: string; // without the site name
  description?: string;
  path?: string; // canonical path, e.g. "/posts/hello"
  noindex?: boolean;
  type?: "website" | "article";
  image?: Media | null;
  imageAlt?: string;
  article?: { published: number; modified: number; tags: string[] };
  structured?: object;
  wide?: boolean;
  adminScript?: boolean;
};

function head(m: Meta) {
  const fullTitle = m.title === cfg.SITE_TITLE ? m.title : `${m.title} · ${cfg.SITE_TITLE}`;
  const ogW = m.image ? widthNear(m.image, 1200) : 0;
  return html`
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
${m.description ? html`<meta name="description" content="${m.description}">` : ""}
${m.noindex ? html`<meta name="robots" content="noindex, nofollow">` : ""}
${m.path && !m.noindex ? html`<link rel="canonical" href="${abs(m.path)}">` : ""}
<meta property="og:site_name" content="${cfg.SITE_TITLE}">
<meta property="og:type" content="${m.type ?? "website"}">
<meta property="og:title" content="${m.title}">
${m.description ? html`<meta property="og:description" content="${m.description}">` : ""}
${m.path ? html`<meta property="og:url" content="${abs(m.path)}">` : ""}
<meta property="og:locale" content="${cfg.SITE_LANG.replace("-", "_")}">
${m.image
  ? html`<meta property="og:image" content="${abs(mediaUrl(m.image, ogW))}">
<meta property="og:image:width" content="${ogW}">
<meta property="og:image:height" content="${heightAt(m.image, ogW)}">
${m.imageAlt ? html`<meta property="og:image:alt" content="${m.imageAlt}">` : ""}
<meta name="twitter:card" content="summary_large_image">`
  : html`<meta name="twitter:card" content="summary">`}
${m.article
  ? html`<meta property="article:published_time" content="${iso(m.article.published)}">
<meta property="article:modified_time" content="${iso(m.article.modified)}">
${m.article.tags.map((t) => html`<meta property="article:tag" content="${t}">`)}`
  : ""}
<link rel="alternate" type="application/rss+xml" title="${cfg.SITE_TITLE}" href="${abs("/feed.xml")}">
<link rel="stylesheet" href="${css.url}">
${m.structured ? jsonLd(m.structured) : ""}
${m.adminScript ? html`<script src="${adminJs.url}" defer></script>` : ""}`;
}

function layout(meta: Meta, user: User | null, body: Safe) {
  return html`<!doctype html>
<html lang="${cfg.SITE_LANG}">
<head>${head(meta)}
</head>
<body${meta.wide ? raw(` class="wide"`) : ""}>
<header class="site">
  <a class="brand" href="/">${cfg.SITE_TITLE}</a>
  <nav aria-label="Main">
    ${user
      ? html`<a href="/admin">Dashboard</a><a href="/admin/new">New post</a>
        <form method="post" action="/logout"><button class="link">Log out</button></form>`
      : html`<a href="/tags">Tags</a><a href="/feed.xml">RSS</a>`}
  </nav>
</header>
<main id="main">${body}</main>
<footer class="site">© ${new Date().getFullYear()} ${cfg.SITE_TITLE} · <a href="/feed.xml">RSS</a></footer>
</body>
</html>`;
}

// ---------- public pages

function postList(posts: Post[]) {
  if (!posts.length) return html`<p class="muted">No posts yet.</p>`;
  return html`<ul class="post-list">
    ${posts.map(
      (p) => html`<li>
        ${p.cover
          ? html`<a class="thumb" href="/posts/${p.slug}" tabindex="-1" aria-hidden="true">${img(p.cover, { sizes: "(max-width: 560px) 100vw, 200px", target: 480 })}</a>`
          : ""}
        <div>
          <h2><a href="/posts/${p.slug}">${p.title}</a></h2>
          <p class="meta"><time datetime="${iso(postDate(p))}">${fmtDate(postDate(p))}</time> · ${p.reading_min} min read</p>
          <p>${summary(p)}</p>
        </div>
      </li>`,
    )}
  </ul>`;
}

function pager(base: string, pageNum: number, hasNext: boolean) {
  const href = (n: number) => (n === 1 ? base : `${base}?page=${n}`);
  if (pageNum === 1 && !hasNext) return "";
  return html`<nav class="pager" aria-label="Pagination">
    ${pageNum > 1 ? html`<a rel="prev" href="${href(pageNum - 1)}">← Newer posts</a>` : html`<span></span>`}
    ${hasNext ? html`<a rel="next" href="${href(pageNum + 1)}">Older posts →</a>` : ""}
  </nav>`;
}

export function home(user: User | null, posts: Post[], pageNum: number, hasNext: boolean) {
  const first = pageNum === 1;
  return layout(
    {
      title: first ? cfg.SITE_TITLE : `Page ${pageNum}`,
      description: cfg.SITE_DESCRIPTION || undefined,
      path: first ? "/" : `/?page=${pageNum}`,
      structured: first
        ? { "@context": "https://schema.org", "@type": "WebSite", name: cfg.SITE_TITLE, url: abs("/"), description: cfg.SITE_DESCRIPTION || undefined }
        : undefined,
    },
    user,
    html`<section class="intro">
      <h1>${first ? cfg.SITE_TITLE : `${cfg.SITE_TITLE}: page ${pageNum}`}</h1>
      ${first && cfg.SITE_DESCRIPTION ? html`<p>${cfg.SITE_DESCRIPTION}</p>` : ""}
    </section>
    ${postList(posts)}
    ${pager("/", pageNum, hasNext)}`,
  );
}

export function post(user: User | null, p: Post, tags: Tag[]) {
  const path = `/posts/${p.slug}`;
  const date = postDate(p);
  return layout(
    {
      title: p.title,
      description: summary(p),
      path,
      noindex: !p.published,
      type: "article",
      image: p.cover,
      imageAlt: p.title,
      article: { published: date, modified: p.updated_at, tags: tags.map((t) => t.name) },
      structured: {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: p.title,
        description: summary(p),
        datePublished: iso(date),
        dateModified: iso(p.updated_at),
        author: { "@type": "Person", name: authorName(p) },
        mainEntityOfPage: abs(path),
        url: abs(path),
        image: p.cover ? [abs(mediaUrl(p.cover))] : undefined,
        keywords: tags.length ? tags.map((t) => t.name).join(", ") : undefined,
      },
    },
    user,
    html`<article>
      <header class="post-head">
        <h1>${p.title}</h1>
        <p class="meta">
          <time datetime="${iso(date)}">${fmtDate(date)}</time> · ${authorName(p)} · ${p.reading_min} min read
          ${p.published ? "" : html` · <span class="badge">Draft</span>`}
          ${user ? html` · <a href="/admin/posts/${p.id}/edit">Edit</a>` : ""}
        </p>
      </header>
      ${p.cover ? html`<figure class="cover">${img(p.cover, { sizes: "(max-width: 720px) 100vw, 688px", eager: true, target: 1200 })}</figure>` : ""}
      <div class="prose">${raw(p.body_html)}</div>
      ${tags.length
        ? html`<ul class="tags" aria-label="Tags">${tags.map((t) => html`<li><a href="/tags/${t.slug}" rel="tag">#${t.name}</a></li>`)}</ul>`
        : ""}
    </article>`,
  );
}

export function tag(user: User | null, t: Tag, posts: Post[], pageNum: number, hasNext: boolean) {
  const base = `/tags/${t.slug}`;
  return layout(
    {
      title: pageNum === 1 ? `Posts tagged “${t.name}”` : `Posts tagged “${t.name}”, page ${pageNum}`,
      description: `All posts about ${t.name} on ${cfg.SITE_TITLE}.`,
      path: pageNum === 1 ? base : `${base}?page=${pageNum}`,
    },
    user,
    html`<section class="intro"><h1>Posts tagged <span class="accent">#${t.name}</span></h1></section>
    ${postList(posts)}
    ${pager(base, pageNum, hasNext)}`,
  );
}

export function tagIndex(user: User | null, tags: (Tag & { count: number })[]) {
  return layout(
    { title: "Tags", description: `Browse posts on ${cfg.SITE_TITLE} by topic.`, path: "/tags" },
    user,
    html`<section class="intro"><h1>Tags</h1></section>
    ${tags.length
      ? html`<ul class="tags big">${tags.map((t) => html`<li><a href="/tags/${t.slug}">#${t.name} <span class="muted">${t.count}</span></a></li>`)}</ul>`
      : html`<p class="muted">No tags yet.</p>`}`,
  );
}

export function notFound(user: User | null) {
  return layout({ title: "Not found", noindex: true }, user, html`<h1>Not found</h1><p><a href="/">Back home</a></p>`);
}

// ---------- admin pages (all noindex)

export function login(opts: { error?: string; username?: string } = {}) {
  return layout(
    { title: "Log in", noindex: true },
    null,
    html`<form class="card" method="post" action="${cfg.LOGIN_PATH}">
      <h1>Log in</h1>
      ${opts.error ? html`<p class="error" role="alert">${opts.error}</p>` : ""}
      <label>Username <input name="username" autocomplete="username" required maxlength="64" value="${opts.username ?? ""}" autofocus></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" required maxlength="256"></label>
      <button>Log in</button>
    </form>`,
  );
}

export function dashboard(user: User, posts: Post[]) {
  return layout(
    { title: "Dashboard", noindex: true },
    user,
    html`<div class="row"><h1>Posts</h1><a class="button" href="/admin/new">New post</a></div>
    ${posts.length
      ? html`<table class="admin">
          <thead><tr><th>Title</th><th>Status</th><th>Date</th><th></th></tr></thead>
          <tbody>
          ${posts.map(
            (p) => html`<tr>
              <td><a href="/posts/${p.slug}">${p.title}</a><div class="muted small">/posts/${p.slug}</div></td>
              <td>${p.published ? "Published" : html`<span class="badge">Draft</span>`}</td>
              <td>${fmtDate(postDate(p))}</td>
              <td class="actions">
                <a href="/admin/posts/${p.id}/edit">Edit</a>
                <details>
                  <summary>Delete</summary>
                  <form method="post" action="/admin/posts/${p.id}/delete"><button class="danger">Confirm delete</button></form>
                </details>
              </td>
            </tr>`,
          )}
          </tbody>
        </table>`
      : html`<p class="muted">No posts yet. Write your first one.</p>`}`,
  );
}

const TOOLBAR: [cmd: string, label: string, title: string][] = [
  ["bold", "B", "Bold (Ctrl+B)"],
  ["italic", "I", "Italic (Ctrl+I)"],
  ["h2", "H2", "Heading"],
  ["h3", "H3", "Subheading"],
  ["link", "Link", "Link (Ctrl+K)"],
  ["quote", "❝", "Quote"],
  ["ul", "• List", "Bulleted list"],
  ["ol", "1. List", "Numbered list"],
  ["code", "`code`", "Inline code"],
  ["codeblock", "{ }", "Code block"],
  ["image", "Image", "Insert image (or paste / drop one)"],
];

export function editor(user: User, opts: { id?: number; input?: PostInput; cover?: Media | null; error?: string }) {
  const input = opts.input ?? { title: "", slug: "", description: "", tags: "", cover: "", body: "", published: false };
  const isNew = !opts.id;
  return layout(
    { title: isNew ? "New post" : "Edit post", noindex: true, wide: true, adminScript: true },
    user,
    html`<form id="editor" class="editor" method="post" action="${isNew ? "/admin/posts" : `/admin/posts/${opts.id}`}">
      <div class="row">
        <h1>${isNew ? "New post" : "Edit post"}</h1>
        <div class="row">
          <label class="check"><input type="checkbox" name="published" ${input.published ? "checked" : ""}> Published</label>
          <button>Save</button>
        </div>
      </div>
      ${opts.error ? html`<p class="error" role="alert">${opts.error}</p>` : ""}

      <div class="fields">
        <label class="span">Title <input name="title" required maxlength="200" value="${input.title}"></label>
        <label>URL
          <span class="prefixed"><span>/posts/</span><input name="slug" maxlength="100" pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${input.slug}" placeholder="auto from title" data-auto="${input.slug ? "0" : "1"}"></span>
        </label>
        <label>Tags <input name="tags" value="${input.tags}" placeholder="bun, sqlite, self-hosting"></label>
        <label class="span">Description <span class="muted small" id="desc-count"></span>
          <textarea name="description" rows="2" maxlength="300" placeholder="One or two sentences for search results and link previews (~155 characters).">${input.description}</textarea>
        </label>
        <div class="cover-field span${opts.cover ? " has-cover" : ""}">
          <span class="label">Cover image <span class="muted small">(thumbnail + social preview)</span></span>
          <input type="hidden" name="cover" value="${input.cover}">
          <img id="cover-preview" alt="" ${opts.cover ? html`src="${mediaUrl(opts.cover, widthNear(opts.cover, 480))}"` : ""}>
          <label class="button secondary">Choose image<input type="file" id="cover-input" accept="image/*" hidden></label>
          <button type="button" class="link" id="cover-remove">Remove</button>
        </div>
      </div>

      <div class="md" data-view="write">
        <div class="md-bar">
          <div class="toolbar" role="toolbar" aria-label="Formatting">
            ${TOOLBAR.map(([cmd, label, title]) => html`<button type="button" data-cmd="${cmd}" title="${title}">${label}</button>`)}
            <input type="file" id="image-input" accept="image/*" multiple hidden>
          </div>
          <div class="tabs" role="tablist">
            <button type="button" role="tab" data-tab="write" aria-selected="true">Write</button>
            <button type="button" role="tab" data-tab="preview" aria-selected="false">Preview</button>
          </div>
          <span id="upload-status" class="muted small" aria-live="polite"></span>
        </div>
        <div class="md-panes">
          <textarea name="body" required spellcheck="true" placeholder="Write in Markdown. Paste or drop images here.">${input.body}</textarea>
          <div id="preview" class="prose" aria-label="Preview"></div>
        </div>
      </div>
    </form>`,
  );
}
