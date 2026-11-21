// Creates a user, or resets the password of an existing one (and logs out their sessions).
// Usage: bun run create-user <username>
import { hashPassword } from "../src/auth";
import { db } from "../src/db";

const username = process.argv[2]?.trim().toLowerCase();
if (!username || !/^[a-z0-9_.-]{3,32}$/.test(username)) {
  console.error("Usage: bun run create-user <username>   (3-32 chars: a-z 0-9 _ . -)");
  process.exit(1);
}

const tty = process.stdin.isTTY;
function ask(question: string): string {
  if (tty) Bun.spawnSync(["stty", "-echo"], { stdin: "inherit" });
  try {
    return prompt(question) ?? "";
  } finally {
    if (tty) {
      Bun.spawnSync(["stty", "echo"], { stdin: "inherit" });
      process.stdout.write("\n");
    }
  }
}

const password = ask("Password (min 10 chars):");
if (password.length < 10 || password.length > 256) {
  console.error("Password must be 10-256 characters.");
  process.exit(1);
}
if (tty && ask("Repeat password:") !== password) {
  console.error("Passwords do not match.");
  process.exit(1);
}

const existing = db.query<{ id: number }, [string]>("SELECT id FROM users WHERE username = ?").get(username);
const hash = await hashPassword(password);

if (existing) {
  db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, existing.id);
  db.query("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
  console.log(`Password updated for "${username}". Existing sessions were logged out.`);
} else {
  db.query("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)").run(username, hash, Date.now());
  console.log(`User "${username}" created.`);
}
db.close();
