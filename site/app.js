(function () {
  const samples = window.SAMPLES;
  const seal = document.getElementById("seal");
  const sealStatus = document.getElementById("seal-status");

  function b64urlToBytes(value) {
    const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
    const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
    return out;
  }

  function decodeJson(part) {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
  }

  function setSeal(state, message) {
    seal.dataset.state = state;
    seal.classList.toggle("is-bad", state === "bad");
    sealStatus.textContent = message;
  }

  async function verify(token, kid) {
    if (!samples || kid !== samples.issuer.kid || !globalThis.crypto?.subtle?.importKey) return "unsupported";
    const [header, payload, signature] = token.split(".");
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x: samples.issuer.x, ext: true },
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      b64urlToBytes(signature),
      new TextEncoder().encode(header + "." + payload),
    );
    return ok ? "ok" : "bad";
  }

  if (samples) {
    const token = samples.licenses.user_goal.token.trim();
    const [headerPart, payloadPart] = token.split(".");
    const header = decodeJson(headerPart);
    const claims = decodeJson(payloadPart);
    const detail = claims.authorization_details[0];
    const readAction = detail.actions.find((action) => /\.(read|list|get)$/.test(action)) || detail.actions[0];
    document.getElementById("cred-mandate").textContent = claims.mandate.type;
    document.getElementById("cred-for").textContent = claims.sub;
    document.getElementById("cred-scope").textContent = readAction;
    verify(token, header.kid).then((state) => {
      if (state === "ok") setSeal("ok", "Ed25519 signature holds for this sample license.");
      else if (state === "bad") setSeal("bad", "The sample signature did not verify in this browser.");
      else setSeal("unsupported", "This browser did not check the sample signature. The fields are decoded from the token.");
    }).catch(() => {
      setSeal("unsupported", "This browser did not check the sample signature. The fields are decoded from the token.");
    });
  }

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
