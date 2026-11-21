import * as cfg from "./config";
import { html } from "./html";
import * as posts from "./posts";

const abs = (path: string) => cfg.SITE_URL + path;

/** Feed readers need absolute URLs; post HTML uses root-relative ones like /media/… */
const absolutize = (html: string) =>
  html.replace(/\b(src|href|srcset)="([^"]*)"/g, (_, attr: string, value: string) =>
    `${attr}="${value.replace(/(^|,\s*)\/(?!\/)/g, `$1${cfg.SITE_URL}/`)}"`,
  );

export function rss() {
  const items = posts.latest(20);
  const updated = items.reduce((max, p) => Math.max(max, p.updated_at), 0) || Date.now();
  return `<?xml version="1.0" encoding="UTF-8"?>
${html`<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>${cfg.SITE_TITLE}</title>
  <link>${abs("/")}</link>
  <description>${cfg.SITE_DESCRIPTION || cfg.SITE_TITLE}</description>
  <language>${cfg.SITE_LANG}</language>
  <lastBuildDate>${new Date(updated).toUTCString()}</lastBuildDate>
  <atom:link href="${abs("/feed.xml")}" rel="self" type="application/rss+xml"/>
  ${items.map((p) => {
    const url = abs(`/posts/${p.slug}`);
    return html`
  <item>
    <title>${p.title}</title>
    <link>${url}</link>
    <guid isPermaLink="false">${abs(`/#post-${p.id}`)}</guid>
    <pubDate>${new Date(p.published_at ?? p.created_at).toUTCString()}</pubDate>
    <description>${p.description || p.excerpt}</description>
    ${posts.tagsFor(p.id).map((t) => html`<category>${t.name}</category>`)}
    <content:encoded>${absolutize(p.body_html)}</content:encoded>
  </item>`;
  })}
</channel>
</rss>`}`;
}

export function sitemap() {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const all = posts.latest(50_000);
  const tags = posts.tagCounts();
  const newest = all.reduce((max, p) => Math.max(max, p.updated_at), 0);
  const url = (loc: string, lastmod?: number) =>
    html`<url><loc>${abs(loc)}</loc>${lastmod ? html`<lastmod>${day(lastmod)}</lastmod>` : ""}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
${html`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${url("/", newest || undefined)}
${all.map((p) => url(`/posts/${p.slug}`, p.updated_at))}
${tags.length ? url("/tags") : ""}
${tags.map((t) => url(`/tags/${t.slug}`, t.lastmod))}
</urlset>`}`;
}

// The secret login path is deliberately not listed here.
export const robots = () => `User-agent: *
Disallow: /admin

Sitemap: ${abs("/sitemap.xml")}
`;
