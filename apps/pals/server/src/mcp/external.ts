/**
 * External MCP registrations (§8). Config-gated: a server is registered only
 * when its env var is present, so absent credentials mean no dead tools in
 * context. Setup guides: docs/pals-integrations.md.
 */
export interface HttpMcpConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export function buildExternalMcpServers(env: Record<string, string | undefined>): Record<string, HttpMcpConfig> {
  const servers: Record<string, HttpMcpConfig> = {};

  // Yahoo Fantasy — already running on this box (yahoo-fantasy-mcp :3006).
  const yahooUrl = env.PALS_MCP_YAHOO_URL ?? 'http://127.0.0.1:3006/mcp';
  if (yahooUrl !== 'off') {
    servers.yahoo = {
      type: 'http',
      url: yahooUrl,
      ...(env.PALS_MCP_YAHOO_TOKEN ? { headers: { Authorization: `Bearer ${env.PALS_MCP_YAHOO_TOKEN}` } } : {}),
    };
  }

  const gated: [name: string, urlVar: string, tokenVar: string][] = [
    ['google', 'PALS_MCP_GOOGLE_URL', 'PALS_MCP_GOOGLE_TOKEN'],
    ['plaid', 'PALS_MCP_PLAID_URL', 'PALS_MCP_PLAID_TOKEN'],
    ['health', 'PALS_MCP_HEALTH_URL', 'PALS_MCP_HEALTH_TOKEN'],
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
