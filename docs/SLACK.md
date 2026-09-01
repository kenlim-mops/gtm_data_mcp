# GTM Data MCP — Slack Setup and Operations

## User experience

Runpod employees can connect **Runpod GTM Ops** from Slackbot's Apps/Integrations control and ask questions in natural language. Slackbot discovers the MCP tools and asks the user to authorize calls according to Slack's tool-permission controls. No local Codex or Claude configuration is required.

Examples:

- “Who owns Google Ads, who is the backup, and which agency operates it?”
- “Define `utm_id` and trace it to downstream reports.”
- “Find the escalation runbook for HubSpot.”
- “Validate this proposed bulk-change CSV; do not upload it.”
- “Search the UTM registry for links related to the product launch.”

The optional UTM tools appear only when `UTM_BUILDER_URL` and `UTM_BUILDER_TOKEN` are configured. The separate `/utm` Slack command is implemented by the UTM Builder and does not depend on Slackbot choosing an MCP tool.

## Why there are two Slack paths

| Path | Best use | Behavior |
| --- | --- | --- |
| Slackbot + GTM Data MCP | Exploratory questions, ownership, definitions, lineage, runbooks, template validation | Natural-language tool selection; each external tool call is subject to Slack's authorization UI |
| `/utm` and Slack shortcuts | Deterministic single-link and CSV batch creation | Fixed form, preview/confirm, duplicate handling, registry issuance, and audit logging |

Both paths are part of one Slack app, but the services remain independent. An MCP outage does not affect `/utm`, the web builder, APIs, existing links, or reporting. A UTM Builder outage affects only optional UTM MCP tools and the `/utm` command; GTM catalog searches continue.

## Slack workspace capabilities found during planning

The internal workspace currently presents an enterprise sign-in URL (`runpod.enterprise.slack.com`), organization-owner sign-in, Google and Okta SSO, Slack Connect, and the **Agents & tools / AgentExchange** surfaces with multiple installed agents. This is strong evidence of an Enterprise organization with agent/app functionality enabled. The exact commercial billing SKU was not visible to the inspecting user, and the newer Slackbot MCP Client connection itself still requires an administrator to approve the app and declared MCP server.

## Endpoint and authentication

Configure Slack identity auth against:

```text
https://YOUR_GTM_DATA_DOMAIN/api/slack/mcp
```

The endpoint:

1. reads the exact request body;
2. verifies `X-Slack-Signature` with `SLACK_SIGNING_SECRET`;
3. rejects timestamps more than five minutes from the server clock;
4. trusts `_meta.slack` only after signature verification;
5. checks optional enterprise/workspace allowlists;
6. excludes restricted records unless both the deployment and user are explicitly enabled; and
7. records successful tool invocation metadata without storing tool arguments.

The normal `/api/mcp` bearer endpoint remains available for Codex and Claude Code. Do not point Slack to the bearer endpoint and do not use `no_auth`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `SLACK_SIGNING_SECRET` | Verifies that the HTTP request originated from this Slack app |
| `SLACK_ALLOWED_ENTERPRISE_IDS` | Comma-separated enterprise IDs; set to Runpod's enterprise ID in production |
| `SLACK_ALLOWED_TEAM_IDS` | Optional workspace IDs when an installation resolves to a specific workspace |
| `SLACK_RESTRICTED_USER_IDS` | Users allowed to see restricted records, only when `GTM_INCLUDE_RESTRICTED=true` |

Keep the signing secret in Vercel environment variables. It is not the bot token and should never be committed, logged, or copied into the catalog.

## Administrator rollout

1. Deploy the MCP and confirm the bearer `/api/mcp` endpoint still works.
2. Add the Slack variables in Vercel; require an enterprise allowlist before production enablement.
3. In the shared Slack app, configure the MCP server URL with `auth_type: slack_identity_auth` and the `mcp:connect` bot scope.
4. Install to the Runpod organization if broad availability is intended; workspace installation is also supported.
5. Have a Slack administrator approve the app, scopes, server domain, and permitted audience.
6. In Slackbot, connect **Runpod GTM Ops**, inspect its discovered tools, and call `gtm_module_status`.
7. Verify one normal query, one user denial, one outside-org denial, and one audit event.
8. Enable optional UTM tools only after the UTM token is scoped and search/preview smoke tests pass.

Slack requires the remote MCP server to use Streamable HTTP and return within 60 seconds. Runpod's server is stateless and stays within that boundary; source synchronization remains on a separate scheduled route.

## Audit and incident response

Successful Slack tool calls create `mcp.tool_invoked` events with the tool name, Slack enterprise/workspace, user-derived actor, channel (`slackbot_mcp`), and restricted-access state. Tool arguments are not copied because they may contain queries or CSV content. Administrative changes and UTM writes keep their existing, more specific audit events.

If a Slack credential or app configuration is suspected compromised:

1. remove or disable the MCP server connection in Slack;
2. rotate `SLACK_SIGNING_SECRET` and redeploy;
3. review Vercel request logs and `gtm_audit_events`;
4. verify the enterprise/workspace and restricted-user allowlists; and
5. reinstall/reapprove the Slack app if scopes, domains, or server declarations changed.

Official references: [Slackbot MCP Client](https://docs.slack.dev/ai/slackbot-mcp-client/), [Slack request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/), and [MCP server admin approval](https://docs.slack.dev/ai/slackbot-mcp-client/admin-approval).
