// Tiny auto-escaping template tag: every interpolated value is HTML-escaped unless it is
// already Safe (i.e. produced by another html`` call or raw()). No template engine needed.
export class Safe {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
export const raw = (s: string) => new Safe(s);

function render(v: unknown): string {
  if (v instanceof Safe) return v.value;
  if (Array.isArray(v)) return v.map(render).join("");
  if (v == null || v === false) return "";
  return esc(String(v));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Safe {
  let out = strings[0]!;
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Safe(out);
}

/** JSON for a <script type="application/ld+json"> block; `<` is escaped so it can't close the tag. */
export const jsonLd = (data: object) =>
  raw(`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`);
