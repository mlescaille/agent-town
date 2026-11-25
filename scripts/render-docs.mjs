import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "scripts/site.config.json"), "utf8"));
const origin = config.origin.replace(/\/$/, "");

const NAV = [
  ["quickstart", "Quickstart"],
  ["concepts", "Concepts"],
  ["cli", "CLI"],
  ["sdk", "SDK"],
  ["checkpoint", "Checkpoint"],
  ["faq", "FAQ"],
];

const PAGES = [
  { slug: "index", file: "docs/README.md", out: "site/docs/index.html", path: "/docs/" },
  { slug: "quickstart", file: "docs/quickstart.md", out: "site/docs/quickstart/index.html", path: "/docs/quickstart/" },
  { slug: "concepts", file: "docs/concepts.md", out: "site/docs/concepts/index.html", path: "/docs/concepts/" },
  { slug: "cli", file: "docs/cli.md", out: "site/docs/cli/index.html", path: "/docs/cli/" },
  { slug: "sdk", file: "docs/sdk.md", out: "site/docs/sdk/index.html", path: "/docs/sdk/" },
  { slug: "checkpoint", file: "docs/checkpoint.md", out: "site/docs/checkpoint/index.html", path: "/docs/checkpoint/" },
  { slug: "faq", file: "docs/faq.md", out: "site/docs/faq/index.html", path: "/docs/faq/" },
];

function runHelp() {
  const bin = join(root, "packages/cli/dist/main.js");
  const result = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr || "agentlicense --help failed. Run pnpm build first.");
    process.exit(result.status ?? 1);
  }
  return result.stdout.replace(/\s+$/, "");
}

function parseHelp(help) {
  const names = ["keys init", "issue", "inspect", "attenuate", "check", "log verify", "dev"];
  const lines = help.split("\n");
  const preamble = [];
  let index = 0;
  while (index < lines.length && !names.includes(lines[index])) {
    preamble.push(lines[index]);
    index += 1;
  }
  const commands = [];
  while (index < lines.length) {
    const name = lines[index];
    if (!names.includes(name)) break;
    index += 1;
    const description = [];
    const flags = [];
    while (index < lines.length && !names.includes(lines[index])) {
      const line = lines[index];
      if (line.startsWith("  --") || line.startsWith("  <")) flags.push(line.trim());
      else if (line.trim()) description.push(line.trim());
      index += 1;
    }
    commands.push({ name, description: description.join(" "), flags });
  }
  return { preamble: preamble.join("\n").trim(), commands };
}

function flagRow(line) {
  const match = line.match(/^((?:--|<)[^ ]+(?: <[^>]+>)?)\s{2,}([\s\S]+)$/);
  if (!match) return { flag: line, text: "" };
  return { flag: match[1], text: match[2] };
}

function proseFromHelp(block) {
  return block
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Long usage lines become one flag per continued line. Short commands stay one line. */
function reflowCommand(line) {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== "agentlicense") return line.trim();
  const head = [];
  const flags = [];
  let index = 0;
  head.push(tokens[index]);
  index += 1;
  while (index < tokens.length && !tokens[index].startsWith("--") && !tokens[index].startsWith("[")) {
    head.push(tokens[index]);
    index += 1;
  }
  while (index < tokens.length) {
    let piece = tokens[index];
    index += 1;
    if ((piece.startsWith("--") || piece.startsWith("[")) && index < tokens.length && !tokens[index].startsWith("--") && !tokens[index].startsWith("[")) {
      piece += ` ${tokens[index]}`;
      index += 1;
    }
    flags.push(piece);
  }
  const single = [...head, ...flags].join(" ");
  if (flags.length === 0 || single.length <= 32) return single;
  const lines = [`${head.join(" ")} \\`];
  flags.forEach((flag, flagIndex) => {
    lines.push(`  ${flag}${flagIndex === flags.length - 1 ? "" : " \\"}`);
  });
  return lines.join("\n");
}

function usageFromPreamble(preamble) {
  const before = [];
  const commands = [];
  const after = [];
  let phase = "before";
  for (const line of preamble.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "Usage:") {
      phase = "commands";
      continue;
    }
    if (phase === "commands" && trimmed.startsWith("agentlicense")) {
      commands.push(reflowCommand(trimmed));
      continue;
    }
    if (phase === "commands" && trimmed === "") continue;
    if (phase === "commands") phase = "after";
    if (phase === "before") before.push(line);
    else after.push(line);
  }
  return {
    before: proseFromHelp(before.join("\n")),
    commands: commands.join("\n"),
    after: proseFromHelp(after.join("\n")),
  };
}

function writeCliMarkdown(help) {
  const parsed = parseHelp(help);
  const usage = usageFromPreamble(parsed.preamble);
  const sections = parsed.commands
    .map((command) => {
      const rows = command.flags
        .map((line) => {
          const { flag, text } = flagRow(line);
          return `| \`${flag}\` | ${text} |`;
        })
        .join("\n");
      const table = rows ? `\n| Flag | Meaning |\n| --- | --- |\n${rows}\n` : "";
      return `## ${command.name}\n\n${command.description}\n${table}`;
    })
    .join("\n");
  const body = `---
title: CLI reference
description: Every agentlicense command and flag, generated from agentlicense --help.
---

# CLI reference

<!-- Contributors: edit the help text in packages/cli/src/main.ts, then run pnpm render-docs. Do not edit this file by hand. -->

Every command and flag of \`agentlicense\`, taken from \`agentlicense --help\`.

${usage.before}

## Usage

\`\`\`sh
${usage.commands}
\`\`\`

${usage.after}

${sections}
## Help text

The help text below is \`agentlicense --help\`, unchanged.

\`\`\`text
${help}
\`\`\`
`;
  writeFileSync(join(root, "docs/cli.md"), body);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function rewriteHref(href, slug) {
  const match = href.match(/^(?:\.\/)?([A-Za-z0-9_-]+)\.md$/);
  if (!match) return href;
  const target = match[1] === "README" ? "index" : match[1];
  if (slug === "index") return target === "index" ? "./" : `${target}/`;
  return target === "index" ? "../" : `../${target}/`;
}

function inline(text, slug) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        const escaped = escapeHtml(part.slice(1, -1)).replaceAll("-", "&#8209;").replaceAll("/", "/<wbr>");
        return `<code>${escaped}</code>`;
      }
      const escaped = escapeHtml(part);
      return escaped
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
          const url = rewriteHref(href, slug);
          return `<a href="${escapeHtml(url)}">${label}</a>`;
        });
    })
    .join("");
}

function renderMarkdown(markdown, slug) {
  const lines = markdown.split("\n");
  const html = [];
  let index = 0;
  let term = 0;

  function fence(lang, code) {
    const trimmed = code.replace(/\n$/, "");
    if (lang === "sh" || lang === "bash" || lang === "shell") {
      term += 1;
      const id = `term-${slug}-${term}`;
      return `<div class="term" id="${id}" role="region" aria-label="Commands"><button type="button" class="term-copy" data-copy="${id}" aria-label="Copy commands"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span class="copy-label">Copy</span></button><div class="term-scroll"><pre><code>${escapeHtml(trimmed)}</code></pre></div></div>`;
    }
    return `<div class="codeblock"><div class="codeblock-scroll"><pre><code>${escapeHtml(trimmed)}</code></pre></div></div>`;
  }

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (line.startsWith("<!--") && !line.startsWith("<!-- include:")) {
      html.push(line);
      index += 1;
      continue;
    }
    const include = line.match(/^<!-- include:([^\s]+) -->$/);
    if (include) {
      const included = readFileSync(join(root, include[1]), "utf8");
      html.push(fence("js", included));
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const buf = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        buf.push(lines[index]);
        index += 1;
      }
      index += 1;
      html.push(fence(lang, `${buf.join("\n")}\n`));
      continue;
    }
    const heading = line.match(/^(#{1,3}) (.+)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2], slug)}</h${level}>`);
      index += 1;
      continue;
    }
    if (line.startsWith("> ")) {
      const buf = [];
      while (index < lines.length && lines[index].startsWith("> ")) {
        buf.push(lines[index].slice(2));
        index += 1;
      }
      html.push(`<blockquote><p>${inline(buf.join(" "), slug)}</p></blockquote>`);
      continue;
    }
    if (line.startsWith("| ")) {
      const rows = [];
      while (index < lines.length && lines[index].startsWith("| ")) {
        rows.push(lines[index]);
        index += 1;
      }
      const cells = (row) =>
        row
          .replace(/^\| /, "")
          .replace(/ \|$/, "")
          .split(" | ")
          .map((cell) => cell.trim());
      const header = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      const headHtml = header.map((cell) => `<th>${inline(cell, slug)}</th>`).join("");
      const bodyHtml = body
        .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell, slug)}</td>`).join("")}</tr>`)
        .join("");
      html.push(`<div class="table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`);
      continue;
    }
    if (line.startsWith("- ")) {
      const items = [];
      while (index < lines.length && lines[index].startsWith("- ")) {
        items.push(lines[index].slice(2));
        index += 1;
      }
      html.push(`<ul>${items.map((item) => `<li>${inline(item, slug)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\. /.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\. /, ""));
        index += 1;
      }
      html.push(`<ol>${items.map((item) => `<li>${inline(item, slug)}</li>`).join("")}</ol>`);
      continue;
    }
    const buf = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !lines[index].startsWith("#") &&
      !lines[index].startsWith("```") &&
      !lines[index].startsWith("| ") &&
      !lines[index].startsWith("- ") &&
      !lines[index].startsWith("> ") &&
      !/^\d+\. /.test(lines[index]) &&
      !lines[index].startsWith("<!--")
    ) {
      buf.push(lines[index]);
      index += 1;
    }
    html.push(`<p>${inline(buf.join(" "), slug)}</p>`);
  }
  return html.join("\n");
}

function splitFrontMatter(text) {
  if (!text.startsWith("---\n")) return { meta: {}, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { meta: {}, body: text };
  const meta = {};
  for (const line of text.slice(4, end).split("\n")) {
    const match = line.match(/^([a-z]+): (.*)$/);
    if (match) meta[match[1]] = match[2];
  }
  return { meta, body: text.slice(end + 5) };
}

const MARK = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3.2 27.5 9.6v12.8L16 28.8 4.5 22.4V9.6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10.2 16.2 14.2 20.2 22 11.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const COPY = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

function pageHtml({ slug, title, description, body, path }) {
  const prefix = slug === "index" ? "../" : "../../";
  const canonical = `${origin}${path}`;
  const nav = NAV.map(([id, label]) => {
    const href = slug === "index" ? `${id}/` : `../${id}/`;
    const current = id === slug ? ` aria-current="page"` : "";
    return `<a href="${href}"${current}>${label}</a>`;
  }).join("\n      ");
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareSourceCode",
        name: "Agent License",
        description:
          "Signed agent licenses for agent identity, delegated authority, and on-behalf-of calls, checked outside the agent.",
        codeRepository: config.repo,
        programmingLanguage: "TypeScript",
        runtimePlatform: "Node.js",
        license: "https://spdx.org/licenses/MIT.html",
        version: "0.1.0",
      },
      {
        "@type": "SoftwareApplication",
        name: "agentlicense",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "any",
        softwareVersion: "0.1.0",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        softwareRequirements: "Node.js >= 22",
        codeRepository: config.repo,
      },
      {
        "@type": "TechArticle",
        headline: title,
        description,
        url: canonical,
        isPartOf: canonical.startsWith(origin) ? `${origin}/` : origin,
      },
    ],
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta name="theme-color" content="#000000">
  <title>${escapeHtml(title)} · Agent License</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${origin}/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${origin}/og.png">
  <link rel="icon" href="${prefix}favicon.svg" type="image/svg+xml">
  <link rel="preload" href="${prefix}fonts/inter-700.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${prefix}fonts/inter-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${prefix}fonts/plex-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${prefix}styles.css">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
  <a class="skip" href="#content">Skip to content</a>
  <header class="nav">
    <a class="brand" href="${prefix}">
      ${MARK}
      Agent License
    </a>
    <button class="menu" type="button" aria-expanded="false" aria-controls="nav-links">
      <span class="sr">Menu</span>
      ${COPY}
    </button>
    <nav class="nav-links" id="nav-links" aria-label="Primary">
      <a href="${prefix}docs/">Docs</a>
      <a href="${config.spec}">Spec</a>
      <a href="${config.repo}">GitHub</a>
      <a class="btn" href="${prefix}docs/quickstart/">Get started <span aria-hidden="true">→</span></a>
    </nav>
  </header>
  <main class="doc" id="content">
    <div class="doc-nav-wrap">
    <nav class="doc-nav" aria-label="Documentation">
      ${nav}
    </nav>
    </div>
    <article class="prose">
${body}
    </article>
  </main>
  <footer class="foot">
    <nav aria-label="Footer">
      <a href="${prefix}docs/">Docs</a>
      <a href="${config.spec}">Spec</a>
      <a href="${config.repo}">GitHub</a>
      <a href="${config.roadmap}">Roadmap</a>
    </nav>
  </footer>
  <script src="${prefix}nav.js"></script>
</body>
</html>
`;
}

function writeLlms(pages) {
  const links = pages
    .filter((page) => page.slug !== "index")
    .map((page) => `- [${page.title}](${origin}${page.path}): ${page.description}`)
    .join("\n");
  const llms = `# Agent License

> Signed agent licenses that say which agent is calling, who it acts for, and what it may do. Checked at a checkpoint outside the agent.

Agent License is a prototype of agent identity and delegated authority. An issuer signs a license. The agent presents that license and a per-call justification. A checkpoint checks the signature, the mandate, the delegation chain, and a Cedar policy, then appends the decision to a Merkle log. The CLI is \`agentlicense\`. The SDK entry point is \`licensed(fetch)\` from \`@agentlicense/sdk\`.

This repository is a prototype. Services bind to localhost. The npm packages are not published yet.

## Docs

${links}

## Optional

- [License format](${config.spec}): Byte-level rules for the license, justification, and log
- [Roadmap](${config.roadmap}): MCP gateway and the limits of this prototype
- [Repository](${config.repo}): Source, issues, and the \`agentlicense\` CLI
- [Proposed descriptor](${origin}/.well-known/agent-license.json): Not an IANA registration. The running PDP's AuthZEN discovery document is separate
`;
  const full = [
    llms.trim(),
    "",
    "# Full documentation",
    "",
    pages
      .map((page) => page.markdown.trim())
      .join("\n\n---\n\n"),
    "",
  ].join("\n");
  writeFileSync(join(root, "site/llms.txt"), `${llms.trim()}\n`);
  writeFileSync(join(root, "site/llms-full.txt"), full);
  writeFileSync(join(root, "llms.txt"), `${llms.trim()}\n`);
  writeFileSync(join(root, "llms-full.txt"), full);
}

function writeSitemap(pages) {
  const urls = [{ path: "/" }, ...pages.map((page) => ({ path: page.path }))];
  const body = urls
    .map((url) => `  <url><loc>${origin}${url.path}</loc></url>`)
    .join("\n");
  writeFileSync(
    join(root, "site/sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
  );
  writeFileSync(
    join(root, "site/robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`,
  );
}

const help = runHelp();
writeCliMarkdown(help);

const rendered = [];
for (const page of PAGES) {
  const raw = readFileSync(join(root, page.file), "utf8");
  const { meta, body } = splitFrontMatter(raw);
  const html = renderMarkdown(body, page.slug);
  const title = meta.title ?? page.slug;
  const description = meta.description ?? "";
  const file = pageHtml({ slug: page.slug, title, description, body: html, path: page.path });
  const destination = join(root, page.out);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, file);
  rendered.push({ ...page, title, description, markdown: body.trim() });
  console.log(relative(root, destination));
}

writeLlms(rendered);
writeSitemap(rendered);
console.log("site/llms.txt");
console.log("site/sitemap.xml");
