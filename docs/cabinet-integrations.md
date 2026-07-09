# Cabinet external integrations — credential setup

Each integration activates the moment its env vars land in `/srv/benloe/.env`
(then `sudo /usr/local/sbin/cabinet-privops pm2-restart cabinet-api`). No env var =
the MCP server simply isn't registered; Cabinet runs fine without it.

| Integration | Env vars | Tier mapping |
|---|---|---|
| Yahoo Fantasy (on-box) | on by default (`CABINET_MCP_YAHOO_URL=off` to disable; `CABINET_MCP_YAHOO_TOKEN` if the local MCP requires auth) | reads T4 · lineup T3 · waivers/trades T2 |
| Google Workspace | `CABINET_MCP_GOOGLE_URL` (+ optional `CABINET_MCP_GOOGLE_TOKEN`) | reads T4 · own-calendar writes T3 · gmail send T2 |
| Plaid | `CABINET_MCP_PLAID_URL` (+ token) | read-only T4 — there is no write path |
| Apple Health | `CABINET_MCP_HEALTH_URL` (+ token) | ingestion T4 |

## Google Workspace
1. Run a Google Workspace MCP server (e.g. `taylorwilsdon/google_workspace_mcp`)
   as a PM2 app on a localhost port, completing its OAuth flow with your
   Google account (Calendar + Gmail scopes; keep `GMAIL_ALLOW_SENDING` off
   until you trust the Tier-2 gate end to end).
2. Set `CABINET_MCP_GOOGLE_URL=http://127.0.0.1:<port>/mcp` in `.env`, restart cabinet-api.

## Plaid
1. Create a Plaid developer account; run a read-only Plaid MCP server locally
   with your `PLAID_CLIENT_ID`/`PLAID_SECRET`; link accounts in the Plaid flow.
2. Set `CABINET_MCP_PLAID_URL`, restart. All financial data stays read-only (§3).

## Apple Health
1. Install Health Auto Export on the iPhone; point its REST export at a small
   receiver (or run `HealthyApps/health-auto-export-mcp-server`).
2. Set `CABINET_MCP_HEALTH_URL`, restart. Daily metrics land in `health_daily`.

## Notes
- Tokens in `.env` only (root-owned). Never in git, never in memory files.
- The tier engine gates MCP tools by name pattern (server/src/tiers/classify.ts);
  when adding a new server, add its write-action patterns there first.
