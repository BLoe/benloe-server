import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // The track is 28px tall; the invisible ::before stretches the tap target to 44px.
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-input transition-colors before:absolute before:-inset-2 before:content-[''] disabled:opacity-50 data-[state=checked]:bg-primary lg:h-6 lg:w-10",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-6 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[22px] lg:size-5 lg:data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
