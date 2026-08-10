/**
 * Make an MCP drop visible.
 *
 * Incident 2026-08-08 20:23 UTC (task 58): the cabinet MCP toolset was
 * unavailable to the model for exactly one turn and then returned. Nothing
 * server-side recorded it — cabinet-api had not restarted and logged no
 * errors — so the only evidence it happened at all was a system notice inside
 * the model's own context, which Cabinet happened to read and mention.
 *
 * The defect in that incident is not the blip, it is the silence: on a turn
 * that logged a meal and then moved on, the write would have vanished while
 * the chat still read "logged". This module does not fix that. It is part (3)
 * of the task — make the transition diagnosable from the logs — so that the
 * durable outbox and the turn-end reconciliation can be built against
 * evidence instead of against a single anecdote.
 */

/** Shape of the fields this reads from the SDK's system/init message. */
export interface InitSnapshot {
  tools?: unknown;
  mcp_servers?: unknown;
}

export interface McpStatus {
  /** Status the SDK reports for the `cabinet` server, or null if absent. */
  serverStatus: string | null;
  /** How many `mcp__cabinet__*` tools the query launched with. */
  toolCount: number;
  /** True when the toolset looks usable for persistence. */
  healthy: boolean;
}

/**
 * The cabinet MCP server is in-process (createSdkMcpServer), so it cannot
 * fail independently of the API process. A non-connected status or a missing
 * toolset therefore means the CLI subprocess's connection state flipped —
 * which is the thing worth recording, since nothing else does.
 */
export function readMcpStatus(msg: InitSnapshot, serverName = 'cabinet'): McpStatus {
  const servers = Array.isArray(msg.mcp_servers) ? (msg.mcp_servers as { name?: string; status?: string }[]) : [];
  const entry = servers.find((s) => s?.name === serverName);
  const tools = Array.isArray(msg.tools) ? (msg.tools as unknown[]) : [];
  const prefix = `mcp__${serverName}__`;
  const toolCount = tools.filter((t) => typeof t === 'string' && t.startsWith(prefix)).length;
  const serverStatus = typeof entry?.status === 'string' ? entry.status : null;
  return {
    serverStatus,
    toolCount,
    // Deliberately generous: any non-zero toolset counts as healthy. The
    // failure this catches is the toolset being ABSENT, and a floor tied to
    // today's tool count would fire on every legitimate tool addition.
    healthy: toolCount > 0 && (serverStatus === null || serverStatus === 'connected'),
  };
}

/**
 * Log only on change, plus every unhealthy turn.
 *
 * A line per turn would bury the transition in noise, and the transition is
 * the whole point — but an unhealthy state that persists across turns needs
 * to stay visible rather than being reported once and then going quiet.
 */
export function describeTransition(prev: McpStatus | null, next: McpStatus): string | null {
  if (!next.healthy) {
    return `mcp cabinet UNAVAILABLE — status=${next.serverStatus ?? 'absent'} tools=${next.toolCount}. ` +
      `Persistence tools are missing for this turn; writes the model believes it made may not exist.`;
  }
  if (prev && !prev.healthy) {
    return `mcp cabinet recovered — status=${next.serverStatus ?? 'absent'} tools=${next.toolCount}`;
  }
  if (prev && prev.toolCount !== next.toolCount) {
    return `mcp cabinet tool count changed ${prev.toolCount} → ${next.toolCount}`;
  }
  return null;
}
