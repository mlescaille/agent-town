import {
  closeServer,
  createHttpServer,
  listen,
  readJson,
  requestUrl,
  sendJson,
} from "@agentlicense/core";

import { evaluateAccess, evaluateBatch } from "./evaluate.js";
import { loadPolicies } from "./policy.js";

export interface Running {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startPdp(options: { port?: number; host?: string; policyPath?: string } = {}): Promise<Running> {
  const policies = loadPolicies(options.policyPath);
  const server = createHttpServer(async (req, res) => {
    const url = requestUrl(req);
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "pdp" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/.well-known/authzen-configuration") {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : options.port;
      const base = `http://127.0.0.1:${port}`;
      sendJson(res, 200, {
        policy_decision_point: base,
        access_evaluation_endpoint: `${base}/access/v1/evaluation`,
        access_evaluations_endpoint: `${base}/access/v1/evaluations`,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/access/v1/evaluation") {
      sendJson(res, 200, evaluateAccess(await readJson(req), policies));
      return;
    }
    if (req.method === "POST" && url.pathname === "/access/v1/evaluations") {
      try {
        sendJson(res, 200, evaluateBatch(await readJson(req), policies));
      } catch (error) {
        sendJson(res, 400, {
          error: { code: "malformed", message: error instanceof Error ? error.message : String(error) },
        });
      }
      return;
    }
    sendJson(res, 404, { error: { code: "not_found", message: "not found" } });
  });
  const port = await listen(server, options.port ?? 0, options.host ?? "127.0.0.1");
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => closeServer(server),
  };
}
