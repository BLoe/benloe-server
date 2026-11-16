import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const fieldClass =
  'w-full min-w-0 rounded-md border border-input bg-card px-3 text-foreground placeholder:text-muted-foreground/80 transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50 aria-invalid:border-destructive';

function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" type={type} className={cn(fieldClass, 'h-11 lg:h-9', className)} {...props} />;
}

function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(fieldClass, 'min-h-20 py-2 leading-snug', className)} {...props} />;
}

/** A native select: the platform picker is the best one on a phone. */
function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        fieldClass,
        "h-11 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%237a8680%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-9 lg:h-9",
        className,
      )}
      {...props}
    />
  );
}

export { Input, Textarea, Select };
