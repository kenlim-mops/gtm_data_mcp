import { describe, expect, it, vi } from "vitest";
import { UtmBuilderClient, createUtmClientFromEnv } from "../src/utm-client.js";

describe("UtmBuilderClient", () => {
  it("is disabled unless both URL and token exist", () => {
    expect(createUtmClientFromEnv({})).toBeNull();
    expect(createUtmClientFromEnv({ UTM_BUILDER_URL: "https://utm.example" })).toBeNull();
    expect(createUtmClientFromEnv({ UTM_BUILDER_URL: "https://utm.example", UTM_BUILDER_TOKEN: "token" })).toBeInstanceOf(UtmBuilderClient);
  });

  it("sends bearer auth and a stable idempotency key when issuing", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ link: { id: "rpl_123" } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
    const client = new UtmBuilderClient("https://utm.example", "server-secret", fetcher);

    await client.issueLink({ destination: "https://runpod.io" }, "request-12345678");

    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    expect(String(url)).toBe("https://utm.example/api/v1/links");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer server-secret",
      "Idempotency-Key": "request-12345678",
    });
  });

  it("maps query to q and propagates a safe upstream error", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Duplicate link" } }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
    const client = new UtmBuilderClient("https://utm.example", "server-secret", fetcher);

    await expect(client.searchLinks({ query: "launch", page: 2 })).rejects.toThrow("Duplicate link");
    expect(String(vi.mocked(fetcher).mock.calls[0][0])).toBe("https://utm.example/api/v1/links?q=launch&page=2");
  });
});
