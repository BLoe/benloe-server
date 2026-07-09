/**
 * Hand-rolled SSE wire (§12.2). We own both ends, so this module is the
 * protocol: named events, JSON data, optional ids. The parser is written to
 * be chunk-boundary safe and is round-trip fuzz-tested against the encoder.
 */

export interface SseEvent {
  event: string;
  data: unknown;
  id?: string;
}

export function encodeSse(e: SseEvent): string {
  const lines: string[] = [];
  if (e.id !== undefined) lines.push(`id: ${e.id}`);
  lines.push(`event: ${e.event}`);
  // JSON never contains raw newlines, so a single data: line always suffices.
  lines.push(`data: ${JSON.stringify(e.data)}`);
  return lines.join('\n') + '\n\n';
}

export const SSE_HEARTBEAT = ': hb\n\n';

/** Incremental parser: feed arbitrary chunks, get complete events out. */
export function createSseParser(onEvent: (e: SseEvent) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = 'message';
      let id: string | undefined;
      const dataLines: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith(':')) continue; // comment/heartbeat
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        else if (line.startsWith('id: ')) id = line.slice(4);
        else if (line.startsWith('id:')) id = line.slice(3).trim();
      }
      if (dataLines.length === 0) continue;
      let data: unknown;
      try {
        data = JSON.parse(dataLines.join('\n'));
      } catch {
        data = dataLines.join('\n');
      }
      onEvent({ event, data, ...(id !== undefined ? { id } : {}) });
    }
  };
}
