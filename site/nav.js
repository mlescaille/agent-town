(function () {
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const source = document.getElementById(button.getAttribute("data-copy"));
      const blocks = source.querySelectorAll("code");
      const text = source.dataset.full
        ? source.dataset.full.trim()
        : blocks.length
          ? [...blocks].map((block) => block.textContent.replace(/\s+$/u, "")).join("\n\n")
          : source.textContent.trim();
      const label = button.querySelector(".copy-label");
      const originalLabel = label ? label.textContent : "";
      const originalAria = button.getAttribute("aria-label");
      try {
        await navigator.clipboard.writeText(text);
        button.classList.add("is-copied");
        button.setAttribute("aria-label", "Copied");
        if (label) label.textContent = "Copied";
      } catch {
        button.setAttribute("aria-label", "Copy failed");
      }
      window.setTimeout(() => {
        button.classList.remove("is-copied");
        button.setAttribute("aria-label", originalAria);
        if (label) label.textContent = originalLabel;
      }, 1600);
    });
  });

  const nav = document.querySelector(".nav");
  const menu = document.querySelector(".menu");
  const panel = document.getElementById("nav-links");
  if (!nav || !menu || !panel) return;

  function setMenu(open) {
    nav.classList.toggle("is-open", open);
    menu.setAttribute("aria-expanded", open ? "true" : "false");
  }

  menu.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    setMenu(open);
    if (open) panel.querySelector("a").focus();
  });

  panel.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setMenu(false));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenu(false);
  });

  document.addEventListener("click", (event) => {
    if (!nav.contains(event.target)) setMenu(false);
  });
})();
