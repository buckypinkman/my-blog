import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { MEDIA_SRC_RE, mediaById, mediaUrl, srcset } from "./media";

// Only these languages are loaded, which keeps memory low. Aliases (js, ts, sh, py, html, yml…) work too.
const LANGUAGES = {
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown,
  nginx, php, python, ruby, rust, scss, shell, sql, swift, typescript, xml, yaml,
};
for (const [name, lang] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, lang);

const OPTIONS = {
  headings: { ids: true }, // anchor links like /posts/x#some-heading
  autolinks: true,
  tagFilter: true, // neutralises <script>, <style>, <iframe> etc. written in a post
} as const;

/** Width the article column renders images at; used for the `sizes` hint. */
const SIZES = "(max-width: 720px) 100vw, 688px";

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&amp;": "&" };
const unescape = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(?:lt|gt|quot|#39|amp);/g, (e) => ENTITIES[e]!);

const toText = (html: string) => unescape(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Post-processes the HTML: syntax highlighting for code blocks and responsive images. */
function enhance(html: string): string {
  let lang: string | null = null;
  let code = "";
  return new HTMLRewriter()
    .on("pre > code", {
      element(el) {
        const name = /language-([\w+#.-]+)/.exec(el.getAttribute("class") ?? "")?.[1]?.toLowerCase();
        lang = name && hljs.getLanguage(name) ? name : null;
        code = "";
        if (lang) el.setAttribute("class", `hljs language-${lang}`);
      },
      text(chunk) {
        if (!lang) return;
        code += chunk.text;
        if (!chunk.lastInTextNode) {
          chunk.remove();
          return;
        }
        const out = hljs.highlight(unescape(code), { language: lang, ignoreIllegals: true }).value;
        chunk.replace(out, { html: true });
      },
    })
    .on("img", {
      element(el) {
        const id = MEDIA_SRC_RE.exec(el.getAttribute("src") ?? "")?.[1];
        const m = id ? mediaById(id) : null;
        if (m) {
          el.setAttribute("src", mediaUrl(m));
          el.setAttribute("srcset", srcset(m));
          el.setAttribute("sizes", SIZES);
          el.setAttribute("width", String(m.width));
          el.setAttribute("height", String(m.height));
        }
        el.setAttribute("loading", "lazy");
        el.setAttribute("decoding", "async");
      },
    })
    .transform(html);
}

export type Rendered = { html: string; excerpt: string; readingMin: number };

export function renderMarkdown(md: string): Rendered {
  const base = Bun.markdown.html(md, OPTIONS);
  const text = toText(base);
  const prose = toText(base.replace(/<pre>[\s\S]*?<\/pre>/g, " "));
  const excerpt = prose.length > 200 ? prose.slice(0, 200).replace(/\s+\S*$/, "") + "…" : prose;
  const words = text ? text.split(" ").length : 0;
  return { html: enhance(base), excerpt, readingMin: Math.max(1, Math.round(words / 220)) };
}
