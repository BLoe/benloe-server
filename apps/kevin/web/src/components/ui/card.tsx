import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('rounded-xl border bg-card text-card-foreground', className)} {...props} />;
}

function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex items-center justify-between gap-3 px-4 pt-3.5 pb-1', className)} {...props} />;
}

function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 data-slot="card-title" className={cn('text-[15px] font-semibold leading-tight', className)} {...props} />;
}

function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-4 pb-4', className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardContent };
