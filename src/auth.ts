import { db } from "./db";

export type User = { id: number; username: string };

// argon2id at OWASP's minimum profile (19 MiB, 2 passes). Bun's default uses 64 MiB per hash,
// which hurts on a tiny VPS when several logins land at once.
const HASH_OPTS = { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 } as const;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE = "sid";
const SECURE = process.env.COOKIE_SECURE === "1";

export const hashPassword = (password: string) => Bun.password.hash(password, HASH_OPTS);

// Verifying against a dummy hash for unknown usernames keeps response time the same,
// so attackers can't discover which usernames exist.
const DUMMY_HASH = await hashPassword(crypto.randomUUID());

const qUserByName = db.query<User & { password_hash: string }, [string]>(
  "SELECT id, username, password_hash FROM users WHERE username = ?",
);
const qInsertSession = db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)");
const qSessionUser = db.query<User, [string, number]>(
  `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
   WHERE s.token_hash = ? AND s.expires_at > ?`,
);
const qDeleteSession = db.query("DELETE FROM sessions WHERE token_hash = ?");
const qDeleteExpired = db.query("DELETE FROM sessions WHERE expires_at <= ?");

export async function verifyCredentials(username: string, password: string): Promise<User | null> {
  const row = qUserByName.get(username);
  const ok = await Bun.password.verify(password, row?.password_hash ?? DUMMY_HASH);
  return row && ok ? { id: row.id, username: row.username } : null;
}

// Only a SHA-256 of the token is stored, so a leaked database can't be used to hijack sessions.
const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

export function createSession(userId: number): string {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  qInsertSession.run(sha256(token), userId, Date.now() + SESSION_TTL_MS);
  return token;
}

function readToken(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

export function currentUser(req: Request): User | null {
  const token = readToken(req);
  return token ? (qSessionUser.get(sha256(token), Date.now()) ?? null) : null;
}

export function destroySession(req: Request) {
  const token = readToken(req);
  if (token) qDeleteSession.run(sha256(token));
}

const cookieAttrs = `Path=/; HttpOnly; SameSite=Lax${SECURE ? "; Secure" : ""}`;
export const sessionCookie = (token: string) => `${COOKIE}=${token}; ${cookieAttrs}; Max-Age=${SESSION_TTL_MS / 1000}`;
export const clearedCookie = () => `${COOKIE}=; ${cookieAttrs}; Max-Age=0`;

export const pruneSessions = () => qDeleteExpired.run(Date.now());
