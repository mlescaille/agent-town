import { startPdp } from "./server.js";

const port = Number(process.env.PORT ?? 43123);
const running = await startPdp({ port });
console.log(`pdp ${running.url}`);
