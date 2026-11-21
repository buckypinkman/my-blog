const env = process.env;

export const PORT = Number(env.PORT ?? 3000);
export const HOST = env.HOST ?? "127.0.0.1"; // keep it behind a reverse proxy
export const TRUST_PROXY = env.TRUST_PROXY === "1";

/** Public origin used for canonical URLs, Open Graph, sitemap and RSS. No trailing slash. */
export const SITE_URL = (env.SITE_URL ?? `http://${HOST}:${PORT}`).replace(/\/+$/, "");
export const SITE_TITLE = env.BLOG_TITLE ?? "rangga's blog";
export const SITE_DESCRIPTION = env.BLOG_DESCRIPTION ?? "";
export const SITE_LANG = env.SITE_LANG ?? "en";
/** Shown as the author on posts and in structured data. Falls back to the username. */
export const AUTHOR_NAME = env.AUTHOR_NAME ?? "";

const RESERVED = ["/", "/posts", "/tags", "/admin", "/media", "/logout", "/feed.xml", "/sitemap.xml", "/robots.txt"];

/** The login page is never linked; it only exists at this path. */
export const LOGIN_PATH = (() => {
  const path = env.LOGIN_PATH;
  if (!path) {
    console.warn("[config] LOGIN_PATH is not set; using /login. Set a secret path in .env.");
    return "/login";
  }
  if (!/^\/[A-Za-z0-9_-]{3,64}$/.test(path) || RESERVED.includes(path)) {
    throw new Error(`LOGIN_PATH must look like "/my-secret-door" (3-64 chars: letters, digits, _ or -) and not be one of ${RESERVED.join(" ")}`);
  }
  return path;
})();
