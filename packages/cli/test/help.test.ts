import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("agentlicense help", () => {
  const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const help = source.match(/const HELP = `([\s\S]*?)`;/)?.[1] ?? "";

  it("documents every string option the parser accepts", () => {
    const keys = [
      ...source.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][A-Za-z0-9-]*)):\s*\{\s*type:\s*"string"/gm),
    ].map((match) => match[1] ?? match[2] ?? "");
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) expect(help).toContain(`--${key}`);
  });

  it("names every command", () => {
    for (const command of ["keys init", "issue", "inspect", "attenuate", "check", "log verify", "dev"]) {
      expect(help).toContain(command);
    }
  });
});
