import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70 active:bg-secondary/60',
        outline: 'border border-input bg-card hover:bg-muted active:bg-secondary',
        ghost: 'hover:bg-secondary active:bg-secondary/70',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      // Phone sizes come first: every control is at least 44px tall until the desktop breakpoint.
      size: {
        default: 'h-11 px-4 lg:h-9',
        sm: 'h-10 px-3 lg:h-8 lg:text-[13px]',
        lg: 'h-12 px-5 text-base lg:h-10 lg:text-sm',
        icon: 'size-11 lg:size-9',
        'icon-sm': 'size-10 lg:size-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({ className, variant, size, asChild = false, type, ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" type={asChild ? undefined : (type ?? 'button')} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
