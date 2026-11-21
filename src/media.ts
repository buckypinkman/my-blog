import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, db } from "./db";

// Images are resized to WebP (JPEG fallback) in the browser before upload, so the server only
// checks and stores files: no image library, no CPU spike. Each image is stored as a few widths.
export const MEDIA_DIR = join(DATA_DIR, "media");
mkdirSync(MEDIA_DIR, { recursive: true });

export type Media = { id: string; ext: "webp" | "jpg"; widths: number[]; width: number; height: number };
type Row = { id: string; ext: string; widths: string; width: number; height: number };

/** Matches a stored file name, e.g. "3f2a9c0d1b4e5f60-960.webp". */
export const MEDIA_FILE_RE = /^([0-9a-f]{16})-(\d{2,4})\.(webp|jpg)$/;
/** Matches a media URL used inside post Markdown. */
export const MEDIA_SRC_RE = /^\/media\/([0-9a-f]{16})-\d{2,4}\.(?:webp|jpg)$/;

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_VARIANTS = 6;

const qGet = db.query<Row, [string]>("SELECT id, ext, widths, width, height FROM media WHERE id = ?");
const qInsert = db.query("INSERT INTO media (id, ext, widths, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?)");

export function fromRow(r: Row | null | undefined): Media | null {
  if (!r) return null;
  return { ...r, ext: r.ext as Media["ext"], widths: r.widths.split(",").map(Number) };
}

export const mediaById = (id: string) => fromRow(qGet.get(id));

export const largest = (m: Media) => m.widths.at(-1)!;
export const mediaUrl = (m: Media, w = largest(m)) => `/media/${m.id}-${w}.${m.ext}`;
export const srcset = (m: Media) => m.widths.map((w) => `${mediaUrl(m, w)} ${w}w`).join(", ");
/** Smallest stored width that is at least `target` (or the largest one). */
export const widthNear = (m: Media, target: number) => m.widths.find((w) => w >= target) ?? largest(m);
export const heightAt = (m: Media, w: number) => Math.round((m.height * w) / m.width);

function sniff(b: Uint8Array): Media["ext"] | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  return null;
}

const toInt = (v: unknown) => (typeof v === "string" && /^\d{1,5}$/.test(v) ? Number(v) : 0);

/**
 * Expects multipart fields: width, height (of the largest variant) and one file per variant
 * named "w<width>", e.g. w480, w960, w1600.
 */
export async function saveUpload(req: Request): Promise<{ media: Media } | { error: string }> {
  const form = await req.formData();
  const width = toInt(form.get("width"));
  const height = toInt(form.get("height"));
  if (!width || !height || width > 8192 || height > 8192) return { error: "Missing or invalid image dimensions." };

  const variants: { w: number; file: Blob }[] = [];
  for (const [key, value] of form.entries()) {
    const m = /^w(\d{2,4})$/.exec(key);
    if (m && typeof value !== "string") variants.push({ w: Number(m[1]), file: value });
  }
  variants.sort((a, b) => a.w - b.w);
  if (!variants.length || variants.length > MAX_VARIANTS) return { error: "Expected 1-6 image variants." };
  if (variants.some((v, i) => i > 0 && v.w === variants[i - 1]!.w)) return { error: "Duplicate variant widths." };
  if (variants.at(-1)!.w !== width) return { error: "Largest variant must match the image width." };

  let ext: Media["ext"] | null = null;
  const bytes: Uint8Array[] = [];
  for (const v of variants) {
    if (v.file.size > MAX_FILE_BYTES) return { error: "Each image variant must be under 8 MB." };
    const b = new Uint8Array(await v.file.arrayBuffer());
    const kind = sniff(b);
    if (!kind || (ext && kind !== ext)) return { error: "Images must be WebP or JPEG." };
    ext = kind;
    bytes.push(b);
  }

  const id = Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString("hex");
  await Promise.all(variants.map((v, i) => Bun.write(join(MEDIA_DIR, `${id}-${v.w}.${ext}`), bytes[i]!)));
  const widths = variants.map((v) => v.w);
  qInsert.run(id, ext!, widths.join(","), width, height, Date.now());
  return { media: { id, ext: ext!, widths, width, height } };
}
