import { useEffect, useRef, useState } from 'react';

/**
 * The ⌘K command bar — the universal way to direct Cabinet. A quiet trigger in
 * the top bar; ⌘K (or ⌃K) anywhere opens a focused overlay. Enter submits the
 * intent, Esc closes. Chat is what happens when an intent needs a conversation.
 */
export function CommandBar({ onSubmit }: { onSubmit?: (intent: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Auto-grow the textarea to fit its content (CSS caps it at max-height and
  // scrolls beyond that) instead of scrolling the text sideways forever.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, open]);

  const submit = () => {
    const intent = value.trim();
    if (!intent) return;
    onSubmit?.(intent);
    setValue('');
    setOpen(false);
  };

  return (
    <>
      <button className="cmd-trigger" onClick={() => setOpen(true)} aria-label="Open command bar" aria-haspopup="dialog">
        <span className="lead" aria-hidden="true">&rsaquo;</span>
        <span>Tell the cabinet what to do&hellip;</span>
        <span className="kbd">&#8984;K</span>
      </button>

      {open && (
        <div className="cmd-overlay" role="dialog" aria-modal="true" aria-label="Command bar" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="cmd-box">
            <div className="row">
              <span className="lead" aria-hidden="true">&rsaquo;</span>
              <textarea
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="Direct the cabinet, ask a question, log something, build&hellip;"
                aria-label="Command input"
                rows={1}
              />
            </div>
            <div className="hint">
              <span>Enter to send</span>
              <span>Shift+Enter for a new line</span>
              <span>Esc to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
