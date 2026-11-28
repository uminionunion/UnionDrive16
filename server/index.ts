import "dotenv/config";
import { loadConfig } from "./config";
import { createApp } from "./app";

const config = loadConfig();
const app = createApp(config);
const server = app.listen(config.port, "127.0.0.1", () => {
  console.info(`UnionDrive API listening on http://127.0.0.1:${config.port} (${config.demoMode ? "demo mode" : "live mode"})`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
