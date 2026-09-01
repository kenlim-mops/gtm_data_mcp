export class UtmBuilderClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(path: string, init: RequestInit = {}) {
    const response = await this.fetcher(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    const body = await response.json().catch(() => ({ error: { message: response.statusText } }));
    if (!response.ok) throw new Error(body?.error?.message ?? body?.error ?? `UTM Builder request failed (${response.status}).`);
    return body;
  }

  async referenceData() {
    const [initiatives, campaigns, presets, taxonomy] = await Promise.all([
      this.request("/api/v1/initiatives"),
      this.request("/api/v1/campaigns"),
      this.request("/api/v1/presets"),
      this.request("/api/v1/taxonomy"),
    ]);
    return { ...initiatives, ...campaigns, ...presets, ...taxonomy };
  }

  searchLinks(input: Record<string, unknown>) {
    const params = new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => [key === "query" ? "q" : key, String(value)]));
    return this.request(`/api/v1/links?${params}`);
  }

  previewLink(input: Record<string, unknown>) {
    return this.request("/api/v1/links/preview", { method: "POST", body: JSON.stringify(input) });
  }

  issueLink(input: Record<string, unknown>, idempotencyKey: string) {
    return this.request("/api/v1/links", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input) });
  }

  issueBatch(rows: Record<string, unknown>[], source: "grid" | "paste" | "csv") {
    return this.request("/api/v1/batches", { method: "POST", body: JSON.stringify({ rows, source }) });
  }
}

export function createUtmClientFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return env.UTM_BUILDER_URL && env.UTM_BUILDER_TOKEN
    ? new UtmBuilderClient(env.UTM_BUILDER_URL, env.UTM_BUILDER_TOKEN)
    : null;
}
