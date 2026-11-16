import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverClose = PopoverPrimitive.Close;

function PopoverContent({ className, align = 'end', sideOffset = 6, ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn('z-50 w-80 max-w-[calc(100vw-1rem)] rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none data-[state=open]:animate-[kevin-fade_120ms_ease-out]', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverClose, PopoverContent };
