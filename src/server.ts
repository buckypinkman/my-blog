import { join } from "node:path";
import { adminJs, css, themeJs } from "./assets";
import * as auth from "./auth";
import * as cfg from "./config";
import { db } from "./db";
import type { Safe } from "./html";
import { renderMarkdown } from "./markdown";
import * as media from "./media";
import * as posts from "./posts";
import * as limiter from "./ratelimit";
import * as seo from "./seo";
import * as views from "./views";

type Req = Request & { params: Record<string, string> };
type Srv = { requestIP(req: Request): { address: string } | null };

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' https: data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};
const PRIVATE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const IMMUTABLE = "public, max-age=31536000, immutable";

function page(body: Safe, status = 200, headers: Record<string, string> = {}) {
  return new Response(body.value, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS, ...headers },
  });
}

const text = (body: string, type: string, maxAge = 3600) =>
  new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": `public, max-age=${maxAge}` } });

const redirect = (location: string, headers: Record<string, string> = {}, status = 303) =>
  new Response(null, { status, headers: { Location: location, ...headers } });

function clientIp(req: Request, server: Srv) {
  if (cfg.TRUST_PROXY) {
    // The rightmost entry is the one appended by our own proxy; earlier ones are client-controlled.
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",").at(-1)!.trim();
  }
  return server.requestIP(req)?.address ?? "unknown";
}

// CSRF defence: the SameSite=Lax cookie plus rejecting cross-site form posts.
function isSameOrigin(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = req.headers.get("origin");
  return !origin || new URL(origin).host === new URL(req.url).host;
}

const forbidden = () => new Response("Forbidden", { status: 403 });
const notFound = (req: Request) => page(views.notFound(auth.currentUser(req)), 404);
const pageParam = (req: Request) => Math.max(1, Math.floor(Number(new URL(req.url).searchParams.get("page"))) || 1);

/**
 * Wraps a handler that needs a logged-in user. Visitors get a plain 404, so the admin area
 * looks like it doesn't exist. POSTs also get the same-origin check.
 */
function admin(handler: (req: Req, user: auth.User) => Response | Promise<Response>) {
  return (req: Req) => {
    const user = auth.currentUser(req);
    if (!user) return notFound(req);
    if (req.method === "POST" && !isSameOrigin(req)) return forbidden();
    return handler(req, user);
  };
}

function postFromParam(req: Req) {
  const id = Number(req.params.id);
  return Number.isSafeInteger(id) ? posts.byId(id) : null;
}

const asset = (a: { bytes: Uint8Array }, type: string) =>
  new Response(a.bytes as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": IMMUTABLE } });

posts.rerenderAll();

const server = Bun.serve({
  port: cfg.PORT,
  hostname: cfg.HOST,
  maxRequestBodySize: 25 * 1024 * 1024, // image uploads (several resized variants)

  routes: {
    "/style.css": asset(css, "text/css"),
    "/admin.js": asset(adminJs, "text/javascript"),
    "/theme.js": asset(themeJs, "text/javascript"),
    "/favicon.ico": new Response(null, { status: 204 }),
    "/robots.txt": () => text(seo.robots(), "text/plain", 86400),
    "/sitemap.xml": () => text(seo.sitemap(), "application/xml"),
    "/feed.xml": () => text(seo.rss(), "application/rss+xml"),

    "/media/:file": async (req) => {
      const m = media.MEDIA_FILE_RE.exec(req.params.file);
      const file = m && Bun.file(join(media.MEDIA_DIR, req.params.file));
      if (!file || !(await file.exists())) return new Response("Not found", { status: 404 });
      return new Response(file, {
        headers: { "Content-Type": m[3] === "webp" ? "image/webp" : "image/jpeg", "Cache-Control": IMMUTABLE },
      });
    },

    "/": (req) => {
      const pageNum = pageParam(req);
      const { items, hasNext } = posts.listPublished(pageNum);
      if (pageNum > 1 && !items.length) return notFound(req);
      return page(views.home(auth.currentUser(req), items, pageNum, hasNext));
    },

    "/posts/:slug": (req) => {
      const user = auth.currentUser(req);
      const p = posts.bySlug(req.params.slug);
      if (!p) {
        const moved = posts.redirectFor(req.params.slug);
        return moved ? redirect(`/posts/${moved}`, {}, 301) : notFound(req);
      }
      if (!p.published && !user) return notFound(req);
      return page(views.post(user, p, posts.tagsFor(p.id)), 200, p.published ? {} : PRIVATE);
    },

    "/tags": (req) => page(views.tagIndex(auth.currentUser(req), posts.tagCounts())),

    "/tags/:slug": (req) => {
      const tag = posts.tagBySlug(req.params.slug);
      if (!tag) return notFound(req);
      const pageNum = pageParam(req);
      const { items, hasNext } = posts.listByTag(tag.id, pageNum);
      if (!items.length) return notFound(req);
      return page(views.tag(auth.currentUser(req), tag, items, pageNum, hasNext));
    },

    // Not linked anywhere; only reachable at the secret path from .env.
    // (Typed as a literal so TypeScript can still infer the other routes' params.)
    [cfg.LOGIN_PATH as "/login"]: {
      GET: (req) => (auth.currentUser(req) ? redirect("/admin") : page(views.login(), 200, PRIVATE)),

      POST: async (req, server) => {
        if (!isSameOrigin(req)) return forbidden();
        const form = await req.formData();
        const username = String(form.get("username") ?? "").trim().toLowerCase().slice(0, 64);
        const password = String(form.get("password") ?? "");
        const ip = clientIp(req, server);

        const waitSec = limiter.loginAttempt(ip, username);
        if (waitSec > 0) {
          const mins = Math.ceil(waitSec / 60);
          console.warn(`[login] rate limited ip=${ip} user=${JSON.stringify(username)}`);
          return page(
            views.login({ username, error: `Too many login attempts. Try again in ${mins} minute${mins > 1 ? "s" : ""}.` }),
            429,
            { ...PRIVATE, "Retry-After": String(waitSec) },
          );
        }

        const user = password.length <= 256 ? await auth.verifyCredentials(username, password) : null;
        if (!user) {
          console.warn(`[login] failed ip=${ip} user=${JSON.stringify(username)}`);
          return page(views.login({ username, error: "Invalid username or password." }), 401, PRIVATE);
        }

        limiter.loginSucceeded(ip, username);
        return redirect("/admin", { "Set-Cookie": auth.sessionCookie(auth.createSession(user.id)) });
      },
    },

    "/logout": {
      POST: (req) => {
        if (!isSameOrigin(req)) return forbidden();
        auth.destroySession(req);
        return redirect("/", { "Set-Cookie": auth.clearedCookie() });
      },
    },

    "/admin": admin((_req, user) => page(views.dashboard(user, posts.listAll()), 200, PRIVATE)),
    "/admin/new": admin((_req, user) => page(views.editor(user, {}), 200, PRIVATE)),

    "/admin/posts": {
      POST: admin(async (req, user) => {
        const input = posts.readInput(await req.formData());
        const result = posts.save(user.id, input);
        if ("error" in result) {
          const cover = input.cover ? media.mediaById(input.cover) : null;
          return page(views.editor(user, { input, cover, error: result.error }), 400, PRIVATE);
        }
        return redirect(`/posts/${result.slug}`);
      }),
    },

    "/admin/posts/:id/edit": admin((req, user) => {
      const p = postFromParam(req);
      if (!p) return notFound(req);
      const input = posts.inputFrom(p, posts.tagsFor(p.id));
      return page(views.editor(user, { id: p.id, input, cover: p.cover }), 200, PRIVATE);
    }),

    "/admin/posts/:id": {
      POST: admin(async (req, user) => {
        const p = postFromParam(req);
        if (!p) return notFound(req);
        const input = posts.readInput(await req.formData());
        const result = posts.save(user.id, input, p.id);
        if ("error" in result) {
          const cover = input.cover ? media.mediaById(input.cover) : null;
          return page(views.editor(user, { id: p.id, input, cover, error: result.error }), 400, PRIVATE);
        }
        return redirect(`/posts/${result.slug}`);
      }),
    },

    "/admin/posts/:id/delete": {
      POST: admin((req) => {
        const p = postFromParam(req);
        if (p) posts.remove(p.id);
        return redirect("/admin");
      }),
    },

    "/admin/media": {
      POST: admin(async (req) => {
        const result = await media.saveUpload(req);
        if ("error" in result) return Response.json(result, { status: 400 });
        const m = result.media;
        return Response.json({
          id: m.id,
          url: media.mediaUrl(m),
          thumb: media.mediaUrl(m, media.widthNear(m, 480)),
          width: m.width,
          height: m.height,
        });
      }),
    },

    // Live preview in the editor uses the exact same renderer as published posts.
    "/admin/preview": {
      POST: admin(async (req) => {
        const md = await req.text();
        if (md.length > 200_000) return new Response("Too long", { status: 413 });
        return new Response(renderMarkdown(md).html, { headers: { "Content-Type": "text/html; charset=utf-8", ...PRIVATE } });
      }),
    },
  },

  fetch: notFound,

  error(err) {
    console.error(err);
    return new Response("Internal Server Error", { status: 500 });
  },
});

// Hourly housekeeping keeps the tables small.
setInterval(() => {
  auth.pruneSessions();
  limiter.pruneAttempts();
}, 60 * 60 * 1000);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.stop();
    db.close();
    process.exit(0);
  });
}

console.log(`Blog running at http://${cfg.HOST}:${server.port} (public URL ${cfg.SITE_URL}, login at ${cfg.LOGIN_PATH})`);
