import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { bearerAuthorized } from "./auth.js";
import { createGtmDataServer } from "./server.js";
import { createStoreFromEnv } from "./store-factory.js";
import { createUtmClientFromEnv } from "./utm-client.js";
import {
  slackActor,
  slackIdentityAllowed,
  slackIdentityFromBody,
  slackUserCanReadRestricted,
  verifySlackSignature,
} from "./slack-auth.js";

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

async function rawRequestBody(req: IncomingMessage & { body?: unknown; rawBody?: unknown }) {
  if (typeof req.rawBody === "string") return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString("utf8");
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

/** Slackbot MCP Client endpoint: Slack signature + signed `_meta.slack` identity. */
export async function handleSlackMcpHttp(
  req: IncomingMessage & { body?: unknown; rawBody?: unknown },
  res: ServerResponse,
) {
  const rawBody = await rawRequestBody(req);
  if (!verifySlackSignature({
    rawBody,
    timestamp: req.headers["x-slack-request-timestamp"] as string | undefined,
    signature: req.headers["x-slack-signature"] as string | undefined,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  })) {
    jsonRpcError(res, 401, -32001, "Invalid Slack request signature.");
    return;
  }

  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : req.body;
  } catch {
    jsonRpcError(res, 400, -32700, "Invalid JSON request body.");
    return;
  }
  const method = body && typeof body === "object" ? (body as { method?: unknown }).method : null;
  const identity = slackIdentityFromBody(body);
  if (method === "tools/call" && (!identity || !slackIdentityAllowed(identity))) {
    jsonRpcError(res, 403, -32003, "Slack identity is missing or is not allowed.");
    return;
  }

  const store = await getStore();
  const includeRestricted = Boolean(
    process.env.GTM_INCLUDE_RESTRICTED === "true" && identity && slackUserCanReadRestricted(identity),
  );
  const server = createGtmDataServer({
    store,
    utmClient: createUtmClientFromEnv(),
    includeRestricted,
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    await transport.handleRequest(req, res, body);
    const toolName = body && typeof body === "object"
      ? (body as { params?: { name?: unknown } }).params?.name
      : null;
    if (identity && method === "tools/call" && typeof toolName === "string") {
      await store.recordInvocation?.({
        actor: slackActor(identity),
        action: "mcp.tool_invoked",
        entityType: "mcp_tool",
        entityId: toolName,
        after: {
          channel: "slackbot_mcp",
          teamId: identity.teamId,
          enterpriseId: identity.enterpriseId,
          restrictedRecords: includeRestricted,
        },
      });
    }
  } finally {
    await server.close();
  }
}
