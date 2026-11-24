import { startIssuer } from "./server.js";

const home = process.env.AGENT_LICENSE_HOME ?? ".agent-license";
const port = Number(process.env.PORT ?? 43121);
const running = await startIssuer({ home, port });
console.log(`issuer ${running.url}`);
