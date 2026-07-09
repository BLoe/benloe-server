/**
 * External MCP registrations (§8). Config-gated: a server is registered only
 * when its env var is present, so absent credentials mean no dead tools in
 * context. Setup guides: docs/cabinet-integrations.md.
 */
export interface HttpMcpConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export function buildExternalMcpServers(env: Record<string, string | undefined>): Record<string, HttpMcpConfig> {
  const servers: Record<string, HttpMcpConfig> = {};

  // Yahoo Fantasy — already running on this box (yahoo-fantasy-mcp :3006).
  const yahooUrl = env.CABINET_MCP_YAHOO_URL ?? 'http://127.0.0.1:3006/mcp';
  if (yahooUrl !== 'off') {
    servers.yahoo = {
      type: 'http',
      url: yahooUrl,
      ...(env.CABINET_MCP_YAHOO_TOKEN ? { headers: { Authorization: `Bearer ${env.CABINET_MCP_YAHOO_TOKEN}` } } : {}),
    };
  }

  const gated: [name: string, urlVar: string, tokenVar: string][] = [
    ['google', 'CABINET_MCP_GOOGLE_URL', 'CABINET_MCP_GOOGLE_TOKEN'],
    ['plaid', 'CABINET_MCP_PLAID_URL', 'CABINET_MCP_PLAID_TOKEN'],
    ['health', 'CABINET_MCP_HEALTH_URL', 'CABINET_MCP_HEALTH_TOKEN'],
  ];
  for (const [name, urlVar, tokenVar] of gated) {
    const url = env[urlVar];
    if (!url) continue;
    servers[name] = {
      type: 'http',
      url,
      ...(env[tokenVar] ? { headers: { Authorization: `Bearer ${env[tokenVar]}` } } : {}),
    };
  }
  return servers;
}
