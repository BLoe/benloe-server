import { Camera, Check, Images, LoaderCircle, Plus, ReceiptText, Refrigerator, SlidersHorizontal } from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { sendPhoto, type PhotoKind } from './actions';
import { expiryLabel, type PantryItem } from './logic';

/** Red when past its date, amber when close, plain text when there is time. */
export function ExpiryChip({ item }: { item: Pick<PantryItem, 'days_left' | 'expiry' | 'expires_on'> }) {
  if (item.days_left == null) return null;
  const label = expiryLabel(item.days_left, item.expires_on);
  if (item.expiry === 'expired') return <Badge variant="danger">{label}</Badge>;
  if (item.expiry === 'soon') return <Badge variant="warning">{label}</Badge>;
  return <span>{label}</span>;
}

/**
 * One line that adds to the list under it; the keyboard stays up for the next
 * one. `onMore` opens the full form with whatever has been typed so far.
 */
export function AddLine({ placeholder, label, onAdd, onMore }: { placeholder: string; label: string; onAdd: (text: string) => void; onMore?: (text: string) => void }) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd(text);
    setText('');
  };
  return (
    <form onSubmit={submit} className="flex items-center rounded-xl border border-input bg-card pl-3.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={label} enterKeyHint="done" autoCapitalize="none" maxLength={120} className="h-12 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/80 lg:h-10" />
      {onMore && (
        <button
          type="button"
          onClick={() => {
            onMore(text);
            setText('');
          }}
          aria-label="Add with details"
          title="Add with details"
          className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground lg:size-9"
        >
          <SlidersHorizontal className="size-[18px]" />
        </button>
      )}
      <button type="submit" disabled={!text.trim()} aria-label="Add" className="grid size-12 shrink-0 place-items-center rounded-lg text-primary disabled:text-muted-foreground/50 lg:size-10">
        <Plus className="size-5" />
      </button>
    </form>
  );
}

/** A 56px tap target around a 28px box: big enough to hit with a thumb while pushing a cart. */
export function BigCheck({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={onChange} className="grid w-14 shrink-0 place-items-center self-stretch">
      <span className={cn('grid size-7 place-items-center rounded-lg border-2 transition-colors', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card')}>
        {checked && <Check className="size-[18px]" strokeWidth={3} />}
      </span>
    </button>
  );
}

/**
 * "Add from photo": the camera for the fridge or a receipt, or a picture
 * already on the phone. The photo goes to Kevin in a new chat and he updates
 * the pantry; the page refreshes when he does.
 */
export function PhotoButton({ children, variant = 'outline', size, className }: { children?: ReactNode; variant?: 'outline' | 'default'; size?: 'default' | 'lg'; className?: string }) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const kind = useRef<PhotoKind>('any');
  const [busy, setBusy] = useState<string | null>(null);
  const pick = (k: PhotoKind, input: HTMLInputElement | null) => {
    kind.current = k;
    input?.click();
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void sendPhoto(file, kind.current, setBusy);
  };
  return (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} data-testid="pantry-camera" />
      <input ref={library} type="file" accept="image/*,application/pdf" className="hidden" onChange={onFile} data-testid="pantry-library" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} size={size} className={className} disabled={!!busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Camera />}
            {busy ?? children ?? 'Add from photo'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => pick('kitchen', camera.current)}>
            <Refrigerator />
            Snap the fridge or shelves
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pick('receipt', camera.current)}>
            <ReceiptText />
            Snap a receipt
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pick('any', library.current)}>
            <Images />
            Choose a photo or receipt
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
