/**
 * A top-down view of the field with the ten fielders in place.
 *
 * This is the piece the whole app is built around: step through the innings and
 * the fielders slide to their new spots, so who moves and who stays put is
 * something you see rather than something you read off a table. It also puts
 * the two odd positions on display — the striker crowding third, and the roamer
 * shaded well off right-center — which no list of names can show.
 */

export interface FieldSpot {
  key: string;
  code: string;
  name: string;
  alias: string | null;
  zone: string;
  x: number;
  y: number;
  playerName: string | null;
}

interface Props {
  spots: FieldSpot[];
  /** Highlighted position key, for hover and focus coordination. */
  activeKey?: string | null;
  onSelect?: (key: string) => void;
  className?: string;
}

/** "Danielle Rodriguez" becomes "Danielle R." so the puck labels stay legible. */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function FieldDiagram({ spots, activeKey, onSelect, className }: Props) {
  return (
    <svg
      viewBox="0 0 100 104"
      // An SVG with a viewBox carries an intrinsic aspect ratio, so under
      // min-content sizing its width is derived from its height and it will
      // happily force a grid column open. Pinning the box and letting the
      // height follow keeps it a passenger in the layout rather than a driver.
      className={`block h-auto w-full max-w-full ${className ?? ''}`}
      role="img"
      aria-label="Field diagram showing all ten defensive positions"
    >
      <defs>
        <radialGradient id="dirt-wash" cx="50%" cy="88%" r="78%">
          <stop offset="0%" stopColor="#c39a74" />
          <stop offset="55%" stopColor="#a67c58" />
          <stop offset="100%" stopColor="#7d5c40" />
        </radialGradient>
        <linearGradient id="grass-wash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2f6b46" />
          <stop offset="100%" stopColor="#3d7d53" />
        </linearGradient>
      </defs>

      {/* Fair territory. Central Park ballfields are packed dirt, with just
          enough grass out back to tell the outfield apart. */}
      <path
        d="M 50 96 L 0 46 L 0 21.2 A 90 90 0 0 1 100 21.2 L 100 46 Z"
        fill="url(#grass-wash)"
      />
      <path
        d="M 50 96 L 0 46 L 0 30 A 74 74 0 0 1 100 30 L 100 46 Z"
        fill="url(#dirt-wash)"
        opacity="0.96"
      />

      {/* Infield diamond, drawn a little wider than the basepaths. */}
      <path
        d="M 50 99 L 79 62 L 50 30 L 21 62 Z"
        fill="#b98d66"
        opacity="0.55"
      />

      {/* Chalk. */}
      <g stroke="#f2efe4" strokeOpacity="0.62" strokeWidth="0.7" fill="none" strokeLinecap="round">
        <path d="M 50 96 L 4 50" />
        <path d="M 50 96 L 96 50" />
        <path d="M 50 96 L 73 63 L 50 37 L 27 63 Z" strokeOpacity="0.5" />
      </g>

      {/* Bases and the pitching strip. */}
      <g fill="#f4f1e8">
        <rect x="71.2" y="61.2" width="3.6" height="3.6" transform="rotate(45 73 63)" />
        <rect x="48.2" y="35.2" width="3.6" height="3.6" transform="rotate(45 50 37)" />
        <rect x="25.2" y="61.2" width="3.6" height="3.6" transform="rotate(45 27 63)" />
        <path d="M 47.6 94.4 L 52.4 94.4 L 52.4 96.4 L 50 98.4 L 47.6 96.4 Z" />
        <rect x="45.5" y="62.4" width="9" height="1.5" rx="0.6" opacity="0.85" />
      </g>

      {spots.map((spot) => {
        const isActive = activeKey === spot.key;
        const isSpecialist = Boolean(spot.alias);
        return (
          <g
            key={spot.key}
            style={{
              transform: `translate(${spot.x * 100}px, ${spot.y * 100}px)`,
              transition: 'transform 620ms cubic-bezier(0.34, 1.2, 0.42, 1)',
              cursor: onSelect ? 'pointer' : 'default',
            }}
            onClick={onSelect ? () => onSelect(spot.key) : undefined}
          >
            <circle
              r={isActive ? 7.2 : 6.2}
              fill={isSpecialist ? '#d8412f' : '#12241b'}
              stroke={isActive ? '#e9a83c' : '#f4f1e8'}
              strokeWidth={isActive ? 1.4 : 0.9}
              style={{ transition: 'r 200ms ease, stroke 200ms ease' }}
            />
            <text
              y="1.6"
              textAnchor="middle"
              fill="#f4f1e8"
              fontSize="4.2"
              fontFamily="'IBM Plex Mono', monospace"
              fontWeight="600"
              style={{ pointerEvents: 'none' }}
            >
              {spot.code}
            </text>
            {spot.playerName && (
              <text
                // The catcher sits right on the bottom edge, so their name goes
                // above the marker instead of off the canvas.
                y={spot.y > 0.85 ? -9 : 11.4}
                textAnchor="middle"
                fill="#f7f4ec"
                fontSize="3.5"
                fontFamily="'Instrument Sans', sans-serif"
                fontWeight="600"
                style={{ pointerEvents: 'none', paintOrder: 'stroke' }}
                stroke="#12241b"
                strokeWidth="1.1"
                strokeOpacity="0.65"
              >
                {shortName(spot.playerName)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
