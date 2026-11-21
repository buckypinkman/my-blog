// Light / dark / system theme. Loaded in <head> (not deferred) so the saved theme is applied
// before the first paint, with no flash of the wrong colors. "system" follows the OS setting.
(() => {
  const KEY = "theme";
  const root = document.documentElement;

  const saved = () => {
    try {
      return localStorage.getItem(KEY) || "system";
    } catch {
      return "system"; // storage blocked (private mode, etc.): just follow the system
    }
  };
  const apply = (theme) => {
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
    else delete root.dataset.theme;
  };

  apply(saved());

  document.addEventListener("DOMContentLoaded", () => {
    const control = document.getElementById("theme-switch");
    if (!control) return;
    const sync = () => {
      const current = saved();
      for (const b of control.querySelectorAll("button[data-theme]")) {
        b.setAttribute("aria-pressed", String(b.dataset.theme === current));
      }
    };

    control.addEventListener("click", (e) => {
      const button = e.target.closest("button[data-theme]");
      if (!button) return;
      const theme = button.dataset.theme;
      try {
        if (theme === "system") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, theme);
      } catch {}
      apply(theme);
      sync();
    });

    // Keep other open tabs in step.
    addEventListener("storage", (e) => {
      if (e.key !== KEY) return;
      apply(e.newValue || "system");
      sync();
    });

    control.hidden = false;
    sync();
  });
})();
