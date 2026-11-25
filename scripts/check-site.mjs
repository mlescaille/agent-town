import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const root = new URL("../site/", import.meta.url).pathname;
const failures = [];

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function localTarget(fromFile, href) {
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("http:") || href.startsWith("https:")) {
    return null;
  }
  const [pathPart, hash] = href.split("#");
  if (!pathPart) return { file: fromFile, hash };
  const base = pathPart.endsWith("/") ? join(dirname(fromFile), pathPart, "index.html") : join(dirname(fromFile), pathPart);
  return { file: normalize(base), hash };
}

const htmlFiles = walk(root).filter((file) => file.endsWith(".html"));
for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  if (!html.includes("<title>") || !html.includes('name="description"') || !html.includes('rel="canonical"')) {
    failures.push(`${file} missing title, description, or canonical`);
  }
  if (!html.includes("og:image") || !html.includes("application/ld+json")) {
    failures.push(`${file} missing Open Graph image or JSON-LD`);
  }
  const hrefs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  for (const href of hrefs) {
    const target = localTarget(file, href);
    if (!target) continue;
    try {
      statSync(target.file);
    } catch {
      failures.push(`${file} -> ${href} (${target.file})`);
    }
  }
}

const robots = readFileSync(join(root, "robots.txt"), "utf8");
if (!robots.includes("Sitemap:") || !robots.includes("Allow: /")) failures.push("robots.txt incomplete");
const sitemap = readFileSync(join(root, "sitemap.xml"), "utf8");
if (!sitemap.includes("<urlset") || !sitemap.includes("/docs/quickstart/")) failures.push("sitemap.xml incomplete");
const llms = readFileSync(join(root, "llms.txt"), "utf8");
if (!llms.startsWith("# Agent License") || !llms.includes("licensed(fetch)")) failures.push("llms.txt incomplete");
statSync(join(root, "llms-full.txt"));
statSync(join(root, "og.png"));
statSync(join(root, ".well-known/agent-license.json"));
JSON.parse(readFileSync(join(root, ".well-known/agent-license.json"), "utf8"));

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`site links ok (${htmlFiles.length} html files)`);
