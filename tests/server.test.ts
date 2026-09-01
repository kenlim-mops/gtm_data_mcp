import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { bearerAuthorized } from "../src/auth.js";
import { slackIdentityAllowed, slackIdentityFromBody, verifySlackSignature } from "../src/slack-auth.js";
import { createGtmDataServer } from "../src/server.js";
import { JsonCatalogStore } from "../src/stores/json.js";
import { UtmBuilderClient } from "../src/utm-client.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

async function connectedClient(withUtm = false) {
  const store = await JsonCatalogStore.open("./data/catalog.json");
  const utmClient = withUtm
    ? new UtmBuilderClient("https://utm.example", "token", (async () => new Response("{}", { headers: { "Content-Type": "application/json" } })) as typeof fetch)
    : null;
  const server = createGtmDataServer({ store, utmClient });
  const client = new Client({ name: "gtm-data-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(() => client.close());
  return client;
}

describe("GTM Data MCP server", () => {
  it("registers catalog tools but no UTM tools without configuration", async () => {
    const client = await connectedClient(false);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain("gtm_search_catalog");
    expect(tools).toContain("gtm_validate_bulk_change");
    expect(tools.some((name) => name.startsWith("utm_"))).toBe(false);
  });

  it("registers the optional UTM tools when configured", async () => {
    const client = await connectedClient(true);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toEqual(expect.arrayContaining(["utm_preview_link", "utm_issue_link", "utm_issue_batch"]));
  });

  it("returns governed definitions through the MCP protocol", async () => {
    const client = await connectedClient(false);
    const response = await client.callTool({ name: "gtm_get_data_definition", arguments: { query: "utm_id" } });
    const content = response.content as Array<{ type: string; text?: string }>;
    const text = content[0]?.type === "text" ? content[0].text ?? "" : "";
    expect(JSON.parse(text)).toContainEqual(expect.objectContaining({ key: "utm_id", verificationState: "verified" }));
  });
});

describe("bearer authorization", () => {
  it("requires the exact configured bearer token", () => {
    expect(bearerAuthorized("Bearer correct", "correct")).toBe(true);
    expect(bearerAuthorized("Bearer wrong", "correct")).toBe(false);
    expect(bearerAuthorized("Basic correct", "correct")).toBe(false);
    expect(bearerAuthorized(undefined, "correct")).toBe(false);
  });
});

describe("Slack identity authorization", () => {
  it("verifies current signed requests and rejects replays", () => {
    const rawBody = '{"jsonrpc":"2.0","method":"tools/list"}';
    const timestamp = "1700000000";
    const signature = `v0=${createHmac("sha256", "secret").update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
    expect(verifySlackSignature({ rawBody, timestamp, signature, signingSecret: "secret", nowSeconds: 1700000000 })).toBe(true);
    expect(verifySlackSignature({ rawBody, timestamp, signature, signingSecret: "secret", nowSeconds: 1700000601 })).toBe(false);
  });

  it("extracts and allowlists signed-request identity metadata", () => {
    const identity = slackIdentityFromBody({ params: { _meta: { slack: { user_id: "U1", team_id: null, enterprise_id: "E1" } } } });
    expect(identity).toEqual({ userId: "U1", teamId: null, enterpriseId: "E1" });
    expect(slackIdentityAllowed(identity!, "", "E1")).toBe(true);
    expect(slackIdentityAllowed(identity!, "T2", "E2")).toBe(false);
  });
});
