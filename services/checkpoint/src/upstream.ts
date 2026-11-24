import {
  closeServer,
  createHttpServer,
  listen,
  readJson,
  requestUrl,
  sendJson,
} from "@agent-license/core";

export interface Running {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/** A stand-in tool API. The checkpoint is the only component that should call it. */
export async function startDemoUpstream(options: { port?: number; host?: string } = {}): Promise<Running> {
  const server = createHttpServer(async (req, res) => {
    const url = requestUrl(req);
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "upstream" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/invoke") {
      const body = await readJson(req);
      sendJson(res, 200, { ok: true, result: "completed", echo: body });
      return;
    }
    sendJson(res, 404, { error: { code: "not_found", message: "not found" } });
  });
  const port = await listen(server, options.port ?? 0, options.host ?? "127.0.0.1");
  return { port, url: `http://127.0.0.1:${port}`, close: () => closeServer(server) };
}
