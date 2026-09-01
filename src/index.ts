#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGtmDataServer } from "./server.js";
import { createStoreFromEnv } from "./store-factory.js";
import { createUtmClientFromEnv } from "./utm-client.js";

const store = await createStoreFromEnv();
const server = createGtmDataServer({
  store,
  utmClient: createUtmClientFromEnv(),
  includeRestricted: process.env.GTM_INCLUDE_RESTRICTED === "true",
});
await server.connect(new StdioServerTransport());

const shutdown = async () => {
  await server.close();
  await store.close?.();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
