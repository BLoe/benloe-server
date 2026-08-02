import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type {
  CredentialMeta, CredentialSlot, CredentialsView, EnvVarReport, SettingView,
} from '../src/lib/contracts.js';

const { credentialsMock, saveMock, deleteMock, settingsMock, saveSettingMock, revertSettingMock } = vi.hoisted(() => ({
  credentialsMock: vi.fn<() => Promise<CredentialsView>>(),
  saveMock: vi.fn(),
  deleteMock: vi.fn(),
  settingsMock: vi.fn<() => Promise<{ settings: SettingView[] }>>(),
  saveSettingMock: vi.fn<(key: string, value: string) => Promise<{ setting: SettingView }>>(),
  revertSettingMock: vi.fn<(key: string) => Promise<{ setting: SettingView }>>(),
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
      settings: settingsMock,
      saveSetting: saveSettingMock,
      revertSetting: revertSettingMock,
    },
  };
});

import userEvent from '@testing-library/user-event';
// ApiError is deliberately NOT mocked: the surface's error handling keys off
// the real class, so the tests throw the real thing.
import { ApiError } from '../src/lib/client.js';
import { Credentials, fmtAgo, fmtWhen, normalizeStamp } from '../src/surfaces/Credentials.js';

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
  // Non-secret config, still set in .env, and SUPERSEDED: the `plaid.env`
  // setting outranks it now. The value it carries still renders — you have to
  // be able to read the line that is being ignored — but the row must not read
  // as the answer to "what is Plaid pointed at?".
  {
    name: 'PLAID_ENV', label: 'Plaid environment',
    description: "'sandbox' for fake test banks, 'production' for real ones.",
    reason: 'Superseded by the Plaid environment setting, which takes precedence over this variable.',
    set: true, required: false, scrubbed: false, value: 'sandbox', supersededBy: 'plaid.env',
  },
  // The master key: presence only, forever.
  {
    name: 'CABINET_CRED_KEY', label: 'Credential encryption key',
    description: 'The AES-256 key that encrypts everything on this page.',
    reason: 'The bootstrap secret — it lives in root-owned /srv/benloe/.env.',
    set: true, required: true, scrubbed: true, value: null, supersededBy: null,
  },
  // Required AND missing — the one env row that has earned a warning.
  {
    name: 'CABINET_PUBLIC_ORIGIN', label: 'Public origin',
    description: 'Base URL used to build the Plaid OAuth redirect and webhook URLs.',
    reason: 'Read at boot to build URLs Plaid has already allow-listed.',
    set: false, required: true, scrubbed: false, value: null, supersededBy: null,
  },
  // Hostile fixture: a scrubbed entry that arrives WITH a value anyway. The
  // server can't produce this, but if a future one ever does, the page must
  // still refuse to render it. This row is the regression test for that.
  // Also optional — unset here is a feature that's off, not a fault.
  {
    name: 'GITHUB_APP_PRIVATE_KEY_B64', label: 'GitHub App private key',
    description: 'Scrubbed from the process environment at boot.',
    reason: 'Secret, and root-injected.',
    set: false, required: false, scrubbed: true, value: 'leak-me-please', supersededBy: null,
  },
];

/* ---- settings: the editable half, fixtured across all three sources ----
   `plaid.env` is the case the section exists for — a stored value beating a
   live environment variable that says something else — and `public.origin` is
   the quiet one that merely reports where its value came from. */
const PLAID_ENV_SETTING: SettingView = {
  key: 'plaid.env', group: 'Plaid', label: 'Environment',
  description: "Which Plaid environment to call. 'sandbox' uses fake test banks; 'production' connects real accounts.",
  type: 'enum', options: ['sandbox', 'production'], default: 'sandbox', envVar: 'PLAID_ENV',
  value: 'production', source: 'db', updated_at: '2026-08-01 19:22:10', env_value: 'sandbox',
};

const ORIGIN_SETTING: SettingView = {
  key: 'public.origin', group: 'Plaid', label: 'Public origin',
  description: 'Base URL Cabinet is reachable at. Used to build the Plaid OAuth redirect and webhook URLs.',
  type: 'origin', default: 'https://cabinet.benloe.com', envVar: 'CABINET_PUBLIC_ORIGIN',
  value: 'https://cabinet.benloe.com', source: 'env', updated_at: null, env_value: 'https://cabinet.benloe.com',
};

const SETTINGS: SettingView[] = [PLAID_ENV_SETTING, ORIGIN_SETTING];

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
  for (const m of [credentialsMock, saveMock, deleteMock, settingsMock, saveSettingMock, revertSettingMock]) {
    m.mockReset();
  }
  credentialsMock.mockResolvedValue(view());
  saveMock.mockResolvedValue({ ok: true, created: true, credential: CLIENT_ID_META });
  deleteMock.mockResolvedValue({ ok: true, deleted: 'plaid-client-id' });
  settingsMock.mockResolvedValue({ settings: SETTINGS.map((s) => ({ ...s })) });
  saveSettingMock.mockResolvedValue({ setting: PLAID_ENV_SETTING });
  revertSettingMock.mockResolvedValue({ setting: PLAID_ENV_SETTING });
});
afterEach(cleanup);

const slotRow = (label: string) => screen.getByText(label).closest('li') as HTMLElement;
/** A settings row, found through its control's label rather than any stray copy. */
const settingRow = async (label: string) =>
  (await screen.findByLabelText(label)).closest('li') as HTMLElement;

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
    // Scoped to the slot: the Settings section further down has Save buttons
    // of its own, and a page-wide lookup would be a coin flip.
    await userEvent.click(within(slotRow('Secret')).getByRole('button', { name: 'Save' }));

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
    await userEvent.click(within(slotRow('Client ID')).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/managed automatically by an integration/)).toBeTruthy();
  });

  it('reads a 503 as a missing server key, not a generic failure', async () => {
    saveMock.mockRejectedValue(new ApiError(503, 'CABINET_CRED_KEY is not set'));
    render(<Credentials />);

    await screen.findByLabelText('Integrations');
    await userEvent.click(within(slotRow('Secret')).getByRole('button', { name: 'Set' }));
    await userEvent.type(screen.getByLabelText('Value for Secret'), 'abc');
    await userEvent.click(within(slotRow('Secret')).getByRole('button', { name: 'Save' }));

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
    const env = await screen.findByLabelText('Environment variables');

    // Read-only, and it says so, with the restart caveat.
    expect(env.textContent).toContain('read-only');
    expect(env.textContent).toMatch(/restart/i);

    // Config var: value present, so it's on screen — being superseded doesn't
    // hide what the ignored line says, it just stops it reading as the answer.
    const plaidEnv = within(env).getByText('PLAID_ENV').closest('li') as HTMLElement;
    expect(plaidEnv.querySelector('.cred-env-val')?.textContent).toBe('sandbox');

    // Master key: no value sent, none invented, and the "why not here" line
    // every un-superseded row carries.
    const key = within(env).getByText('CABINET_CRED_KEY').closest('li') as HTMLElement;
    expect(key.querySelector('.cred-env-val')).toBeNull();
    expect(key.textContent).toContain('not shown');
    expect(key.textContent).toContain('The bootstrap secret — it lives in root-owned /srv/benloe/.env.');
    expect(within(key).getByText('Set')).toBeTruthy();

    // Hostile payload: scrubbed AND carrying a value. Still never rendered.
    const github = within(env).getByText('GITHUB_APP_PRIVATE_KEY_B64').closest('li') as HTMLElement;
    expect(github.querySelector('.cred-env-val')).toBeNull();
    expect(document.body.textContent).not.toContain('leak-me-please');
    expect(within(github).getByText('Not set')).toBeTruthy();
  });

  it('warns about an unset env var only when it is required', async () => {
    render(<Credentials />);
    const env = await screen.findByLabelText('Environment variables');

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
    const env = await screen.findByLabelText('Environment variables');

    // Four rows in the fixture, each carrying the same per-row marker the
    // managed list carries — plus the one in the section lede.
    const rows = within(env).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.querySelector('.cred-ro')?.textContent).toBe('read-only');
    }
  });

  it('demotes a superseded environment variable instead of letting it look authoritative', async () => {
    render(<Credentials />);
    const env = await screen.findByLabelText('Environment variables');

    const plaidEnv = within(env).getByText('PLAID_ENV').closest('li') as HTMLElement;
    expect(plaidEnv.className).toContain('is-superseded');
    expect((plaidEnv.querySelector('.cred-pill') as HTMLElement).textContent).toBe('Superseded');
    // Named, and answered: which setting won, and what it currently says. The
    // row's own value ('sandbox') is still readable, but the value in force
    // ('production') is on the row too, so the two can't be confused.
    expect(plaidEnv.textContent).toContain('Plaid · Environment');
    expect(plaidEnv.textContent).toContain('takes precedence over this variable');
    expect(plaidEnv.querySelector('.cred-env-superseded')?.textContent).toContain('production');

    // An un-superseded row is untouched: no dimming, and the ordinary pill.
    const key = within(env).getByText('CABINET_CRED_KEY').closest('li') as HTMLElement;
    expect(key.className).not.toContain('is-superseded');
    expect(key.textContent).not.toContain('Superseded');
  });
});

/* ============================================================================
   Settings — the editable, plaintext half of the same page.

   Every test below is about ONE question: which value is in force, and where
   did it come from. That is the only thing this section can get wrong in a way
   that costs anything, because every other failure is visible immediately and
   this one is invisible until a redirect URI stops matching.
   ========================================================================== */
describe('Settings section', () => {
  it('formats a store stamp as a readable absolute datetime', () => {
    // Timezone-agnostic on purpose: the runner's zone isn't pinned, so this
    // asserts the SHAPE (absolute, readable, no raw ISO punctuation) rather
    // than a wall-clock string that would only pass in one country.
    const out = fmtWhen('2026-08-01 19:22:10');
    expect(out).toContain('2026');
    expect(out).toMatch(/Jul|Aug/);
    expect(out).not.toContain('T');
    expect(out).not.toContain('Z');
    expect(fmtWhen(null)).toBe('never');
    expect(fmtWhen('not a date')).toBe('not a date');
  });

  it('groups settings under their integration and names the source of each value', async () => {
    render(<Credentials />);
    const settings = await screen.findByLabelText('Settings');

    // One heading, shared with the credential slots for the same integration.
    expect(within(settings).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Plaid']);

    const env = (await settingRow('Environment')) as HTMLElement;
    expect((env.querySelector('.cred-pill') as HTMLElement).textContent).toBe('Set here · overriding');
    const origin = (await settingRow('Public origin')) as HTMLElement;
    expect((origin.querySelector('.cred-pill') as HTMLElement).textContent).toBe('From CABINET_PUBLIC_ORIGIN');

    // The control matches the type: closed choice → select, free text → input.
    expect((within(env).getByLabelText('Environment') as HTMLSelectElement).tagName).toBe('SELECT');
    expect((within(origin).getByLabelText('Public origin') as HTMLInputElement).type).toBe('text');
  });

  it('says plainly that a stored value is overriding a live environment variable', async () => {
    render(<Credentials />);
    const row = await settingRow('Environment');

    // The whole point: the variable is named, ITS value is quoted, and the row
    // says which one is actually being used. A reader who knows PLAID_ENV says
    // 'sandbox' must not be able to leave this row thinking Plaid is in sandbox.
    const note = row.querySelector('.cred-set-note.override') as HTMLElement;
    expect(note).toBeTruthy();
    expect(note.textContent).toContain('Overriding');
    expect(note.textContent).toContain('PLAID_ENV');
    expect(note.textContent).toContain('sandbox');
    expect(note.textContent).toMatch(/being ignored/);
    expect((within(row).getByLabelText('Environment') as HTMLSelectElement).value).toBe('production');
    // …and the row carries the brass edge, so it's findable without reading.
    expect(row.className).toContain('is-overriding');
  });

  it('tells a value that came from the environment that editing here will outrank it', async () => {
    render(<Credentials />);
    const row = await settingRow('Public origin');

    const note = row.querySelector('.cred-set-note') as HTMLElement;
    expect(note.textContent).toContain('CABINET_PUBLIC_ORIGIN');
    expect(note.textContent).toMatch(/comes from/);
    expect(note.textContent).toMatch(/outranks it/);
    expect(note.className).not.toContain('override');
  });

  it('renders a 409 inline at the control that produced it, not as a page banner', async () => {
    const blocked =
      "Cannot switch to 'sandbox' while 2 account connections are linked — their access tokens only work in the " +
      'environment that issued them. Unlink first, then switch.';
    saveSettingMock.mockRejectedValue(new ApiError(409, blocked));
    render(<Credentials />);

    const row = await settingRow('Environment');
    await userEvent.selectOptions(within(row).getByLabelText('Environment'), 'sandbox');

    await waitFor(() => expect(saveSettingMock).toHaveBeenCalledWith('plaid.env', 'sandbox'));
    // Verbatim, and INSIDE the setting's own row — the server wrote this for
    // Ben, and it only means anything next to the selector he just moved.
    const err = await within(row).findByText(blocked);
    expect(err.closest('li')).toBe(row);
    // Not promoted to the page-level alert slot, which belongs to the missing
    // encryption key and would bury this one under a different subject.
    expect(screen.queryByRole('alert')).toBeNull();

    // The refused choice does not sit in the control looking chosen.
    expect((within(row).getByLabelText('Environment') as HTMLSelectElement).value).toBe('production');
  });

  it('offers the revert action only for a value that is actually stored here', async () => {
    render(<Credentials />);

    // source 'db', with an environment value underneath it to fall back to.
    const stored = await settingRow('Environment');
    expect(within(stored).getByRole('button', { name: 'Stop overriding' })).toBeTruthy();
    expect(stored.textContent).toContain('stored');

    // source 'env' — there is no override to stop, so no button and no stamp.
    const fromEnv = await settingRow('Public origin');
    expect(within(fromEnv).queryByRole('button', { name: /stop overriding|revert/i })).toBeNull();
  });

  it('reads "Revert to default" when there is no environment variable to fall back to', async () => {
    settingsMock.mockResolvedValue({
      settings: [{ ...PLAID_ENV_SETTING, envVar: undefined, env_value: null }],
    });
    render(<Credentials />);

    const row = await settingRow('Environment');
    expect(within(row).getByRole('button', { name: 'Revert to default' })).toBeTruthy();
    // And it names what it would fall back to, rather than just promising one.
    expect(row.textContent).toContain('sandbox');
  });

  it('reverting hands the value back to the environment and re-renders from the echo', async () => {
    revertSettingMock.mockResolvedValue({
      setting: { ...PLAID_ENV_SETTING, value: 'sandbox', source: 'env', updated_at: null },
    });
    render(<Credentials />);

    const row = await settingRow('Environment');
    await userEvent.click(within(row).getByRole('button', { name: 'Stop overriding' }));

    await waitFor(() => expect(revertSettingMock).toHaveBeenCalledWith('plaid.env'));
    await waitFor(() =>
      expect((row.querySelector('.cred-pill') as HTMLElement).textContent).toBe('From PLAID_ENV'),
    );
    expect(within(row).queryByRole('button', { name: 'Stop overriding' })).toBeNull();
    expect(row.querySelector('.cred-set-note.override')).toBeNull();
  });

  it('shows what the server stored, not what was typed', async () => {
    // The server normalises — a trailing slash comes off an origin — and the
    // difference is exactly what would otherwise be found out a week later by
    // an OAuth redirect that doesn't match.
    saveSettingMock.mockResolvedValue({
      setting: {
        ...ORIGIN_SETTING, value: 'https://cabinet.example.com', source: 'db',
        updated_at: '2026-08-02 07:15:00',
      },
    });
    render(<Credentials />);

    const row = await settingRow('Public origin');
    const input = within(row).getByLabelText('Public origin') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'https://cabinet.example.com/');
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveSettingMock).toHaveBeenCalledWith('public.origin', 'https://cabinet.example.com/'));
    // The echo replaces the draft — the slash is gone from the field itself,
    // not merely reported as gone somewhere else on the row.
    await waitFor(() => expect(input.value).toBe('https://cabinet.example.com'));
    // …and the save moved the row's source: it is now stored here, and beating
    // the CABINET_PUBLIC_ORIGIN it used to simply report.
    expect((row.querySelector('.cred-pill') as HTMLElement).textContent).toBe('Set here · overriding');
    expect(row.querySelector('.cred-set-note.override')?.textContent).toContain('https://cabinet.benloe.com');
  });

  it('keeps Save inert until the field actually differs, and shows a pending state while it saves', async () => {
    let release: (v: { setting: SettingView }) => void = () => {};
    saveSettingMock.mockReturnValue(new Promise((res) => { release = res; }));
    render(<Credentials />);

    const row = await settingRow('Public origin');
    const input = within(row).getByLabelText('Public origin') as HTMLInputElement;
    const save = () => within(row).getByRole('button', { name: /save|saving/i }) as HTMLButtonElement;

    // Unchanged: a Save that does nothing would still read as a change made.
    expect(save().disabled).toBe(true);
    await userEvent.type(input, '/health');
    expect(save().disabled).toBe(false);

    await userEvent.click(save());
    await waitFor(() => expect(save().textContent).toBe('Saving…'));
    expect(input.disabled).toBe(true);

    release({ setting: { ...ORIGIN_SETTING, value: 'https://cabinet.benloe.com', source: 'db', updated_at: '2026-08-02 07:15:00' } });
    await waitFor(() => expect(save().disabled).toBe(true));
  });

  it('keeps a rejected free-text value in the field so the typo can be fixed', async () => {
    saveSettingMock.mockRejectedValue(new ApiError(400, 'Public origin must be a full URL, e.g. https://cabinet.benloe.com'));
    render(<Credentials />);

    const row = await settingRow('Public origin');
    const input = within(row).getByLabelText('Public origin') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'cabinet.benloe.com');
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }));

    // The server's own words, verbatim, and the bad value still there to edit.
    expect(await within(row).findByText(/must be a full URL/)).toBeTruthy();
    expect(input.value).toBe('cabinet.benloe.com');
  });

  it('loses only the settings section when the settings endpoint is down', async () => {
    settingsMock.mockRejectedValue(new Error('settings unavailable'));
    render(<Credentials />);

    // The key cabinet still renders — two endpoints, two failure domains.
    expect(await screen.findByLabelText('Integrations')).toBeTruthy();
    const settings = screen.getByLabelText('Settings');
    expect(within(settings).getByText('settings unavailable')).toBeTruthy();
    expect(within(settings).queryByRole('combobox')).toBeNull();
  });
});
