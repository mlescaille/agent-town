(function () {
  const samples = window.SAMPLES;
  if (!samples) return;

  const fields = {
    serial: document.getElementById("f-serial"),
    subject: document.getElementById("f-subject"),
    agent: document.getElementById("f-agent"),
    mandate: document.getElementById("f-mandate"),
    goalLabel: document.getElementById("f-goal-label"),
    goal: document.getElementById("f-goal"),
    goalRow: document.getElementById("f-goal-row"),
    actions: document.getElementById("f-actions"),
    locations: document.getElementById("f-locations"),
    budget: document.getElementById("f-budget"),
    expires: document.getElementById("f-expires"),
    txn: document.getElementById("f-txn"),
    hash: document.getElementById("f-hash"),
    parentRow: document.getElementById("f-parent-row"),
    parent: document.getElementById("f-parent"),
    chain: document.getElementById("f-chain"),
    alg: document.getElementById("f-alg"),
    typ: document.getElementById("f-typ"),
    kid: document.getElementById("f-kid"),
    iss: document.getElementById("f-iss"),
    aud: document.getElementById("f-aud"),
    token: document.getElementById("f-token"),
    payload: document.getElementById("f-payload"),
    seal: document.getElementById("seal"),
    sealState: document.getElementById("seal-state"),
  };

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

  function fillSoft(el, value) {
  el.replaceChildren();
  let run = 0;
  for (const char of value) {
    el.append(char);
    if (char === "/" || char === ":" || char === "_" || char === ".") {
      el.append(document.createElement("wbr"));
      run = 0;
    } else {
      run += 1;
      if (run >= 16) {
        el.append(document.createElement("wbr"));
        run = 0;
      }
    }
  }
}

function chainOf(claims) {
    const actors = [];
    let act = claims.act;
    while (act) {
      actors.push(act.sub);
      act = act.act;
    }
    return [claims.sub, ...actors.reverse()];
  }

  async function verify(token, kid) {
    if (!globalThis.crypto?.subtle?.importKey) return "unsupported";
    if (kid !== samples.issuer.kid) return "bad";
    try {
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
        new TextEncoder().encode(`${header}.${payload}`),
      );
      return ok ? "ok" : "bad";
    } catch {
      return "unsupported";
    }
  }

  function setSeal(state) {
    fields.seal.classList.remove("ok", "bad", "pending");
    if (state === "ok") {
      fields.seal.classList.add("ok");
      fields.sealState.textContent = "Signature holds";
    } else if (state === "bad") {
      fields.seal.classList.add("bad");
      fields.sealState.textContent = "Signature failed";
    } else {
      fields.seal.classList.add("pending");
      fields.sealState.textContent = "Decoded only";
    }
    fields.seal.dataset.state = state;
  }

  let shown = "";

  function render(id) {
    const token = samples.licenses[id].token.trim();
    const [headerPart, payloadPart] = token.split(".");
    const header = decodeJson(headerPart);
    const claims = decodeJson(payloadPart);
    const detail = claims.authorization_details[0];
    shown = claims.jti;
    fillSoft(fields.serial, claims.jti);
    fields.subject.textContent = claims.sub;
    fillSoft(fields.agent, claims.agent);
    fields.mandate.textContent = claims.mandate.type;
    if (claims.mandate.type === "user_goal") {
      fields.goalRow.hidden = false;
      fields.goalLabel.textContent = "Goal";
      fields.goal.textContent = claims.mandate.goal;
    } else if (claims.mandate.type === "direct_request") {
      fields.goalRow.hidden = false;
      fields.goalLabel.textContent = "Named action";
      fields.goal.textContent = claims.mandate.action + " on " + claims.mandate.location;
    } else {
      fields.goalRow.hidden = true;
      fields.goal.textContent = "";
    }
    fields.actions.textContent = detail.actions.join(", ");
    fields.locations.textContent = detail.locations.join(", ");
    fields.budget.textContent = detail.budget ? "max_calls=" + detail.budget.max_calls : "none";
    fields.expires.textContent = new Date(claims.exp * 1000).toISOString();
    fillSoft(fields.txn, claims.txn);
    fillSoft(fields.hash, claims.req_hash);
    if (claims.parent_jti) {
      fields.parentRow.hidden = false;
      fillSoft(fields.parent, claims.parent_jti);
    } else {
      fields.parentRow.hidden = true;
      fields.parent.textContent = "";
    }
    fields.chain.replaceChildren();
    for (const actor of chainOf(claims)) {
      const item = document.createElement("li");
      fillSoft(item, actor);
      fields.chain.append(item);
    }
    fields.alg.textContent = header.alg;
    fields.typ.textContent = header.typ;
    fillSoft(fields.kid, header.kid);
    fillSoft(fields.iss, claims.iss);
    fillSoft(fields.aud, claims.aud);
    fields.token.textContent = token;
    fields.payload.textContent = JSON.stringify(claims, null, 2);
    setSeal("pending");
    fields.sealState.textContent = "Checking";
    const jti = claims.jti;
    verify(token, header.kid).then((state) => {
      if (shown !== jti) return;
      setSeal(state);
    });
  }

  document.querySelectorAll('input[name="license"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) render(input.value);
    });
  });

  document.querySelectorAll("[data-show-license]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.getAttribute("data-show-license");
      const input = document.querySelector('input[name="license"][value="' + value + '"]');
      if (!input) return;
      input.checked = true;
      render(value);
      const card = document.getElementById("card");
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      card.focus({ preventScroll: true });
    });
  });

  const stamp = document.getElementById("stamp");
  const stampWord = document.getElementById("stamp-word");
  const stampCode = document.getElementById("stamp-code");
  const stampCaption = document.getElementById("stamp-caption");
  const stampLive = document.getElementById("stamp-live");

  function showStamp(kind, announce) {
    document.querySelectorAll("[data-pick]").forEach((button) => {
      button.setAttribute("aria-pressed", button.getAttribute("data-pick") === kind ? "true" : "false");
    });
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-panel") !== kind;
    });
    stamp.dataset.kind = kind;
    stamp.classList.remove("hit");
    void stamp.offsetWidth;
    stamp.classList.add("hit");
    if (kind === "allow") {
      stampWord.textContent = "Allow";
      stampCode.textContent = "allow";
      stampCaption.textContent =
        "HTTP 200. The checkpoint forwarded the call. The demo tool answered completed.";
    } else {
      stampWord.textContent = "Deny";
      stampCode.textContent = "over_scope";
      stampCaption.textContent = "HTTP 403. The call was logged and was not forwarded.";
    }
    if (announce) {
      stampLive.textContent =
        kind === "allow"
          ? "Allow. Code allow. The call was forwarded."
          : "Deny. Code over_scope. The call was not forwarded.";
    }
  }

  document.querySelectorAll("[data-pick]").forEach((button) => {
    button.addEventListener("click", () => showStamp(button.getAttribute("data-pick"), true));
  });

  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.getElementById(button.getAttribute("data-copy"));
      const text = target.innerText.trim();
      const original = button.textContent;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Not copied";
      }
      window.setTimeout(() => {
        button.textContent = original;
      }, 1600);
    });
  });

  const initial = document.querySelector('input[name="license"]:checked');
  render(initial ? initial.value : "user_goal");
})();
