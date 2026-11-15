import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay data-slot="dialog-overlay" className={cn('fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-[kevin-fade_150ms_ease-out]', className)} {...props} />;
}

/**
 * On a phone this is a sheet rising from the bottom edge, where thumbs are;
 * from the desktop breakpoint it is a centred dialog. Same content either way.
 */
function DialogContent({ className, children, hideClose = false, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { hideClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed z-50 flex flex-col bg-popover text-popover-foreground shadow-xl outline-none',
          'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t pb-safe data-[state=open]:animate-[kevin-sheet-up_220ms_cubic-bezier(0.2,0.8,0.2,1)]',
          'lg:inset-auto lg:top-1/2 lg:left-1/2 lg:max-h-[85vh] lg:w-full lg:max-w-lg lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-xl lg:border lg:pb-0 lg:data-[state=open]:animate-[kevin-fade_150ms_ease-out]',
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close className="absolute top-2 right-2 grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('shrink-0 space-y-1 px-5 pt-5 pr-12 pb-3', className)} {...props} />;
}

function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-body" className={cn('scroll-area min-h-0 flex-1 px-5 pb-2', className)} {...props} />;
}

function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-footer" className={cn('flex shrink-0 flex-col-reverse gap-2 px-5 pt-3 pb-5 lg:flex-row lg:justify-end', className)} {...props} />;
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-lg font-semibold leading-tight', className)} {...props} />;
}

function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription };
