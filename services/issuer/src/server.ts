import {
  LicenseError,
  attenuateLicense,
  closeServer,
  createHttpServer,
  issueLicense,
  listen,
  loadKeystore,
  publicJwk,
  readJson,
  requestUrl,
  sendJson,
} from "@agentlicense/core";

export interface Running {
  url: string;
  port: number;
  close: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function startIssuer(options: { home: string; port?: number; host?: string }): Promise<Running> {
  const keys = loadKeystore(options.home);
  const server = createHttpServer(async (req, res) => {
    const url = requestUrl(req);
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "issuer" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/jwks") {
      sendJson(res, 200, {
        issuer: publicJwk(keys.issuer),
        users: keys.userPublic(),
        agents: keys.agentPublic(),
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/licenses") {
      const body = await readJson(req);
      if (!isRecord(body) || typeof body.user_request !== "string") {
        throw new LicenseError("malformed", "user_request JWS is required");
      }
      const ttl = body.ttl_seconds === undefined ? undefined : body.ttl_seconds;
      if (ttl !== undefined && (typeof ttl !== "number" || !Number.isSafeInteger(ttl))) {
        throw new LicenseError("malformed", "ttl_seconds must be an integer");
      }
      const issued = issueLicense({
        userRequestJws: body.user_request,
        issuerKey: keys.issuer,
        userKeys: keys.userPublic(),
        agentKeys: keys.agentPublic(),
        ttlSeconds: ttl as number | undefined,
      });
      sendJson(res, 200, issued);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/licenses/attenuate") {
      const body = await readJson(req);
      if (!isRecord(body) || typeof body.parent !== "string" || typeof body.agent !== "string") {
        throw new LicenseError("malformed", "parent license and agent are required");
      }
      if (typeof body.exp !== "number") throw new LicenseError("malformed", "exp is required");
      const attenuated = attenuateLicense({
        parentJws: body.parent,
        issuerKey: keys.issuer,
        issuerPublicKey: publicJwk(keys.issuer),
        agentKeys: keys.agentPublic(),
        childAgent: body.agent,
        authorizationDetails: body.authorization_details,
        exp: body.exp,
      });
      sendJson(res, 200, attenuated);
      return;
    }
    sendJson(res, 404, { error: { code: "not_found", message: "not found" } });
  });
  const port = await listen(server, options.port ?? 0, options.host ?? "127.0.0.1");
  return { port, url: `http://127.0.0.1:${port}`, close: () => closeServer(server) };
}
