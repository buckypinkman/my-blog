# my-blog

A small, fast blog built on Bun and SQLite. It has a Markdown editor with live preview, image uploads with thumbnails, tags, code highlighting, SEO features, and a hidden, rate-limited login.

The only dependency is `highlight.js`, and it runs only when a post is saved.

## Features

- **Markdown editor:** formatting toolbar, live side-by-side preview, and paste or drag-and-drop images. Ctrl/Cmd+B, I and K format text, Ctrl/Cmd+S saves. The editor warns before you leave with unsaved changes.
- **Images:** your browser resizes each image to WebP in 480, 960 and 1600 px widths before uploading. Pages use `srcset` so readers download only the size they need, and width and height are set so the layout doesn't jump while images load.
- **Cover image:** shown as the post's thumbnail in lists and used as its preview image on social media.
- **Slugs:** generated from the title, and you can edit them. If you change a slug, the old URL permanently redirects (301) to the new one, so existing links keep working.
- **Tags:** each tag gets its own page at `/tags/<tag>`, and there's an index at `/tags`.
- **Code highlighting:** done when the post is saved, so readers load no JavaScript.
- **SEO:**
  - canonical URLs and meta descriptions
  - Open Graph and Twitter card tags
  - `BlogPosting` JSON-LD structured data
  - `/sitemap.xml`, `/robots.txt` and an RSS feed at `/feed.xml`
  - semantic HTML, heading anchor IDs, and `noindex` on drafts and admin pages
- **Drafts:** a post stays a draft until you tick *Published*. Its public date is set the first time you publish it.
- **Hidden login:** there's no login link. The login page exists only at `LOGIN_PATH` from `.env`. `/login` and every `/admin` URL return 404 unless you're logged in.

## Why this stack fits a tiny VPS

| Need | Choice | Why |
| --- | --- | --- |
| HTTP server + routing | `Bun.serve` routes | Built into Bun, no framework layer |
| Database | `bun:sqlite` (WAL mode) | Built in, one file, no DB server process |
| Markdown | `Bun.markdown` + `HTMLRewriter` | Both built in and native code. Posts are rendered once on save and stored as HTML |
| Image resizing | Browser canvas → WebP | Uses no server CPU and needs no native image library like sharp |
| Password hashing | `Bun.password` (argon2id, 19 MiB) | Built in; tuned below Bun's 64 MiB default |
| Sessions + rate limit | SQLite tables | Revocable sessions; limits survive restarts |
| Static assets | Kept in memory, content-hashed URLs | Browsers cache them for a year and still get updates after a deploy |

Measured locally: about 20–40 MB of RAM when idle. Each login briefly uses about 19 MB more while the password is hashed.

## Run locally

```bash
bun install
bun run create-user admin     # prompts for a password (min 10 chars)
bun run dev                   # http://127.0.0.1:3000
```

Without a `.env`, the login page is at `/login` and the server prints a warning. Copy `.env.example` to `.env` and set `LOGIN_PATH` to choose your own path. For local development, leave out `NODE_ENV=production` and `COOKIE_SECURE=1`, because the local server uses plain HTTP.

`bun run dev` restarts when a `.ts` file changes. After editing `public/style.css` or `public/admin.js`, restart it by hand.

## Login rate limit

Each login attempt is counted **before** the password is checked. A flood of requests is rejected cheaply and never reaches argon2. Parallel requests can't slip past the limit. Limits per 15-minute window (set them in `.env`):

- 5 attempts per IP + username
- 20 attempts per IP
- 50 attempts per username across all IPs

Going over a limit returns `429` with a `Retry-After` header. A successful login clears that username's counters.

## Security notes

- Cookies: `HttpOnly`, `SameSite=Lax`, plus `Secure` when `COOKIE_SECURE=1`.
- CSRF: form posts and uploads from other sites are rejected using `Sec-Fetch-Site` and `Origin`.
- Unknown usernames take as long to check as real ones, so attackers can't find valid usernames.
- A strict CSP means no inline scripts run, even in post HTML. Markdown's tag filter also neutralises `<script>`, `<style>` and `<iframe>` in posts.
- Uploads are admin-only, limited to 8 MB per size, and checked by their file contents (only WebP or JPEG are accepted).

## Deploy to the VPS

The server setup is nginx (HTTPS via Let's Encrypt) → Bun on `127.0.0.1:3000` → SQLite. Everything runs as your `ubuntu` user from `/home/ubuntu/blog`. You deploy by hand with `rsync` from your machine.

In the commands below, replace `your-vps` with your server's IP or hostname.

| Path on the VPS | Contents |
| --- | --- |
| `/home/ubuntu/blog` | code, `node_modules`, `.env` |
| `/home/ubuntu/blog/data` | `blog.sqlite`, `media/` (uploaded images). Never overwritten by a deploy |

### 1. Install nginx and certbot (once)

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
which bun     # should print /home/ubuntu/.bun/bin/bun
```

If `which bun` prints a different path, change `ExecStart` in [`deploy/blog.service`](deploy/blog.service) to match.

### 2. Upload the code and configure it (once)

From your machine, in the project folder:

```bash
rsync -az --exclude .git/ --exclude node_modules/ --exclude data/ --exclude .env ./ ubuntu@your-vps:blog/
```

Then on the VPS:

```bash
cd ~/blog
bun install --production --frozen-lockfile
mkdir -p data
cp .env.example .env
bun -e 'console.log("/" + crypto.randomUUID().slice(0, 13))'   # copy this into LOGIN_PATH
nano .env       # set SITE_URL, BLOG_TITLE, LOGIN_PATH; keep TRUST_PROXY=1 and COOKIE_SECURE=1
chmod 600 .env
bun run create-user admin
```

### 3. Run it as a service (once)

```bash
sudo cp ~/blog/deploy/blog.service /etc/systemd/system/blog.service
sudo systemctl daemon-reload
sudo systemctl enable --now blog
curl -I http://127.0.0.1:3000/       # expect HTTP 200
```

The blog now starts on boot and restarts itself if it crashes. Logs: `journalctl -u blog -f`

### 4. nginx + HTTPS (once)

Point your domain's DNS A record at the VPS, then:

```bash
sudo cp ~/blog/deploy/nginx.conf /etc/nginx/sites-available/blog
sudo nano /etc/nginx/sites-available/blog      # set server_name to your domain
sudo ln -s /etc/nginx/sites-available/blog /etc/nginx/sites-enabled/blog
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d blog.example.com        # gets the certificate and adds HTTP→HTTPS redirect
```

Certbot renews certificates automatically. [`deploy/nginx.conf`](deploy/nginx.conf) forwards the `Host` and `X-Forwarded-For` headers. The app needs them for its CSRF check and the per-IP login rate limit, so keep `TRUST_PROXY=1` in `.env`. The config also allows uploads up to 25 MB and turns on gzip.

Keep `HOST=127.0.0.1` in `.env` so the app can only be reached through nginx.

Once the site is live, submit `https://your-domain/sitemap.xml` in Google Search Console and Bing Webmaster Tools.

### 5. Deploying updates

From your machine, in the project folder:

```bash
rsync -az --delete --exclude .git/ --exclude node_modules/ --exclude data/ --exclude .env ./ ubuntu@your-vps:blog/
```

```bash
ssh -t ubuntu@your-vps 'cd ~/blog && bun install --production --frozen-lockfile && sudo systemctl restart blog'
```

`--delete` removes files on the server that you deleted locally. The `--exclude`d paths are never touched, so your database, images and `.env` are safe. Database upgrades run automatically when the service restarts.

**Prefer Caddy?** [`deploy/Caddyfile`](deploy/Caddyfile) does the same job as nginx and handles HTTPS on its own. Use it instead of step 4.

## Database upgrades

The schema is versioned with `PRAGMA user_version`, and upgrades run automatically on startup. Post HTML is also re-rendered on startup, so changes to the renderer apply to existing posts.

## Backups

Back up both the database and the uploaded images:

```bash
mkdir -p ~/backups
sqlite3 ~/blog/data/blog.sqlite ".backup '$HOME/backups/blog-$(date +%F).sqlite'"
tar czf ~/backups/blog-media-$(date +%F).tgz -C ~/blog/data media
```

To keep a copy off the server too, pull them to your machine: `rsync -az ubuntu@your-vps:backups/ ./backups/`

`.backup` is safe while the server is running.
