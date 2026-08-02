import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { CredentialMeta, CredentialSlot, CredentialsView, EnvVarReport } from '../src/lib/contracts.js';

const { credentialsMock, saveMock, deleteMock } = vi.hoisted(() => ({
  credentialsMock: vi.fn<() => Promise<CredentialsView>>(),
  saveMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('../src/lib/cabinet.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/lib/cabinet.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      credentials: credentialsMock,
      saveCredential: saveMock,
      deleteCredential: deleteMock,
    },
  };
});

import userEvent from '@testing-library/user-event';
// ApiError is deliberately NOT mocked: the surface's error handling keys off
// the real class, so the tests throw the real thing.
import { ApiError } from '../src/lib/client.js';
import { Credentials, fmtAgo, normalizeStamp } from '../src/surfaces/Credentials.js';

/* Every stamp below is SQLite-shaped — naive UTC, no zone marker — because
   that is what the server actually sends and the parsing of it is the one
   thing on this surface that can be wrong without looking wrong. */
const CLIENT_ID_META: CredentialMeta = {
  id: 1,
  name: 'plaid-client-id',
  provider: 'Plaid',
  description: 'Identifies this Cabinet install to Plaid.',
  created_at: '2026-07-18 15:02:44',
  updated_at: '2026-08-02 04:41:09',
  last_used_at: '2026-08-02 06:10:52',
  rotated_at: null,
};

const SLOTS: CredentialSlot[] = [
  {
    name: 'plaid-client-id', group: 'Plaid', label: 'Client ID',
    description: 'Identifies this Cabinet install to Plaid.',
    where: 'Plaid Dashboard → Developers → Keys → client_id',
    required: true, stored: true, meta: CLIENT_ID_META,
  },
  {
    name: 'plaid-secret', group: 'Plaid', label: 'Secret',
    description: 'The API secret for the environment set in PLAID_ENV.',
    where: 'Plaid Dashboard → Developers → Keys',
    required: true, stored: false, meta: null,
  },
  {
    name: 'weather-api-key', group: 'Weather', label: 'Forecast API key',
    description: 'Optional — enables the morning forecast line.',
    where: 'weatherapi.com → account → API key',
    required: false, stored: false, meta: null,
  },
];

const MANAGED: CredentialMeta[] = [
  {
    id: 2, name: 'plaid-item-9f3ac1', provider: 'Plaid', description: 'Access token — Chase',
    created_at: '2026-07-18 15:14:03', updated_at: '2026-07-18 15:14:03',
    last_used_at: '2026-08-02 06:10:41', rotated_at: null,
  },
];

const UNRECOGNISED: CredentialMeta[] = [
  {
    id: 3, name: 'leftover-token', provider: null, description: null,
    created_at: '2026-05-02 11:20:00', updated_at: '2026-05-02 11:20:00',
    last_used_at: null, rotated_at: null,
  },
];

const ENV: EnvVarReport[] = [
  // Non-secret config, and optional: it has a working default, so unset would
  // be fine. Set here, and the value is the point, so it renders.
  {
    name: 'PLAID_ENV', label: 'Plaid environment',
    description: "'sandbox' for fake test banks, 'production' for real ones.",
    reason: 'Read once at boot by the Plaid client.',
    set: true, required: false, scrubbed: false, value: 'sandbox',
  },
  // The master key: presence only, forever.
  {
    name: 'CABINET_CRED_KEY', label: 'Credential encryption key',
    description: 'The AES-256 key that encrypts everything on this page.',
    reason: 'The bootstrap secret — it lives in root-owned /srv/benloe/.env.',
    set: true, required: true, scrubbed: true, value: null,
  },
  // Required AND missing — the one env row that has earned a warning.
  {
    name: 'CABINET_PUBLIC_ORIGIN', label: 'Public origin',
    description: 'Base URL used to build the Plaid OAuth redirect and webhook URLs.',
    reason: 'Read at boot to build URLs Plaid has already allow-listed.',
    set: false, required: true, scrubbed: false, value: null,
  },
  // Hostile fixture: a scrubbed entry that arrives WITH a value anyway. The
  // server can't produce this, but if a future one ever does, the page must
  // still refuse to render it. This row is the regression test for that.
  // Also optional — unset here is a feature that's off, not a fault.
  {
    name: 'GITHUB_APP_PRIVATE_KEY_B64', label: 'GitHub App private key',
    description: 'Scrubbed from the process environment at boot.',
    reason: 'Secret, and root-injected.',
    set: false, required: false, scrubbed: true, value: 'leak-me-please',
  },
];

function view(overrides: Partial<CredentialsView> = {}): CredentialsView {
  return {
    configured: true,
    credentials: [CLIENT_ID_META, ...MANAGED, ...UNRECOGNISED],
    slots: SLOTS,
    managed: MANAGED,
    unrecognised: UNRECOGNISED,
    env: ENV,
    ...overrides,
  };
}

/** The same view with plaid-secret now stored — what a reload after a save returns. */
function viewWithSecretStored(): CredentialsView {
  return view({
    slots: SLOTS.map((s) =>
      s.name === 'plaid-secret'
        ? {
            ...s, stored: true,
            meta: {
              id: 4, name: 'plaid-secret', provider: 'Plaid', description: s.description,
              created_at: '2026-08-02 07:00:00', updated_at: '2026-08-02 07:00:00',
              last_used_at: null, rotated_at: null,
            },
          }
        : s,
    ),
  });
}

beforeEach(() => {
  for (const m of [credentialsMock, saveMock, deleteMock]) m.mockReset();
  credentialsMock.mockResolvedValue(view());
  saveMock.mockResolvedValue({ ok: true, created: true, credential: CLIENT_ID_META });
  deleteMock.mockResolvedValue({ ok: true, deleted: 'plaid-client-id' });
});
afterEach(cleanup);

const slotRow = (label: string) => screen.getByText(label).closest('li') as HTMLElement;

describe('naive-UTC timestamps', () => {
  it("appends the zone SQLite's datetime('now') leaves off", () => {
    expect(normalizeStamp('2026-08-02 04:41:09')).toBe('2026-08-02T04:41:09Z');
    // and the parse that follows is UTC, not local — the actual bug this
    // exists to prevent, asserted independently of the runner's timezone.
    expect(Date.parse(normalizeStamp('2026-08-02 04:41:09'))).toBe(Date.UTC(2026, 7, 2, 4, 41, 9));
  });

  it('passes an already-zoned string through unchanged', () => {
    for (const s of ['2026-08-02T04:41:09Z', '2026-08-02T04:41:09.250Z', '2026-08-02T00:41:09-04:00']) {
      expect(normalizeStamp(s)).toBe(s);
    }
  });

  it('returns a malformed string untouched instead of throwing', () => {
    for (const s of ['', 'never', 'yesterday', '2026-08-02']) {
      expect(() => normalizeStamp(s)).not.toThrow();
      expect(normalizeStamp(s)).toBe(s);
    }
  });

  it('reads a naive stamp relative to now, and says so honestly when it cannot', () => {
    const now = Date.UTC(2026, 7, 2, 6, 41, 9);
    expect(fmtAgo('2026-08-02 06:40:09', now)).toBe('just now');
    expect(fmtAgo('2026-08-02 06:11:09', now)).toBe('30 min ago');
    expect(fmtAgo('2026-08-02 04:41:09', now)).toBe('2 h ago');
    expect(fmtAgo('2026-07-28 06:41:09', now)).toBe('5 d ago');
    expect(fmtAgo('2026-05-02 11:20:00', now)).toBe('May 2 2026');
    expect(fmtAgo(null, now)).toBe('never');
    expect(fmtAgo('yesterday', now)).toBe('yesterday');
  });
});

describe('Credentials surface', () => {
  it('renders slots grouped by integration, each with its set / not-set status', async () => {
    render(<Credentials />);
    const slots = await screen.findByLabelText('Integrations');

    // Two group headings, in catalog order.
    const groups = within(slots).getAllByRole('heading');
    expect(groups.map((h) => h.textContent)).toEqual(['Plaid', 'Weather']);

    // The slot that has a value, inside the Plaid group.
    const plaid = within(slots).getByLabelText('Plaid');
    const clientId = within(plaid).getByText('Client ID').closest('li') as HTMLElement;
    expect(within(clientId).getByText('Set')).toBeTruthy();
    expect(clientId.textContent).toContain('plaid-client-id');
    expect(clientId.textContent).toContain('Plaid Dashboard → Developers → Keys → client_id');
    // stored ⇒ rotate, not set
    expect(within(clientId).getByRole('button', { name: 'Rotate' })).toBeTruthy();

    // The one that doesn't, and is required — warning tone, not the quiet one,
    // and "required" lives INSIDE the pill rather than in a second tag beside it.
    const secret = within(plaid).getByText('Secret').closest('li') as HTMLElement;
    const pill = within(secret).getByText('Not set · required');
    expect(pill.className).toContain('warn');
    expect(secret.querySelector('.cred-req')).toBeNull();
    expect(within(secret).getByRole('button', { name: 'Set' })).toBeTruthy();
    expect(within(secret).queryByRole('button', { name: 'Delete' })).toBeNull();

    // An optional empty slot is missing, not wrong.
    const weather = within(slots).getByLabelText('Weather');
    const forecast = within(weather).getByText('Forecast API key').closest('li') as HTMLElement;
    expect(within(forecast).getByText('Not set').className).toContain('dim');
  });

  it('takes a secret through a password field and clears it the moment it is stored', async () => {
    // The reload after a successful save sees the slot filled.
    credentialsMock.mockResolvedValueOnce(view()).mockResolvedValue(viewWithSecretStored());
    saveMock.mockResolvedValue({ ok: true, created: true, credential: CLIENT_ID_META });
    render(<Credentials />);

    await screen.findByLabelText('Integrations');
    await userEvent.click(within(slotRow('Secret')).getByRole('button', { name: 'Set' }));

    const input = screen.getByLabelText('Value for Secret') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');

    await userEvent.type(input, 'sandbox-secret-abc123');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'plaid-secret', secret: 'sandbox-secret-abc123' }),
      ),
    );

    // Cleared in place — the same node, now empty — and the plaintext appears
    // nowhere on the surface.
    await waitFor(() => expect(input.value).toBe(''));
    expect(document.body.textContent).not.toContain('sandbox-secret-abc123');
    // …and the store now reports the slot as filled.
    await waitFor(() => expect(within(slotRow('Secret')).getByText('Set')).toBeTruthy());
    // There is no way to read it back, and the page says so rather than implying otherwise.
    expect(screen.getByText(/no way to read the value back/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /reveal|show secret/i })).toBeNull();
  });

  it('refuses every save and says why when the server has no encryption key', async () => {
    credentialsMock.mockResolvedValue(view({ configured: false }));
    render(<Credentials />);

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('No encryption key on the server');
    expect(banner.textContent).toMatch(/CABINET_CRED_KEY/);

    // Nothing can be saved: the only route to the input is closed.
    for (const name of ['Rotate', 'Set']) {
      for (const btn of screen.getAllByRole('button', { name })) {
        expect((btn as HTMLButtonElement).disabled).toBe(true);
      }
    }
    expect(screen.queryByLabelText('Value for Secret')).toBeNull();
    // Deleting still works without a key — dropping unreadable ciphertext is a complete delete.
    expect((screen.getAllByRole('button', { name: 'Delete' })[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it('surfaces a 409 as "managed automatically" rather than a generic failure', async () => {
    saveMock.mockRejectedValue(
      new ApiError(
        409,
        "'plaid-client-id' is managed automatically by an integration and cannot be set by hand. Re-link the account instead.",
      ),
    );
    render(<Credentials />);

    await screen.findByLabelText('Integrations');
    await userEvent.click(within(slotRow('Client ID')).getByRole('button', { name: 'Rotate' }));
    await userEvent.type(screen.getByLabelText('New value for Client ID'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/managed automatically by an integration/)).toBeTruthy();
  });

  it('reads a 503 as a missing server key, not a generic failure', async () => {
    saveMock.mockRejectedValue(new ApiError(503, 'CABINET_CRED_KEY is not set'));
    render(<Credentials />);

    await screen.findByLabelText('Integrations');
    await userEvent.click(within(slotRow('Secret')).getByRole('button', { name: 'Set' }));
    await userEvent.type(screen.getByLabelText('Value for Secret'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/No encryption key on the server/)).toBeTruthy();
  });

  it('confirms before deleting a stored credential', async () => {
    render(<Credentials />);
    await screen.findByLabelText('Integrations');

    await userEvent.click(within(slotRow('Client ID')).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('cannot be recovered');
    expect(deleteMock).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('plaid-client-id'));
  });

  it('lists machine-managed credentials read-only and unrecognised ones with a delete', async () => {
    render(<Credentials />);

    const managed = await screen.findByLabelText('Managed automatically');
    const row = within(managed).getByText('plaid-item-9f3ac1').closest('li') as HTMLElement;
    expect(within(row).queryByRole('button')).toBeNull();
    // One word for the concept, per row, in both read-only lists.
    expect(row.textContent).toContain('read-only');

    const unknown = screen.getByLabelText('Unrecognised');
    const stray = within(unknown).getByText('leftover-token').closest('li') as HTMLElement;
    await userEvent.click(within(stray).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('leftover-token'));
  });

  it('omits both sections when there is nothing machine-managed or unrecognised', async () => {
    credentialsMock.mockResolvedValue(view({ managed: [], unrecognised: [] }));
    render(<Credentials />);

    await screen.findByLabelText('Integrations');
    expect(screen.queryByLabelText('Managed automatically')).toBeNull();
    expect(screen.queryByLabelText('Unrecognised')).toBeNull();
  });

  it('renders an environment value only when the server sent one, and never for a secret', async () => {
    render(<Credentials />);
    const env = await screen.findByLabelText('Environment');

    // Read-only, and it says so, with the restart caveat.
    expect(env.textContent).toContain('read-only');
    expect(env.textContent).toMatch(/restart/i);

    // Config var: value present, so it's on screen.
    const plaidEnv = within(env).getByText('PLAID_ENV').closest('li') as HTMLElement;
    expect(plaidEnv.querySelector('.cred-env-val')?.textContent).toBe('sandbox');
    expect(plaidEnv.textContent).toContain('Read once at boot by the Plaid client.');

    // Master key: no value sent, none invented.
    const key = within(env).getByText('CABINET_CRED_KEY').closest('li') as HTMLElement;
    expect(key.querySelector('.cred-env-val')).toBeNull();
    expect(key.textContent).toContain('not shown');
    expect(within(key).getByText('Set')).toBeTruthy();

    // Hostile payload: scrubbed AND carrying a value. Still never rendered.
    const github = within(env).getByText('GITHUB_APP_PRIVATE_KEY_B64').closest('li') as HTMLElement;
    expect(github.querySelector('.cred-env-val')).toBeNull();
    expect(document.body.textContent).not.toContain('leak-me-please');
    expect(within(github).getByText('Not set')).toBeTruthy();
  });

  it('warns about an unset env var only when it is required', async () => {
    render(<Credentials />);
    const env = await screen.findByLabelText('Environment');

    // Optional and unset: a feature that's off, not a fault. Quiet tone, and
    // no "required" in the label — a page that shouts about integrations Ben
    // never turned on teaches him to skip the section that matters.
    const optional = within(env).getByText('GITHUB_APP_PRIVATE_KEY_B64').closest('li') as HTMLElement;
    const optionalPill = optional.querySelector('.cred-pill') as HTMLElement;
    expect(optionalPill.textContent).toBe('Not set');
    expect(optionalPill.className).toContain('dim');
    expect(optionalPill.className).not.toContain('warn');

    // Required and unset: the one that has earned the brass.
    const needed = within(env).getByText('CABINET_PUBLIC_ORIGIN').closest('li') as HTMLElement;
    const neededPill = needed.querySelector('.cred-pill') as HTMLElement;
    expect(neededPill.textContent).toBe('Not set · required');
    expect(neededPill.className).toContain('warn');

    // Set, required or not, reads the same: stored is stored.
    const key = within(env).getByText('CABINET_CRED_KEY').closest('li') as HTMLElement;
    expect((key.querySelector('.cred-pill') as HTMLElement).className).toContain('ok');
  });

  it('marks every environment row read-only, not just the section lede', async () => {
    render(<Credentials />);
    const env = await screen.findByLabelText('Environment');

    // Four rows in the fixture, each carrying the same per-row marker the
    // managed list carries — plus the one in the section lede.
    const rows = within(env).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.querySelector('.cred-ro')?.textContent).toBe('read-only');
    }
  });
});
