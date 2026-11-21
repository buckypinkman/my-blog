import { db } from "./db";

// Fixed-window login limiter stored in SQLite, so limits survive restarts and use no extra RAM.
const WINDOW_MS = Number(process.env.LOGIN_WINDOW_MIN ?? 15) * 60 * 1000;
const MAX_PER_IP = Number(process.env.LOGIN_MAX_PER_IP ?? 20); // any usernames, one IP
const MAX_PER_IP_USER = Number(process.env.LOGIN_MAX_PER_IP_USER ?? 5); // one username, one IP
const MAX_PER_USER = Number(process.env.LOGIN_MAX_PER_USER ?? 50); // one username, all IPs (slows distributed guessing)

const qGet = db.query<{ count: number; window_start: number }, [string]>(
  "SELECT count, window_start FROM login_attempts WHERE key = ?",
);
const qHit = db.query(`
  INSERT INTO login_attempts (key, count, window_start) VALUES (?1, 1, ?2)
  ON CONFLICT (key) DO UPDATE SET
    count        = CASE WHEN window_start <= ?2 - ?3 THEN 1  ELSE count + 1   END,
    window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END
`);
const qDelete = db.query("DELETE FROM login_attempts WHERE key = ?");
const qPrune = db.query("DELETE FROM login_attempts WHERE window_start <= ?");

const keysFor = (ip: string, username: string): [string, number][] => [
  [`ip:${ip}`, MAX_PER_IP],
  [`ipuser:${ip}:${username}`, MAX_PER_IP_USER],
  [`user:${username}`, MAX_PER_USER],
];

/**
 * Call BEFORE checking the password. Counts the attempt up front (so parallel requests can't
 * race past the limit) and returns seconds to wait if blocked, or 0 if the attempt may proceed.
 * Blocked attempts never reach the password hasher, so a flood costs almost no CPU.
 */
export const loginAttempt = db.transaction((ip: string, username: string): number => {
  const now = Date.now();
  const keys = keysFor(ip, username);
  let waitMs = 0;
  for (const [key, max] of keys) {
    const row = qGet.get(key);
    if (row && row.window_start > now - WINDOW_MS && row.count >= max) {
      waitMs = Math.max(waitMs, row.window_start + WINDOW_MS - now);
    }
  }
  if (waitMs > 0) return Math.ceil(waitMs / 1000);
  for (const [key] of keys) qHit.run(key, now, WINDOW_MS);
  return 0;
});

/** A correct password clears that username's counters (the per-IP counter stays). */
export function loginSucceeded(ip: string, username: string) {
  qDelete.run(`ipuser:${ip}:${username}`);
  qDelete.run(`user:${username}`);
}

export const pruneAttempts = () => qPrune.run(Date.now() - WINDOW_MS);
