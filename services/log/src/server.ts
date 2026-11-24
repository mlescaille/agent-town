import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  LicenseError,
  MerkleLog,
  closeServer,
  createHttpServer,
  entryBytes,
  listen,
  loadKeystore,
  parseDecisionRecord,
  publicJwk,
  verifyReplayedLog,
  readJson,
  requestUrl,
  sendJson,
  type DecisionRecord,
} from "@agent-license/core";

export interface Running {
  url: string;
  port: number;
  close: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FIELDS = [
  "time",
  "decision",
  "code",
  "reason",
  "license_jti",
  "justification_jti",
  "justification_hash",
  "agent",
  "sub",
  "mandate",
  "action",
  "location",
  "policy_decision",
  "why",
  "statement",
] as const;

function parseIncoming(value: unknown): Omit<DecisionRecord, "index" | "v"> {
  if (!isRecord(value)) throw new LicenseError("malformed", "log entry must be an object");
  const record: Record<string, string> = {};
  for (const field of FIELDS) {
    const item = value[field];
    if (typeof item !== "string") throw new LicenseError("malformed", `log entry ${field} must be a string`);
    record[field] = item;
  }
  if (record.decision !== "allow" && record.decision !== "deny") {
    throw new LicenseError("malformed", "decision must be allow or deny");
  }
  if (!["allow", "deny", "not_evaluated"].includes(record.policy_decision!)) {
    throw new LicenseError("malformed", "policy_decision is invalid");
  }
  return record as Omit<DecisionRecord, "index" | "v">;
}

export async function startLog(options: { home: string; port?: number; host?: string }): Promise<Running> {
  const keys = loadKeystore(options.home);
  const dir = join(options.home, "log");
  mkdirSync(dir, { recursive: true });
  const entryPath = join(dir, "entries.ndjson");
  const sthPath = join(dir, "sths.ndjson");
  const log = new MerkleLog(keys.log);
  const entryLines = existsSync(entryPath)
    ? readFileSync(entryPath, "utf8").split("\n").filter((line) => line.length > 0)
    : [];
  const sthLines = existsSync(sthPath)
    ? readFileSync(sthPath, "utf8").split("\n").filter((line) => line.length > 0)
    : [];
  if (entryLines.length > 0 || sthLines.length > 0) {
    log.load(
      entryLines.map((line) => Buffer.from(line, "utf8")),
      sthLines,
    );
    const replay = verifyReplayedLog(log.entries, log.signedTreeHeads, publicJwk(keys.log));
    if (!replay.ok) {
      throw new Error(`refusing to serve a log that does not replay: ${replay.errors.join("; ")}`);
    }
  }
  const server = createHttpServer(async (req, res) => {
    const url = requestUrl(req);
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "log", tree_size: log.treeSize });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/sth") {
      const heads = log.signedTreeHeads;
      sendJson(res, 200, {
        tree_size: log.treeSize,
        root_hash: log.rootHash(),
        sth: heads.at(-1) ?? null,
        log_id: publicJwk(keys.log).kid,
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/sths") {
      sendJson(res, 200, { sths: log.signedTreeHeads });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/entries") {
      const start = numberParam(url, "start", 0);
      const end = numberParam(url, "end", Math.max(0, log.treeSize - 1));
      if (start < 0 || end < start) throw new LicenseError("malformed", "bad entry range");
      const entries = log.entries.slice(start, end + 1).map((blob) => parseDecisionRecord(blob));
      sendJson(res, 200, { entries, tree_size: log.treeSize });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/entries") {
      const body = await readJson(req);
      const record = parseIncoming(isRecord(body) && isRecord(body.record) ? body.record : body);
      const appended = log.append(record);
      appendFileSync(entryPath, `${entryBytes(appended.record).toString("utf8")}\n`);
      appendFileSync(sthPath, `${appended.sth}\n`);
      sendJson(res, 200, {
        index: appended.index,
        leaf_hash: appended.leaf_hash,
        root_hash: appended.root_hash,
        tree_size: appended.tree_size,
        inclusion: appended.inclusion,
        sth: appended.sth,
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/proofs/inclusion") {
      const leafIndex = requiredInt(url, "leaf_index");
      const treeSize = numberParam(url, "tree_size", log.treeSize);
      sendJson(res, 200, log.proofFor(leafIndex, treeSize));
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/proofs/consistency") {
      const first = requiredInt(url, "first");
      const second = numberParam(url, "second", log.treeSize);
      sendJson(res, 200, log.consistencyFor(first, second));
      return;
    }
    sendJson(res, 404, { error: { code: "not_found", message: "not found" } });
  });
  const port = await listen(server, options.port ?? 0, options.host ?? "127.0.0.1");
  return { port, url: `http://127.0.0.1:${port}`, close: () => closeServer(server) };
}

function numberParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  return requiredRaw(name, raw);
}

function requiredInt(url: URL, name: string): number {
  return requiredRaw(name, url.searchParams.get(name));
}

function requiredRaw(name: string, raw: string | null): number {
  if (raw === null || !/^\d+$/.test(raw)) throw new LicenseError("malformed", `${name} must be an integer`);
  return Number(raw);
}
