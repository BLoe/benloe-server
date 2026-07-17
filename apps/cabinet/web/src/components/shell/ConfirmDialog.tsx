import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The one place the shell asks "are you sure?" — a destructive-action
 * confirmation modeled on the command bar's overlay (same backdrop, same
 * panel language) so it reads as native to the desk, not a browser
 * confirm() dropped in. Generic on purpose: chat delete is the first caller,
 * not the only one.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  error,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  error?: string | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the quiet action, not the destructive one — a stray Enter should
  // never confirm a delete. Esc always cancels, even mid-focus elsewhere.
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="confirm-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
    >
      <div className="confirm-box">
        <div className="confirm-title">{title}</div>
        <div className="confirm-body">{body}</div>
        {error && <div className="confirm-error">{error}</div>}
        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" ref={cancelRef} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className="confirm-danger" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
