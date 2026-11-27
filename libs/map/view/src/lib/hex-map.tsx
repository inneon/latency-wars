import type { Hex } from '@latency-wars/domain';
import { createContext, type KeyboardEvent, type ReactNode, useContext, useId, useMemo } from 'react';
import { discBounds, discHexes, hexCenter, hexCorners, type MapUnit, mergeSegments, type Point, type Segment, stackTokens, type Token } from './layout';

/** A hex's corner-to-centre distance, in the drawing's own units. The drawing scales to its container. */
const SIZE = 10;

/**
 * Colours, each a CSS custom property a page can set on or above the map,
 * with the built-in value as the fallback.
 */
const THEME = {
  space: 'var(--lw-map-space, #131a2c)',
  grid: 'var(--lw-map-grid, #33416b)',
  ink: 'var(--lw-map-ink, #e6e9f2)',
  faint: 'var(--lw-map-faint, #7c88a8)',
  star: 'var(--lw-map-star, #f4b942)',
  zone: 'var(--lw-map-zone, #4fb8a8)',
  planet: 'var(--lw-map-planet, #cdbb8f)',
};
const OWNER_COLOURS = ['#5aa9ff', '#ff6b5e', '#f2c14e', '#7bd88f'];
const UNKNOWN_OWNER = '#9aa3b8';

/** A colour for each owner, in the order given: the first is blue and the second red. */
export function ownerColours(owners: readonly string[]): Record<string, string> {
  return Object.fromEntries(owners.map((owner, i) => [owner, OWNER_COLOURS[i % OWNER_COLOURS.length] ?? UNKNOWN_OWNER]));
}

const STYLES = `
.lw-map { display: block; width: 100%; height: auto; font-family: system-ui, sans-serif; font-variant-numeric: tabular-nums; user-select: none; }
.lw-map [role="button"] { cursor: pointer; outline: none; }
.lw-map [role="button"]:focus-visible .lw-focus { stroke: ${THEME.ink}; stroke-width: 0.8; }
.lw-map .lw-hex.lw-clickable { cursor: pointer; }
.lw-map .lw-hex.lw-clickable:hover { fill: ${THEME.grid}; fill-opacity: 0.45; }
`;

interface MapContext {
  colour: (owner: string) => string;
  owners: readonly string[];
  select?: (hex: Hex) => void;
}
const Context = createContext<MapContext | null>(null);

function useMap(): MapContext {
  const map = useContext(Context);
  if (!map) throw new Error('Map layers must be drawn inside a <HexMap>.');
  return map;
}

const points = (corners: readonly Point[]) => corners.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
const at = (hex: Hex, offset: Point = { x: 0, y: 0 }): Point => {
  const c = hexCenter(hex, SIZE);
  return { x: c.x + offset.x * SIZE, y: c.y + offset.y * SIZE };
};
const written = (h: Hex) => `(${h.q}, ${h.r})`;

/** A feature's name as it is written in its hex: on two lines once it is too long for one. */
function labelLines(name: string): string[] {
  const words = name.split(' ');
  if (name.length <= 12 || words.length === 1) return [name];
  let best = 1;
  for (let i = 1; i < words.length; i++) {
    const lopsided = (at: number) => Math.abs(words.slice(0, at).join(' ').length - words.slice(at).join(' ').length);
    if (lopsided(i) < lopsided(best)) best = i;
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

export interface MapFeature {
  readonly name: string;
  readonly kind: 'zone' | 'planet';
  readonly hex: Hex;
}

export interface HexMapProps {
  /** The disc's radius in hexes (SPACE-01). The star is at its centre. */
  radius: number;
  /** Hexes nothing can enter, other than the star's. */
  impassable?: readonly Hex[];
  features?: readonly MapFeature[];
  /** The owners in the order to draw them, each with its colour (see `ownerColours`). An owner left out is drawn grey. */
  colours?: Readonly<Record<string, string>>;
  /** Write each hex's coordinates in it (SPACE-05). */
  coordinates?: boolean;
  selected?: Hex;
  /** Called with a hex when it, or a marker in it, is chosen. */
  onSelect?: (hex: Hex) => void;
  /** What the map shows, for someone who can't see it. */
  label: string;
  /** The layers to draw over the grid, bottom first. */
  children?: ReactNode;
}

/** A star system's hex grid. Everything on it is a layer passed as a child. */
export function HexMap({ radius, impassable = [], features = [], colours = {}, coordinates = false, selected, onSelect, label, children }: HexMapProps) {
  const hexes = useMemo(() => discHexes(radius), [radius]);
  const box = discBounds(radius, SIZE);
  const pad = SIZE * 0.6;
  const context = useMemo<MapContext>(() => {
    const owners = Object.keys(colours);
    return {
      owners,
      colour: (owner) => colours[owner] ?? UNKNOWN_OWNER,
      select: onSelect,
    };
  }, [colours, onSelect]);
  const star = at({ q: 0, r: 0 });
  const glow = `lw-star-glow-${useId()}`;

  return (
    <svg
      className="lw-map"
      viewBox={`${box.x - pad} ${box.y - pad} ${box.width + 2 * pad} ${box.height + 2 * pad}`}
      role="group"
      aria-label={label}
    >
      <style>{STYLES}</style>
      <defs>
        <radialGradient id={glow}>
          <stop offset="0" style={{ stopColor: THEME.star, stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: THEME.star, stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <rect className="lw-backdrop" x={box.x - pad} y={box.y - pad} width={box.width + 2 * pad} height={box.height + 2 * pad} rx={SIZE * 0.8} style={{ fill: THEME.space }} />

      <g>
        {hexes.map((h) => (
          <polygon
            key={`${h.q},${h.r}`}
            className={onSelect ? 'lw-hex lw-clickable' : 'lw-hex'}
            data-hex={`${h.q},${h.r}`}
            points={points(hexCorners(h, SIZE))}
            style={{ fill: 'transparent', stroke: THEME.grid, strokeWidth: 0.3 }}
            onClick={onSelect && (() => onSelect(h))}
          />
        ))}
      </g>

      <g pointerEvents="none">
        {impassable
          .filter((h) => h.q !== 0 || h.r !== 0)
          .map((h) => (
            <polygon key={`${h.q},${h.r}`} points={points(hexCorners(h, SIZE, 0.92))} style={{ fill: THEME.grid }} />
          ))}
        <circle cx={star.x} cy={star.y} r={SIZE * 1.5} fill={`url(#${glow})`} />
        <circle cx={star.x} cy={star.y} r={SIZE * 0.42} style={{ fill: THEME.star }} />

        {features.map((f) => {
          const c = at(f.hex);
          const tint = f.kind === 'planet' ? THEME.planet : THEME.zone;
          return (
            <g key={`${f.kind}:${f.name}`}>
              <polygon
                points={points(hexCorners(f.hex, SIZE, 0.9))}
                style={{ fill: tint, fillOpacity: 0.1, stroke: tint, strokeWidth: 0.35, strokeDasharray: f.kind === 'zone' ? '1 1' : undefined }}
              />
              {f.kind === 'planet' && <circle cx={c.x} cy={c.y} r={SIZE * 0.3} style={{ fill: tint, fillOpacity: 0.55 }} />}
              {labelLines(f.name).map((line, i, lines) => (
                <text
                  key={line}
                  x={c.x}
                  y={c.y - SIZE * (0.44 + 0.21 * (lines.length - 1 - i))}
                  textAnchor="middle"
                  style={{ fill: tint, fontSize: SIZE * 0.19, stroke: THEME.space, strokeWidth: 0.5, paintOrder: 'stroke' }}
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}

        {coordinates &&
          hexes.map((h) => {
            const c = at(h);
            return (
              <text key={`${h.q},${h.r}`} x={c.x} y={c.y + SIZE * 0.8} textAnchor="middle" style={{ fill: THEME.faint, fontSize: SIZE * 0.2, opacity: 0.7 }}>
                {h.q},{h.r}
              </text>
            );
          })}
      </g>

      <Context.Provider value={context}>{children}</Context.Provider>

      {selected && (
        <polygon
          data-selected={`${selected.q},${selected.r}`}
          points={points(hexCorners(selected, SIZE, 0.94))}
          pointerEvents="none"
          style={{ fill: 'none', stroke: THEME.ink, strokeWidth: 0.7 }}
        />
      )}
    </svg>
  );
}

export interface CoverageProps {
  /** The hexes each owner's sensors reach. */
  areas: readonly { owner: string; hexes: readonly Hex[] }[];
}

/** Tints the hexes inside each owner's sensor range. Where two owners overlap, so do the tints. */
export function Coverage({ areas }: CoverageProps) {
  const { colour } = useMap();
  return (
    <g pointerEvents="none">
      {areas.flatMap(({ owner, hexes }) =>
        hexes.map((h) => (
          <polygon key={`${owner}:${h.q},${h.r}`} data-coverage={owner} points={points(hexCorners(h, SIZE))} style={{ fill: colour(owner), fillOpacity: 0.12 }} />
        )),
      )}
    </g>
  );
}

export interface LinksProps {
  /** Lines between pairs of hexes, such as a web's links. A heavier `weight` (0 to 1) draws thicker. */
  links: readonly (Segment & { weight?: number })[];
}

export function Links({ links }: LinksProps) {
  const { colour } = useMap();
  return (
    <g pointerEvents="none">
      {links.map((l, i) => {
        const a = at(l.from);
        const b = at(l.to);
        return (
          <line
            key={i}
            data-link={l.owner}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            style={{ stroke: colour(l.owner), strokeWidth: 0.25 + 0.5 * (l.weight ?? 0), strokeOpacity: 0.4, strokeDasharray: '0.5 1.5', strokeLinecap: 'round' }}
          />
        );
      })}
    </g>
  );
}

export interface MovesProps {
  /** Where units went this turn. Units that made the same move share an arrow. */
  moves: readonly Segment[];
}

/** An arrow per move, drawn straight from where the units began to where they ended. */
export function Moves({ moves }: MovesProps) {
  const { colour } = useMap();
  return (
    <g pointerEvents="none">
      {mergeSegments(moves).map((m) => {
        const a = at(m.from);
        const b = at(m.to);
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length === 0) return null;
        const ux = (b.x - a.x) / length;
        const uy = (b.y - a.y) / length;
        // Keep clear of the markers at both ends, and a little to the right, so opposing moves don't hide each other.
        const side = SIZE * 0.14;
        const start = { x: a.x + ux * SIZE * 0.45 - uy * side, y: a.y + uy * SIZE * 0.45 + ux * side };
        const tip = { x: b.x - ux * SIZE * 0.56 - uy * side, y: b.y - uy * SIZE * 0.56 + ux * side };
        const head = SIZE * 0.34;
        const base = { x: tip.x - ux * head, y: tip.y - uy * head };
        const wing = head * 0.5;
        const width = 0.55 + 0.25 * Math.min(m.count - 1, 4);
        return (
          <g key={`${m.owner}:${m.from.q},${m.from.r}>${m.to.q},${m.to.r}`} data-move={m.owner} style={{ opacity: 0.9 }}>
            <line x1={start.x} y1={start.y} x2={base.x} y2={base.y} style={{ stroke: colour(m.owner), strokeWidth: width, strokeLinecap: 'round' }} />
            <polygon
              points={points([tip, { x: base.x - uy * wing, y: base.y + ux * wing }, { x: base.x + uy * wing, y: base.y - ux * wing }])}
              style={{ fill: colour(m.owner) }}
            />
          </g>
        );
      })}
    </g>
  );
}

export interface LossesProps {
  /** Units that left the map this turn, where they were last. */
  losses: readonly { owner: string; hex: Hex }[];
}

/** A cross where each owner lost units, with how many if more than one. */
export function Losses({ losses }: LossesProps) {
  const { colour, owners } = useMap();
  const merged = mergeSegments(losses.map((l) => ({ owner: l.owner, from: l.hex, to: l.hex })));
  return (
    <g pointerEvents="none">
      {merged.map((l) => {
        const side = owners.indexOf(l.owner) === 1 ? 1 : -1;
        const c = at(l.from, { x: 0.5 * side, y: 0.42 });
        const arm = SIZE * 0.17;
        return (
          <g key={`${l.owner}:${l.from.q},${l.from.r}`} data-loss={l.owner} style={{ stroke: colour(l.owner), strokeWidth: 0.7, strokeLinecap: 'round' }}>
            <line x1={c.x - arm} y1={c.y - arm} x2={c.x + arm} y2={c.y + arm} />
            <line x1={c.x - arm} y1={c.y + arm} x2={c.x + arm} y2={c.y - arm} />
            {l.count > 1 && (
              <text x={c.x + arm * 1.5} y={c.y + arm} style={{ fill: colour(l.owner), stroke: 'none', fontSize: SIZE * 0.26 }}>
                {l.count}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function tokenShape(token: Token, c: Point, fill: string, rim?: string) {
  // A held unit is drawn in its holder's colour, rimmed in its owner's.
  const edge = rim ? { fill, stroke: rim, strokeWidth: 0.9 } : { fill, stroke: THEME.space, strokeWidth: 0.35 };
  switch (token.shape) {
    case 'flagship': {
      const d = SIZE * 0.5;
      return <polygon className="lw-focus" points={points([{ x: c.x, y: c.y - d }, { x: c.x + d, y: c.y }, { x: c.x, y: c.y + d }, { x: c.x - d, y: c.y }])} style={edge} />;
    }
    case 'scout': {
      const d = SIZE * 0.3;
      return <polygon className="lw-focus" points={points([{ x: c.x, y: c.y - d }, { x: c.x + d, y: c.y + d * 0.8 }, { x: c.x - d, y: c.y + d * 0.8 }])} style={edge} />;
    }
    case 'mine': {
      const d = SIZE * 0.28;
      const hexagon = [0, 1, 2, 3, 4, 5].map((i) => ({ x: c.x + d * Math.cos((Math.PI / 3) * i), y: c.y + d * Math.sin((Math.PI / 3) * i) }));
      return <polygon className="lw-focus" points={points(hexagon)} style={edge} />;
    }
    case 'node': {
      const d = SIZE * 0.22;
      return <rect className="lw-focus" x={c.x - d} y={c.y - d} width={2 * d} height={2 * d} rx={d * 0.25} style={edge} />;
    }
    default:
      return <circle className="lw-focus" cx={c.x} cy={c.y} r={SIZE * 0.36} style={edge} />;
  }
}

const describe = (token: Token) => {
  const names = token.units.map((u) => u.name ?? u.id).join(', ');
  return `${token.owner}: ${names} at ${written(token.hex)}${token.heldBy ? `, under ${token.heldBy}'s command` : ''}`;
};

/** What became of a seize, as the map draws it. */
export type SeizeOutcome = 'landed' | 'partly' | 'blocked' | 'missed';

export interface MapSeize {
  /** The owner who sent it, whose colour it is drawn in. */
  readonly by: string;
  /** Where it was sent from. Without it, only its end is drawn. */
  readonly from?: Hex;
  /** Where it was aimed. */
  readonly to: Hex;
  /** Where the target really was, when that isn't `to`: a seize that missed. */
  readonly at?: Hex;
  readonly outcome: SeizeOutcome;
  /** A short note at its end, such as the strengths that decided it. */
  readonly label?: string;
}

/**
 * Seizes: a dotted curve from where each was sent to where it was aimed, in its sender's colour. It ends in a ring
 * where it landed, a bar where oversight blocked it, and an empty dashed ring where it missed, with a faint line on to
 * where the target really was.
 */
export function Seizes({ seizes }: { seizes: readonly MapSeize[] }) {
  const { colour } = useMap();
  return (
    <g pointerEvents="none">
      {seizes.map((s, i) => {
        const tint = colour(s.by);
        const end = at(s.to);
        const start = s.from ? at(s.from) : undefined;
        const length = start ? Math.hypot(end.x - start.x, end.y - start.y) : 0;
        const ux = start && length ? (end.x - start.x) / length : 0;
        const uy = start && length ? (end.y - start.y) / length : 0;
        // A blocked seize stops short of its target, at a bar; the others run to the ring around it.
        const stop = s.outcome === 'blocked' ? SIZE * 1.05 : SIZE * 0.72;
        const tip = start && length > stop ? { x: end.x - ux * stop, y: end.y - uy * stop } : end;
        const bow = Math.min(length * 0.18, SIZE * 1.2);
        const control = start ? { x: (start.x + tip.x) / 2 + uy * bow, y: (start.y + tip.y) / 2 - ux * bow } : end;
        const truth = s.at ? at(s.at) : undefined;
        return (
          <g key={i} data-seize={s.outcome} data-by={s.by}>
            {start && length > stop && (
              <path
                d={`M ${start.x.toFixed(2)} ${start.y.toFixed(2)} Q ${control.x.toFixed(2)} ${control.y.toFixed(2)} ${tip.x.toFixed(2)} ${tip.y.toFixed(2)}`}
                style={{ fill: 'none', stroke: tint, strokeWidth: 0.55, strokeDasharray: '0.1 1.1', strokeLinecap: 'round', opacity: s.outcome === 'missed' ? 0.7 : 1 }}
              />
            )}
            {(s.outcome === 'landed' || s.outcome === 'partly') && (
              <circle cx={end.x} cy={end.y} r={SIZE * 0.68} style={{ fill: 'none', stroke: tint, strokeWidth: 0.6 }} />
            )}
            {s.outcome === 'blocked' && (
              <line
                x1={tip.x - uy * SIZE * 0.32}
                y1={tip.y + ux * SIZE * 0.32}
                x2={tip.x + uy * SIZE * 0.32}
                y2={tip.y - ux * SIZE * 0.32}
                style={{ stroke: tint, strokeWidth: 0.9, strokeLinecap: 'round' }}
              />
            )}
            {s.outcome === 'missed' && (
              <>
                <circle cx={end.x} cy={end.y} r={SIZE * 0.5} style={{ fill: 'none', stroke: tint, strokeWidth: 0.45, strokeDasharray: '0.8 0.8' }} />
                {truth && <line x1={end.x} y1={end.y} x2={truth.x} y2={truth.y} style={{ stroke: tint, strokeWidth: 0.3, strokeDasharray: '0.4 0.8', opacity: 0.55 }} />}
              </>
            )}
            {s.label && (
              <text
                x={(s.outcome === 'blocked' ? tip : end).x}
                y={(s.outcome === 'blocked' ? tip : end).y - SIZE * 0.82}
                textAnchor="middle"
                style={{ fill: tint, fontSize: SIZE * 0.24, fontWeight: 600, stroke: THEME.space, strokeWidth: 0.5, paintOrder: 'stroke' }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Where a flagship's command stands: `shaken` (half a ring), `capturable` next turn (most of a ring), `captured` (a
 * double ring) or `lapsed` (a faint ring), in the colour of the owner who shook it.
 */
export interface CommandMark {
  readonly hex: Hex;
  readonly by: string;
  readonly stage: 'shaken' | 'capturable' | 'captured' | 'lapsed';
  readonly label?: string;
}

export function Command({ marks }: { marks: readonly CommandMark[] }) {
  const { colour } = useMap();
  const r = SIZE * 0.86;
  const round = 2 * Math.PI * r;
  return (
    <g pointerEvents="none">
      {marks.map((m, i) => {
        const c = at(m.hex);
        const tint = colour(m.by);
        const ring = (dash: string | undefined, opacity = 1, radius = r, width = 0.8) => (
          <circle cx={c.x} cy={c.y} r={radius} transform={`rotate(-90 ${c.x} ${c.y})`} style={{ fill: 'none', stroke: tint, strokeWidth: width, strokeDasharray: dash, opacity, strokeLinecap: 'round' }} />
        );
        return (
          <g key={i} data-command={m.stage} data-by={m.by}>
            {m.stage === 'shaken' && ring(`${(round / 2).toFixed(2)} ${(round / 2).toFixed(2)}`)}
            {m.stage === 'capturable' && ring(`${((round * 7) / 8).toFixed(2)} ${(round / 8).toFixed(2)}`, 1, r, 1)}
            {m.stage === 'lapsed' && ring('0.6 1.2', 0.45, r, 0.5)}
            {m.stage === 'captured' && (
              <>
                {ring(undefined, 1, r, 0.8)}
                {ring(undefined, 0.6, r + SIZE * 0.14, 0.4)}
              </>
            )}
            {m.label && (
              <text x={c.x} y={c.y + r + SIZE * 0.32} textAnchor="middle" style={{ fill: tint, fontSize: SIZE * 0.24, fontWeight: 600, stroke: THEME.space, strokeWidth: 0.5, paintOrder: 'stroke' }}>
                {m.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export interface UnitsProps {
  units: readonly MapUnit[];
}

/**
 * The units, one marker for each owner's fleets in a hex and one for their
 * nodes there. A marker shows its most important unit's shape, the strength
 * it adds up to and, when it stands for several units, how many.
 */
export function Units({ units }: UnitsProps) {
  const { colour, owners, select } = useMap();
  const tokens = useMemo(() => stackTokens(units, owners), [units, owners]);
  return (
    <g>
      {tokens.map((token) => {
        const c = at(token.hex, token.offset);
        const fill = colour(token.heldBy ?? token.owner);
        const rim = token.heldBy ? colour(token.owner) : undefined;
        const choose = select && (() => select(token.hex));
        const onKey = choose && ((e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), choose()));
        return (
          <g key={token.key} data-token={token.key} data-held-by={token.heldBy} role={choose ? 'button' : 'img'} tabIndex={choose ? 0 : undefined} aria-label={describe(token)} onClick={choose} onKeyDown={onKey}>
            <title>{describe(token)}</title>
            {token.sightedBy.map((observer, i) => (
              <circle key={observer} data-sighted-by={observer} cx={c.x} cy={c.y} r={SIZE * (0.6 + 0.09 * i)} style={{ fill: 'none', stroke: colour(observer), strokeWidth: 0.22, strokeOpacity: 0.85, strokeDasharray: '0.9 0.7' }} />
            ))}
            {tokenShape(token, c, fill, rim)}
            {token.shape !== 'node' && token.shape !== 'mine' && token.strength > 0 && (
              <text x={c.x} y={c.y + SIZE * 0.13} textAnchor="middle" style={{ fill: THEME.space, fontSize: SIZE * 0.36, fontWeight: 700 }}>
                {token.strength}
              </text>
            )}
            {token.units.length > 1 && (
              <g data-count={token.units.length}>
                <circle cx={c.x + SIZE * 0.36} cy={c.y - SIZE * 0.36} r={SIZE * 0.2} style={{ fill: THEME.ink, stroke: THEME.space, strokeWidth: 0.2 }} />
                <text x={c.x + SIZE * 0.36} y={c.y - SIZE * 0.27} textAnchor="middle" style={{ fill: THEME.space, fontSize: SIZE * 0.26, fontWeight: 700 }}>
                  {token.units.length}
                </text>
              </g>
            )}
            {token.joined && (
              <text data-joined x={c.x - SIZE * 0.44} y={c.y - SIZE * 0.22} textAnchor="middle" style={{ fill: THEME.ink, fontSize: SIZE * 0.4, fontWeight: 700 }}>
                +
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
