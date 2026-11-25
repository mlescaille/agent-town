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

  function markOverflow(root, scroller) {
    root.classList.toggle("is-overflowing", scroller.scrollWidth > scroller.clientWidth + 1);
  }

  function scanOverflow() {
    document.querySelectorAll(".term").forEach((block) => {
      const scroller = block.querySelector(".term-scroll");
      if (scroller) markOverflow(block, scroller);
    });
    document.querySelectorAll(".codeblock").forEach((block) => {
      const scroller = block.querySelector(".codeblock-scroll");
      if (scroller) markOverflow(block, scroller);
    });
    const docNav = document.querySelector(".doc-nav");
    const docNavWrap = document.querySelector(".doc-nav-wrap");
    if (!docNav || !docNavWrap) return;
    markOverflow(docNavWrap, docNav);
    const current = docNav.querySelector("[aria-current='page']");
    if (!current || !docNavWrap.classList.contains("is-overflowing")) return;
    const navRect = docNav.getBoundingClientRect();
    const pillRect = current.getBoundingClientRect();
    if (pillRect.left < navRect.left + 4 || pillRect.right > navRect.right - 4) {
      const left = current.offsetLeft - (docNav.clientWidth - current.offsetWidth) / 2;
      docNav.scrollTo({ left: Math.max(0, left) });
    }
  }

  scanOverflow();
  window.addEventListener("resize", scanOverflow);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scanOverflow);

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
