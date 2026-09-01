import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { bearerAuthorized } from "./auth.js";
import { createGtmDataServer } from "./server.js";
import { createStoreFromEnv } from "./store-factory.js";
import { createUtmClientFromEnv } from "./utm-client.js";

let storePromise: ReturnType<typeof createStoreFromEnv> | null = null;
const getStore = () => storePromise ??= createStoreFromEnv();

export async function handleMcpHttp(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  if (!bearerAuthorized(req.headers.authorization, process.env.GTM_MCP_BEARER_TOKEN)) {
    res.writeHead(401, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }));
    return;
  }
  const server = createGtmDataServer({
    store: await getStore(),
    utmClient: createUtmClientFromEnv(),
    includeRestricted: process.env.GTM_INCLUDE_RESTRICTED === "true",
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
