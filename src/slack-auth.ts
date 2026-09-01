import { createHmac, timingSafeEqual } from "node:crypto";

export interface SlackIdentity {
  userId: string;
  teamId: string | null;
  enterpriseId: string | null;
}

export interface SlackSignatureInput {
  rawBody: string;
  timestamp: string | undefined;
  signature: string | undefined;
  signingSecret: string | undefined;
  nowSeconds?: number;
}

function csvSet(value: string | undefined) {
  return new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean));
}

export function verifySlackSignature(input: SlackSignatureInput): boolean {
  if (!input.signingSecret || !input.timestamp || !input.signature) return false;
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) return false;
  const expected = `v0=${createHmac("sha256", input.signingSecret)
    .update(`v0:${input.timestamp}:${input.rawBody}`)
    .digest("hex")}`;
  const suppliedBuffer = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function slackIdentityFromBody(body: unknown): SlackIdentity | null {
  if (!body || typeof body !== "object") return null;
  const params = (body as { params?: unknown }).params;
  if (!params || typeof params !== "object") return null;
  const meta = (params as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== "object") return null;
  const slack = (meta as { slack?: unknown }).slack;
  if (!slack || typeof slack !== "object") return null;
  const value = slack as Record<string, unknown>;
  if (typeof value.user_id !== "string" || !value.user_id) return null;
  return {
    userId: value.user_id,
    teamId: typeof value.team_id === "string" ? value.team_id : null,
    enterpriseId: typeof value.enterprise_id === "string" ? value.enterprise_id : null,
  };
}

export function slackIdentityAllowed(
  identity: SlackIdentity,
  allowedTeamIds = process.env.SLACK_ALLOWED_TEAM_IDS,
  allowedEnterpriseIds = process.env.SLACK_ALLOWED_ENTERPRISE_IDS,
) {
  const teams = csvSet(allowedTeamIds);
  const enterprises = csvSet(allowedEnterpriseIds);
  if (!teams.size && !enterprises.size) return true;
  return Boolean(
    (identity.teamId && teams.has(identity.teamId)) ||
      (identity.enterpriseId && enterprises.has(identity.enterpriseId)),
  );
}

export function slackActor(identity: SlackIdentity) {
  return `slack:${identity.enterpriseId ?? identity.teamId ?? "unknown"}:${identity.userId}`;
}

export function slackUserCanReadRestricted(identity: SlackIdentity) {
  return csvSet(process.env.SLACK_RESTRICTED_USER_IDS).has(identity.userId);
}
