import Fastify from "fastify";
import { loadDotEnv, parseConfig } from "./config";

loadDotEnv();
const config = parseConfig();

const app = Fastify({ logger: { level: "info" } });

// Phase 0: only /api/meta. The rest of the REST API (AGENT.md section 8.3) lands in Phase 2.
app.get("/api/meta", async () => ({
  demoMode: config.DEMO_MODE,
  network: config.NETWORK,
  contractId: config.CLAVIS_CONTRACT_ID ?? null,
  hasOneClickKey: Boolean(config.ONECLICK_API_KEY),
}));

app.listen({ port: config.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
