import { useEffect, useState } from 'react';
import type { MessagePart } from '../lib/protocol.js';
import type { ChatMessage } from '../lib/threadStore.js';
import { api, type ApprovalPacket } from '../lib/api.js';
import { renderMarkdown } from '../lib/markdown.js';
import { Widget } from './widgets.jsx';

function ToolRunCard({ part }: { part: Extract<MessagePart, { type: 'tool-run' }> }) {
  const cmd =
    typeof part.input === 'object' && part.input && 'command' in part.input
      ? String((part.input as { command: unknown }).command)
      : JSON.stringify(part.input);
  return (
    <details className="tool-run">
      <summary>
        <span className="tool-name">{part.name}</span>
        <span className="tool-cmd">{cmd}</span>
        <span className={`status${part.isError ? ' err' : ''}`}>{!part.done ? '…' : part.isError ? 'ERR' : 'OK'}</span>
      </summary>
      {part.output !== undefined && <pre className="out">{part.output}</pre>}
    </details>
  );
}

/** The paper chit: the one place the dark UI hands you paper to sign. */
export function ApprovalChit({ packet, onDecided }: { packet: ApprovalPacket; onDecided?: (id: string, status: string) => void }) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'denied' | 'expired'>('pending');
  const [remaining, setRemaining] = useState(() => Math.max(0, Date.parse(packet.expiresAt) - Date.now()));
  const total = Math.max(1, Date.parse(packet.expiresAt) - Date.now());

  useEffect(() => {
    if (status !== 'pending') return;
    const t = setInterval(() => {
      const r = Math.max(0, Date.parse(packet.expiresAt) - Date.now());
      setRemaining(r);
      if (r === 0) setStatus('expired');
    }, 1000);
    return () => clearInterval(t);
  }, [packet.expiresAt, status]);

  const decide = async (approved: boolean) => {
    try {
      await api.decide(packet.id, approved);
      setStatus(approved ? 'approved' : 'denied');
      onDecided?.(packet.id, approved ? 'approved' : 'denied');
    } catch {
      setStatus('expired');
    }
  };

  const mins = Math.floor(remaining / 60_000);
  const countdownLabel = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;

  return (
    <div className="chit" role="group" aria-label="approval required">
      <header>
        <span>TIER {packet.tier} — AWAITING YOUR SIGN-OFF</span>
        <span>{status === 'pending' ? countdownLabel : status.toUpperCase()}</span>
      </header>
      <div className="action">{packet.action}</div>
      <div className="payload">{packet.payload}</div>
      {packet.reasoning && <div className="reasoning">{packet.reasoning}</div>}
      <div className="countdown"><div style={{ width: `${(remaining / total) * 100}%` }} /></div>
      {status === 'pending' ? (
        <div className="actions">
          <button className="approve" onClick={() => decide(true)}>Approve</button>
          <button onClick={() => decide(false)}>Deny</button>
        </div>
      ) : (
        <div className="decided">{status === 'approved' ? '✓ APPROVED' : status === 'denied' ? '✗ DENIED' : '— EXPIRED'}</div>
      )}
    </div>
  );
}

function ApprovalRef({ approvalId }: { approvalId: string }) {
  const [packet, setPacket] = useState<ApprovalPacket | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    api.approvals()
      .then(({ approvals }) => {
        const p = approvals.find((a) => a.id === approvalId);
        if (p) setPacket(p);
        else setGone(true);
      })
      .catch(() => setGone(true));
  }, [approvalId]);
  if (packet) return <ApprovalChit packet={packet} />;
  return <div className="notice">{gone ? `approval ${approvalId.slice(0, 8)} already decided` : 'loading approval…'}</div>;
}

export function MessageView({ message, onCheckin }: { message: ChatMessage; onCheckin?: (k: string, v: number) => void }) {
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
    return (
      <div className="msg-user">
        <div className="body">{text}</div>
      </div>
    );
  }
  return (
    <div className={`msg-assistant${message.streaming ? ' streaming' : ''}`}>
      {message.parts.map((part, i) => {
        switch (part.type) {
          case 'text':
            return <div key={i} className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }} />;
          case 'tool-run':
            return <ToolRunCard key={i} part={part} />;
          case 'widget':
            return <Widget key={i} widgetType={part.widgetType} data={part.data as Record<string, unknown>} onCheckin={onCheckin} />;
          case 'approval-ref':
            return <ApprovalRef key={i} approvalId={part.approvalId} />;
          case 'notice':
            return <div key={i} className={`notice${part.level === 'warn' ? ' warn' : ''}`}>{part.text}</div>;
          default:
            return null;
        }
      })}
      {message.streaming && <span className="cursor" aria-hidden="true" />}
    </div>
  );
}
