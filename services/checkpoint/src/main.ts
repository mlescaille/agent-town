import { startCheckpoint } from "./server.js";

const home = process.env.AGENT_LICENSE_HOME ?? ".agent-license";
const port = Number(process.env.PORT ?? 43122);
const running = await startCheckpoint({
  home,
  port,
  pdpUrl: process.env.AGENT_LICENSE_PDP_URL ?? "http://127.0.0.1:43123",
  logUrl: process.env.AGENT_LICENSE_LOG_URL ?? "http://127.0.0.1:43124",
  upstreamUrl: process.env.AGENT_LICENSE_UPSTREAM_URL ?? "http://127.0.0.1:43125",
});
console.log(`checkpoint ${running.url}`);
