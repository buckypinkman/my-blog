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

The server setup is nginx (HTTPS via Let's Encrypt) → Bun on `127.0.0.1:3000` → SQLite. The app runs under systemd as an unprivileged `blog` user. Deploys come from GitHub Actions over SSH, or you can run them by hand.

| Path on the VPS | Owner | Contents |
| --- | --- | --- |
| `/opt/blog` | `deploy` (your SSH user) | code, `node_modules`, `.env` |
| `/opt/blog/data` | `blog` (service user) | `blog.sqlite`, `media/` (uploaded images) |

### 1. One-time server setup

```bash
# Packages (Debian/Ubuntu). Bun and sqlite3 are already installed.
sudo apt install -y nginx certbot python3-certbot-nginx rsync curl

# Users: "blog" runs the app, "deploy" uploads code (skip if you deploy as your own user)
sudo useradd --system --home /opt/blog --shell /usr/sbin/nologin blog
sudo adduser --disabled-password --gecos "" deploy

# App folder
sudo mkdir -p /opt/blog/data
sudo chown deploy:deploy /opt/blog
sudo chown blog:blog /opt/blog/data && sudo chmod 750 /opt/blog/data
```

Make sure `bun` is available system-wide, because the service runs as `blog`:

```bash
which bun     # if it's under ~/.bun, copy it: sudo cp ~/.bun/bin/bun /usr/local/bin/bun
```

### 2. Config and first user

Upload the code once from your machine. GitHub Actions takes over later, but its restart step needs the service from step 3 to exist first.

```bash
rsync -az --exclude .git/ --exclude .github/ --exclude node_modules/ --exclude data/ --exclude .env \
  ./ deploy@your-vps:/opt/blog/
```

Then on the VPS:

```bash
cd /opt/blog
bun install --production --frozen-lockfile
cp .env.example .env && nano .env     # SITE_URL, BLOG_TITLE, LOGIN_PATH, TRUST_PROXY=1, COOKIE_SECURE=1
bun -e 'console.log("/" + crypto.randomUUID().slice(0, 13))'   # a fresh LOGIN_PATH
sudo chgrp blog .env && chmod 640 .env
sudo -u blog bun run create-user admin
```

### 3. systemd service

```bash
sudo cp /opt/blog/deploy/blog.service /etc/systemd/system/blog.service   # check ExecStart matches `which bun`
sudo systemctl daemon-reload
sudo systemctl enable --now blog
curl -I http://127.0.0.1:3000/                                          # expect 200
```

Logs: `journalctl -u blog -f`

### 4. nginx + HTTPS

```bash
sudo cp /opt/blog/deploy/nginx.conf /etc/nginx/sites-available/blog
sudo nano /etc/nginx/sites-available/blog      # set server_name to your domain
sudo ln -s /etc/nginx/sites-available/blog /etc/nginx/sites-enabled/blog
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d blog.example.com        # gets the certificate and adds HTTP→HTTPS redirect
```

Certbot renews certificates automatically. [`deploy/nginx.conf`](deploy/nginx.conf) forwards the `Host` and `X-Forwarded-For` headers. The app needs them for its CSRF check and the per-IP login rate limit, so keep `TRUST_PROXY=1` in `.env`. The config also allows uploads up to 25 MB and turns on gzip.

Keep the app bound to `HOST=127.0.0.1` so it can only be reached through nginx.

### 5. Automatic deploys with GitHub Actions

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on every push and pull request:

- **check:** `bun install`, `bun run typecheck`, then starts the server and smoke-tests its main pages, the sitemap, the feed and the hidden login.
- **deploy** (pushes to `main` only, after check passes):
  - copies the code to the server with `rsync`. `data/` and `.env` on the server are never touched.
  - runs `bun install --production` and `sudo systemctl restart blog`.
  - waits until the blog responds, and shows the service status if it doesn't come back.

One-time setup:

1. Create an SSH key just for deploys (on your machine) and authorise it for `deploy`:
   ```bash
   ssh-keygen -t ed25519 -f blog_deploy_key -N "" -C "github-actions-deploy"
   ssh-copy-id -i blog_deploy_key.pub deploy@your-vps
   ```
2. Let `deploy` restart the service without a password, and nothing else (check the path with `command -v systemctl`):
   ```bash
   echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart blog' | sudo tee /etc/sudoers.d/blog-deploy
   sudo chmod 440 /etc/sudoers.d/blog-deploy && sudo visudo -c
   ```
3. In GitHub, go to **Settings → Secrets and variables → Actions** and add these secrets:

   | Secret | Value |
   | --- | --- |
   | `VPS_HOST` | server IP or hostname |
   | `VPS_USER` | `deploy` |
   | `VPS_SSH_KEY` | contents of `blog_deploy_key` (the private key) |
   | `VPS_KNOWN_HOSTS` | output of `ssh-keyscan -p 22 your-vps` |
   | `VPS_PORT` | optional, if SSH isn't on 22 |

   Optionally, add a *variable* `APP_DIR` if the app isn't in `/opt/blog`.
4. Push to `main`. You can also run the workflow by hand from the **Actions** tab (*Run workflow*).

Delete the local `blog_deploy_key` files once the secret is saved. For extra safety you can add required reviewers to the `production` environment under **Settings → Environments**.

### 6. Manual deploy (without GitHub)

```bash
# from your machine
rsync -az --delete --exclude .git/ --exclude .github/ --exclude node_modules/ --exclude data/ --exclude .env \
  ./ deploy@your-vps:/opt/blog/
ssh deploy@your-vps 'cd /opt/blog && bun install --production --frozen-lockfile && sudo systemctl restart blog'
```

### After the first deploy

Submit `https://your-domain/sitemap.xml` in Google Search Console and Bing Webmaster Tools.

**Prefer Caddy?** [`deploy/Caddyfile`](deploy/Caddyfile) does the same job and handles HTTPS on its own. Use it instead of step 4.

## Database upgrades

The schema is versioned with `PRAGMA user_version`, and upgrades run automatically on startup. Post HTML is also re-rendered on startup, so changes to the renderer apply to existing posts.

## Backups

Back up both the database and the uploaded images:

```bash
sqlite3 /opt/blog/data/blog.sqlite ".backup '/root/blog-$(date +%F).sqlite'"
tar czf /root/blog-media-$(date +%F).tgz -C /opt/blog/data media
```

`.backup` is safe while the server is running.
