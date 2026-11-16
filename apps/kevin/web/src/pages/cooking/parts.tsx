import { Heart, Star } from 'lucide-react';
import { useEffect } from 'react';
import { subscribe } from '@/lib/events';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { addToList } from '../pantry/actions';
import { missingToAdd, type PantryFit } from './logic';

/** Five stars, read-only. Nothing at all for an unrated thing. */
export function Stars({ value, className }: { value: number | null; className?: string }) {
  if (!value) return null;
  return (
    <span role="img" aria-label={`${value} of 5 stars`} className={cn('inline-flex shrink-0 items-center gap-px align-middle', className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn('size-3.5', n <= value ? 'fill-warning text-warning' : 'text-muted-foreground/35')} />
      ))}
    </span>
  );
}

/** Five 44px stars to tap. Tapping the current rating again clears it. */
export function StarInput({ value, onChange, size = 'md' }: { value: number | null; onChange: (v: number | null) => void; size?: 'md' | 'lg' }) {
  return (
    <div role="radiogroup" aria-label="Rating" className="-ml-2 flex items-center">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`} onClick={() => onChange(value === n ? null : n)} className={cn('grid place-items-center rounded-md', size === 'lg' ? 'size-14' : 'size-11')}>
          <Star className={cn(size === 'lg' ? 'size-9' : 'size-7', value != null && n <= value ? 'fill-warning text-warning' : 'text-muted-foreground/50')} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
}

export function FavouriteMark({ on, className }: { on: boolean; className?: string }) {
  return on ? <Heart aria-label="Favourite" className={cn('size-4 shrink-0 fill-destructive text-destructive', className)} /> : null;
}

/**
 * Cooking views are computed against the pantry, but `useView` only refetches
 * on writes to its own domain. This refetches a cooking view when the pantry
 * changes too (Kevin logs "used 3 eggs", a shopping trip is put away).
 */
export function usePantryRefresh(refetch: () => void): void {
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === 'data_changed' && e.domains.includes('pantry') && !e.domains.includes('cooking')) refetch();
      }),
    [refetch],
  );
}

/** One tap: everything a recipe still needs goes on the shopping list, tagged with the recipe. */
export async function addMissing(fit: PantryFit, recipeId: number): Promise<void> {
  const items = missingToAdd(fit, recipeId);
  if (!items.length) {
    toast.info('Already on the shopping list');
    return;
  }
  await addToList(items);
}
