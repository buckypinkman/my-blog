import { join } from "node:path";

// Static assets are read once into memory and served with a content hash in the URL,
// so browsers can cache them forever and still get updates after a deploy.
async function load(name: string) {
  const bytes = await Bun.file(join(import.meta.dir, "..", "public", name)).bytes();
  return { bytes, url: `/${name}?v=${Bun.hash(bytes).toString(36)}` };
}

export const css = await load("style.css");
export const adminJs = await load("admin.js");
export const themeJs = await load("theme.js");
