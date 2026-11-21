// Post editor: Markdown toolbar, live preview, and image resizing in the browser before upload
// (so the server never has to process images). Loaded only on admin editor pages.
const form = document.getElementById("editor");
if (form) initEditor(form);

function initEditor(form) {
  const $ = (sel) => form.querySelector(sel);
  const title = $("[name=title]");
  const slug = $("[name=slug]");
  const desc = $("[name=description]");
  const body = $("[name=body]");
  const preview = $("#preview");
  const status = $("#upload-status");
  const panes = $(".md");

  // ---- slug follows the title until you type your own
  let autoSlug = slug.dataset.auto === "1";
  title.addEventListener("input", () => {
    if (autoSlug) slug.value = slugify(title.value);
  });
  slug.addEventListener("input", () => {
    autoSlug = slug.value === "";
  });

  // ---- description length hint (search engines show ~155 characters)
  const counter = $("#desc-count");
  const count = () => {
    counter.textContent = `${desc.value.length}/155`;
    counter.classList.toggle("over", desc.value.length > 155);
  };
  desc.addEventListener("input", count);
  count();

  // ---- warn before leaving with unsaved changes; Ctrl/Cmd+S saves
  let dirty = false;
  form.addEventListener("input", () => (dirty = true));
  form.addEventListener("submit", () => (dirty = false));
  addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // ---- live preview, rendered by the server with the same pipeline as published posts
  let timer;
  let lastSent = null;
  async function renderPreview() {
    if (body.value === lastSent) return;
    lastSent = body.value;
    const res = await fetch("/admin/preview", {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: body.value,
    });
    if (res.ok) preview.innerHTML = await res.text();
  }
  body.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(renderPreview, 250);
  });
  renderPreview();

  // ---- Write / Preview tabs (only visible on narrow screens)
  form.querySelectorAll("[data-tab]").forEach((tab) =>
    tab.addEventListener("click", () => {
      panes.dataset.view = tab.dataset.tab;
      form.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      if (tab.dataset.tab === "preview") renderPreview();
    }),
  );

  // ---- toolbar
  const commands = {
    bold: () => wrap("**", "**", "bold text"),
    italic: () => wrap("_", "_", "italic text"),
    h2: () => prefixLines("## "),
    h3: () => prefixLines("### "),
    quote: () => prefixLines("> "),
    ul: () => prefixLines("- "),
    ol: () => prefixLines("1. "),
    code: () => wrap("`", "`", "code"),
    codeblock: () => wrap("\n```js\n", "\n```\n", "your code"),
    link: () => {
      const url = prompt("Link URL", "https://");
      if (url) wrap("[", `](${url})`, "link text");
    },
    image: () => $("#image-input").click(),
  };
  $(".toolbar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cmd]");
    if (!btn) return;
    body.focus();
    commands[btn.dataset.cmd]();
  });
  body.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const cmd = { b: "bold", i: "italic", k: "link" }[e.key.toLowerCase()];
    if (cmd) {
      e.preventDefault();
      commands[cmd]();
    }
  });

  // execCommand keeps the browser's undo history (Ctrl+Z) working; setRangeText is the fallback.
  function insert(text) {
    body.focus();
    if (!document.execCommand("insertText", false, text)) {
      body.setRangeText(text, body.selectionStart, body.selectionEnd, "end");
      body.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  function wrap(before, after, placeholder) {
    const start = body.selectionStart;
    const selected = body.value.slice(start, body.selectionEnd) || placeholder;
    insert(before + selected + after);
    body.setSelectionRange(start + before.length, start + before.length + selected.length);
  }
  function prefixLines(prefix) {
    const v = body.value;
    const lineStart = v.lastIndexOf("\n", body.selectionStart - 1) + 1;
    const lines = v.slice(lineStart, body.selectionEnd).split("\n");
    body.setSelectionRange(lineStart, body.selectionEnd);
    insert(lines.map((l, i) => (prefix === "1. " ? `${i + 1}. ` : prefix) + l).join("\n"));
  }

  // ---- images: toolbar button, paste, drag & drop
  let uploads = 0;
  async function insertImages(files) {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/[[\]]/g, "").trim() || "image";
      const token = `![Uploading ${alt} #${++uploads}…]()`;
      insert(`\n${token}\n`);
      try {
        const m = await upload(file);
        replaceToken(token, `![${alt}](${m.url})`);
      } catch (err) {
        replaceToken(token, "");
        alert(err.message);
      }
    }
  }
  function replaceToken(token, text) {
    const i = body.value.indexOf(token);
    if (i < 0) return;
    body.setRangeText(text, i, i + token.length, "preserve");
    body.dispatchEvent(new Event("input", { bubbles: true }));
  }
  $("#image-input").addEventListener("change", (e) => {
    insertImages([...e.target.files]);
    e.target.value = "";
  });
  body.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      insertImages(files);
    }
  });
  body.addEventListener("dragover", (e) => e.preventDefault());
  body.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      insertImages(files);
    }
  });

  // ---- cover image
  const coverField = $(".cover-field");
  const coverId = $("[name=cover]");
  const coverImg = $("#cover-preview");
  $("#cover-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const m = await upload(file);
      coverId.value = m.id;
      coverImg.src = m.thumb;
      coverField.classList.add("has-cover");
      dirty = true;
    } catch (err) {
      alert(err.message);
    }
  });
  $("#cover-remove").addEventListener("click", () => {
    coverId.value = "";
    coverImg.removeAttribute("src");
    coverField.classList.remove("has-cover");
    dirty = true;
  });

  // ---- resize in the browser, then upload all sizes in one request
  const WIDTHS = [480, 960, 1600];

  async function upload(file) {
    status.textContent = `Processing ${file.name}…`;
    try {
      const variants = await resize(file);
      const top = variants.at(-1);
      const fd = new FormData();
      fd.set("width", top.w);
      fd.set("height", top.h);
      for (const v of variants) fd.append(`w${v.w}`, v.blob, `${v.w}.${v.blob.type === "image/webp" ? "webp" : "jpg"}`);
      status.textContent = `Uploading ${file.name}…`;
      const res = await fetch("/admin/media", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      return data;
    } finally {
      status.textContent = "";
    }
  }

  async function resize(file) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file); // applies EXIF rotation in current browsers
    } catch {
      throw new Error(`Can't read ${file.name}. Try a JPEG, PNG or WebP image.`);
    }
    const widths = [...new Set(WIDTHS.map((w) => Math.min(w, bitmap.width)))];
    const out = [];
    for (const w of widths) {
      const h = Math.round((bitmap.height * w) / bitmap.width);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);
      let blob = await toBlob(canvas, "image/webp", 0.82);
      // Older Safari can't encode WebP and silently returns PNG; use JPEG instead.
      if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", 0.85);
      out.push({ w, h, blob });
    }
    bitmap.close();
    return out;
  }
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function slugify(s) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}
