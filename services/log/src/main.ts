import { startLog } from "./server.js";

const home = process.env.AGENT_LICENSE_HOME ?? ".agent-license";
const port = Number(process.env.PORT ?? 43124);
const running = await startLog({ home, port });
console.log(`log ${running.url}`);
