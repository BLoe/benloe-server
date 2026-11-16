import { useId, type FormEvent, type ReactNode } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * The pattern for adding or editing one thing: a bottom sheet on a phone, a
 * centred dialog on desktop. Fields go in as children (use <Field>); the
 * footer is a full-width primary button on a phone, right-aligned on desktop.
 * `onSubmit` runs on the button and on Enter; close it yourself on success.
 */
export function FormDialog({ open, onOpenChange, title, description, submitLabel = 'Save', pending = false, canSubmit = true, onSubmit, extraAction, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  submitLabel?: string;
  pending?: boolean;
  canSubmit?: boolean;
  onSubmit: () => void;
  /** A secondary control in the footer, e.g. a Delete button when editing. */
  extraAction?: ReactNode;
  children: ReactNode;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pending && canSubmit) onSubmit();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={description ? undefined : undefined}>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4 pt-1">{children}</DialogBody>
          <DialogFooter>
            {extraAction && <div className="lg:mr-auto">{extraAction}</div>}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !canSubmit}>
              {pending ? 'Saving…' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A labelled form control. Pass a render function to receive the id for the control. */
export function Field({ label, hint, error, children, className }: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode | ((id: string) => ReactNode);
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {typeof children === 'function' ? children(id) : children}
      {error ? <p className="text-sm text-destructive">{error}</p> : hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Two fields side by side from tablet width up, stacked on a phone. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

/** "Are you sure?" for anything that cannot be undone. The confirm button names the action. */
export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel = 'Delete', destructive = true, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription className={body ? undefined : 'sr-only'}>{body ?? title}</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction destructive={destructive} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
