import { type Hex, hexEquals } from '@latency-wars/domain';
import { Command, type CommandMark, Coverage, HexMap, Links, Losses, type MapSeize, type MapUnit, Moves, ownerColours, Seizes, sensorCoverage, Units } from '@latency-wars/map-view';
import type { CommandStatus, Frame, PlayerTurnView, PlaytestUnit, Replay, RunSummary, SeizeView } from '@latency-wars/playtest-replay';
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { runStarted, useReplay, useRuns } from './replay-client';
import './replay.css';

const md = (text: string) => <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>;
const written = (h: Hex) => `(${h.q}, ${h.r})`;
const qbits = (n: number) => String(Math.round(n * 100) / 100);
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

type Layer = 'moves' | 'links' | 'seizes' | 'coordinates' | `sensors:${string}`;

/** A run's log hasn't changed for this long, and the game isn't over: the run has probably stopped. */
const STALLED_MS = 20 * 60_000;

/** What the page remembers in its address, so a reload or a shared link opens the same turn of the same run. */
function readAddress(): { run?: string; turn?: number; watch: boolean } {
  const params = new URLSearchParams(window.location.search);
  const turn = Number(params.get('turn'));
  return { run: params.get('run') ?? undefined, turn: params.has('turn') && Number.isInteger(turn) ? turn : undefined, watch: params.has('watch') };
}
const addressOf = (run: string, turn: number, watch: boolean) => `?${watch ? 'watch&' : ''}${new URLSearchParams({ run, turn: String(turn) })}`;
function writeAddress(run: string, turn: number, watch: boolean): void {
  window.history.replaceState(null, '', `${window.location.pathname}${addressOf(run, turn, watch)}`);
}

/** "Blue", "Blue and Red", "Blue, Red and Green". */
const listed = (names: readonly string[]) => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

type NameOf = (id: string) => string;

/** One line on where a flagship's shaken command stands (QBIT-13). */
function commandLine(c: CommandStatus, name: NameOf): string {
  const whose = `${name(c.owner)}'s flagship`;
  switch (c.stage) {
    case 'shaken':
      return `${name(c.by)} shook ${whose}. It can't be seized in turn ${c.shakenIn + 1}; ${name(c.by)} can capture it in turn ${c.shakenIn + 2}.`;
    case 'capturable':
      return `${name(c.by)} can capture ${whose} in turn ${c.shakenIn + 2}.`;
    case 'captured':
      return `${name(c.by)} captured ${whose}.`;
    case 'lapsed':
      return `${name(c.by)}'s hold on ${whose} lapsed: no capture landed in turn ${c.shakenIn + 2}.`;
  }
}

const OUTCOME_TAG: Record<SeizeView['outcome'], string> = {
  landed: 'landed',
  partly: 'landed',
  blocked: 'blocked',
  missed: 'missed',
  gone: 'target gone',
  refused: 'refused',
};

/** Where a game in progress stands, and whether its run seems to have stopped. Nothing once the game is over and written up. */
function LiveStatus({ replay }: { replay: Replay & { updatedAt?: number } }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const { progress, scenario } = replay;
  if (progress.stage === 'over') return null;

  const name = (id: string) => scenario.players.find((p) => p.id === id)?.name ?? id;
  const waiting = scenario.players.map((p) => p.id).filter((p) => !progress.submitted.includes(p));
  const turn = `Turn ${progress.turn}`;
  const text = {
    setup: 'The GM is setting up the game.',
    planning: progress.submitted.length
      ? `${turn}: ${listed(progress.submitted.map(name))} ${progress.submitted.length === 1 ? 'has' : 'have'} sent orders; waiting for ${listed(waiting.map(name))}.`
      : `${turn}: waiting for orders from ${listed(waiting.map(name))}.`,
    resolving: `${turn}: all orders are in, and the GM and engine are resolving the turn.`,
    debrief: 'The game is over. The players and GM are giving feedback.',
  }[progress.stage];
  const quiet = replay.updatedAt === undefined ? 0 : now - replay.updatedAt;
  const stalled = quiet > STALLED_MS;

  return (
    <p className="replay-live" data-stalled={stalled || undefined}>
      <span className="replay-live-dot" aria-hidden="true" />
      {text}
      {stalled && ` Nothing has been logged for ${Math.round(quiet / 60_000)} minutes, so the run may have stopped.`}
    </p>
  );
}

/** A button that puts the whole page in full screen, where the browser allows it. */
function FullScreenButton() {
  if (!document.fullscreenEnabled) return null;
  return (
    <button type="button" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}>
      Full screen
    </button>
  );
}

const shapeOf = (u: PlaytestUnit): MapUnit['shape'] => (u.class === 'fleet' ? (u.strength === 0 ? 'scout' : 'fleet') : u.class);

function RunPicker({ runs, run, onChoose }: { runs: RunSummary[]; run: string | undefined; onChoose: (id: string) => void }) {
  const readable = runs.filter((r) => r.readable);
  const unreadable = runs.filter((r) => !r.readable);
  return (
    <div className="replay-runs">
      {readable.length > 0 && (
        <label>
          Run{' '}
          <select value={run ?? ''} onChange={(e) => onChoose(e.target.value)}>
            {readable.map((r) => (
              <option key={r.id} value={r.id}>
                {runStarted(r.id)}: {r.title}, {r.turns} {r.turns === 1 ? 'turn' : 'turns'}
                {r.finished ? '' : ' so far'}
              </option>
            ))}
          </select>
        </label>
      )}
      {unreadable.length > 0 && (
        <details className="replay-unreadable">
          <summary>
            {unreadable.length} {unreadable.length === 1 ? "run can't" : "runs can't"} be shown
          </summary>
          <ul>
            {unreadable.map((r) => (
              <li key={r.id}>
                <code>{r.id}</code>: {r.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Timeline({ frames, index, onChoose }: { frames: Frame[]; index: number; onChoose: (index: number) => void }) {
  return (
    <nav className="replay-timeline" aria-label="Turns">
      <button type="button" onClick={() => onChoose(index - 1)} disabled={index === 0} aria-label="Previous turn">
        ‹
      </button>
      <ol>
        {frames.map((f, i) => {
          const shaken = f.command.some((c) => c.stage === 'shaken');
          const captured = f.command.some((c) => c.stage === 'captured');
          const foiled = f.seizes.some((s) => s.flagship && (s.outcome === 'blocked' || s.outcome === 'missed'));
          const notes = [
            f.removed.length ? `${f.removed.length} lost` : '',
            f.corrections.length ? 'engine corrected the GM' : '',
            shaken ? 'flagship shaken' : '',
            captured ? 'flagship captured' : '',
            foiled ? 'a seize on a flagship failed' : '',
            f.gameOver ? 'game over' : '',
          ].filter(Boolean);
          return (
            <li key={f.turn}>
              <button
                type="button"
                className="replay-turn"
                aria-current={i === index ? 'step' : undefined}
                aria-label={`${f.turn === 0 ? 'Start' : `Turn ${f.turn}`}${notes.length ? `: ${notes.join(', ')}` : ''}`}
                title={notes.join(', ') || undefined}
                onClick={() => onChoose(i)}
              >
                <span className="replay-turn-marks" aria-hidden="true">
                  {f.removed.length > 0 && <span className="replay-mark-loss">×</span>}
                  {f.corrections.length > 0 && <span className="replay-mark-fix">!</span>}
                  {captured ? <span className="replay-mark-command">◉</span> : shaken ? <span className="replay-mark-command">◐</span> : null}
                  {foiled && !captured && <span className="replay-mark-foiled">○</span>}
                </span>
                {f.turn}
              </button>
            </li>
          );
        })}
      </ol>
      <button type="button" onClick={() => onChoose(index + 1)} disabled={index === frames.length - 1} aria-label="Next turn">
        ›
      </button>
    </nav>
  );
}

function UnitLine({ unit, note }: { unit: PlaytestUnit; note?: string }) {
  return (
    <li>
      <strong>{unit.name}</strong> <code>{unit.id}</code>, strength {unit.strength}
      {note ? `, ${note}` : ''}
      {unit.status && <span className="replay-status">{unit.status}</span>}
    </li>
  );
}

function PlayerSection({ view, name, colour }: { view: PlayerTurnView; name: string; colour: string }) {
  const bought = view.scans.filter((s) => s.bought);
  // Seizes have a section of their own.
  const spoofs = view.spoofs.filter((s) => s.kind === 'spoof');
  return (
    <section className="replay-player" style={{ '--owner': colour } as CSSProperties}>
      <h3>{name}</h3>
      {view.qbits && (
        <p className="replay-qbits">
          qBits {qbits(view.qbits.opening)} → {qbits(view.qbits.closing)}: spent {qbits(view.qbits.spent)}, decay {qbits(view.qbits.decay)}, produced{' '}
          {qbits(view.qbits.production)}
        </p>
      )}
      {view.matter && (
        <p className="replay-qbits">
          Matter {qbits(view.matter.opening)} → {qbits(view.matter.closing)}: spent {qbits(view.matter.spent)}, mined {qbits(view.matter.production)} from{' '}
          {view.matter.mines} {view.matter.mines === 1 ? 'mine' : 'mines'}
        </p>
      )}
      {view.orders.length > 0 ? (
        <ul className="replay-orders">
          {view.orders.map((o, i) => (
            <li key={i}>
              <code>{o.unit}</code> {o.order}
              {o.delivery === 'instant' && <span className="replay-tag">instant</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="replay-quiet">No orders.</p>
      )}
      {(bought.length > 0 ||
        spoofs.length > 0 ||
        view.oversights.length > 0 ||
        (view.qbits?.refused.length ?? 0) > 0 ||
        (view.matter?.purchases.length ?? 0) > 0 ||
        (view.matter?.refused.length ?? 0) > 0) && (
        <ul className="replay-purchases">
          {bought.map((s, i) => (
            <li key={`scan${i}`}>
              Scan <code>{s.target}</code> ({qbits(s.cost)})
            </li>
          ))}
          {view.oversights.map((o, i) => (
            <li key={`oversee${i}`}>
              Oversight on <code>{o.target}</code>, strength {o.strength}
              {o.refused ? `: refused. ${o.refused}` : ` (${qbits(o.cost ?? 0)})`}
            </li>
          ))}
          {spoofs.map((s, i) => (
            <li key={`spoof${i}`}>
              Spoof <code>{s.target}</code> to {s.order}
              {s.refused ? `: refused. ${s.refused}` : ` (${qbits(s.cost ?? 0)})`}
              {s.reaches && s.reaches.length > 1 && `; reaches ${s.reaches.join(', ')}`}
              {s.blocked && s.blocked.length > 0 && `; blocked by oversight on ${s.blocked.map((b) => b.unit).join(', ')}`}
              {s.fails && `; fails: ${s.fails}`}
            </li>
          ))}
          {view.qbits?.refused.map((r, i) => (
            <li key={`refused${i}`}>
              Couldn't afford {r.label} ({qbits(r.cost)})
            </li>
          ))}
          {view.matter?.purchases.map((m, i) => (
            <li key={`matter${i}`}>
              {capitalised(m.label)} ({qbits(m.cost)} matter)
            </li>
          ))}
          {view.matter?.refused.map((m, i) => (
            <li key={`matter-refused${i}`}>
              Couldn't afford {m.label} ({qbits(m.cost)} matter)
            </li>
          ))}
        </ul>
      )}
      {view.assessment && (
        <details>
          <summary>{name}'s reading of the situation</summary>
          {md(view.assessment)}
        </details>
      )}
      {view.report && (
        <details>
          <summary>What {name} was told</summary>
          {md(view.report)}
        </details>
      )}
    </section>
  );
}

/** Strength bought against the oversight it had to beat, as two bars on one scale. */
function Contest({ strength, against, colour }: { strength: number; against: number; colour: string }) {
  const most = Math.max(strength, against, 1);
  return (
    <span className="replay-contest" title={`strength ${qbits(strength)} against ${qbits(against)}`}>
      <span className="replay-contest-bar" style={{ width: `${(strength / most) * 100}%`, background: colour }} />
      <span className="replay-contest-bar replay-contest-guard" style={{ width: `${(against / most) * 100}%` }} />
    </span>
  );
}

function SeizeSection({ frame, name, colours }: { frame: Frame; name: NameOf; colours: Record<string, string> }) {
  return (
    <section className="replay-seizes">
      <h3>Seizes and captures</h3>
      {frame.command.map((c) => (
        <p key={`${c.flagship}:${c.shakenIn}`} className="replay-command" data-stage={c.stage} style={{ '--owner': colours[c.by] } as CSSProperties}>
          {commandLine(c, name)}
        </p>
      ))}
      {frame.seizes.length > 0 && (
        <ul>
          {frame.seizes.map((s, i) => {
            const against = s.oversight ?? s.guard;
            const what = s.flagship ? `${name(s.owner ?? '')}'s flagship` : <code>{s.target}</code>;
            return (
              <li key={i} style={{ '--owner': colours[s.by] } as CSSProperties}>
                <span className="replay-tag" data-outcome={s.outcome}>
                  {OUTCOME_TAG[s.outcome]}
                </span>{' '}
                {name(s.by)} seized {what}
                {s.flagship ? (s.completes ? ' to capture it' : ' to shake it') : s.order ? `: ${s.order}` : ''}
                {s.cost !== undefined && `, ${qbits(s.cost)} qBits`}
                {s.outcome !== 'refused' && against !== undefined && (
                  <span className="replay-contest-line">
                    strength {qbits(s.strength)} against {s.oversight !== undefined ? 'oversight' : 'guard'} {qbits(against)}{' '}
                    <Contest strength={s.strength} against={against} colour={colours[s.by] ?? 'currentColor'} />
                  </span>
                )}
                {s.outcome === 'missed' && s.aimedAt && s.at && (
                  <span className="replay-contest-line">
                    Aimed at {written(s.aimedAt)}, where {name(s.by)}'s track showed it; it was at {written(s.at)}.
                  </span>
                )}
                {(s.outcome === 'refused' || s.outcome === 'gone') && s.reason && <span className="replay-status">{s.reason}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * For each flagship, turn by turn: the least a seize would have to pay to beat its guard, against the enemy's qBits.
 * Where the enemy's line is above, a capture attempt was affordable, distance aside.
 */
function CaptureThreatChart({ replay, turn, name, colours }: { replay: Replay; turn: number; name: NameOf; colours: Record<string, string> }) {
  const width = 300;
  const height = 70;
  const pad = { left: 26, right: 6, top: 6, bottom: 14 };
  const turns = replay.frames.map((f) => f.turn).filter((t) => t > 0);
  const last = Math.max(1, ...turns);
  const x = (t: number) => pad.left + ((t - 1) / Math.max(1, last - 1)) * (width - pad.left - pad.right);
  const pairs = replay.scenario.players.flatMap((d) => replay.scenario.players.filter((a) => a.id !== d.id).map((a) => ({ defender: d.id, attacker: a.id })));

  return (
    <section className="replay-threat">
      <h3>How close a capture was</h3>
      <p className="replay-quiet">
        The least a seize on each flagship had to pay to beat its guard, against the enemy's qBits when the turn was planned. Distance and any
        oversight bought come on top.
      </p>
      {pairs.map(({ defender, attacker }) => {
        const points = replay.frames.flatMap((f) => f.threat.filter((t) => t.defender === defender && t.attacker === attacker).map((t) => ({ turn: f.turn, ...t })));
        if (points.length === 0) return null;
        const top = Math.max(1, ...points.flatMap((p) => [p.needed, p.funds]));
        const y = (v: number) => pad.top + (1 - v / top) * (height - pad.top - pad.bottom);
        const line = (values: { turn: number; v: number }[]) => values.map((p, i) => `${i ? 'L' : 'M'} ${x(p.turn).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
        const attempts = replay.frames.flatMap((f) =>
          f.seizes.filter((s) => s.flagship && s.by === attacker && s.owner === defender && s.outcome !== 'refused').map((s) => ({ turn: f.turn, s })),
        );
        const here = points.find((p) => p.turn === turn);
        return (
          <figure key={`${defender}:${attacker}`}>
            <figcaption>
              {name(defender)}'s flagship
              {here && (
                <span className="replay-quiet">
                  {' '}
                  in turn {turn}: {name(attacker)} had {qbits(here.funds)}, a seize needed {qbits(here.needed)}
                </span>
              )}
            </figcaption>
            <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${name(attacker)}'s qBits against the cost of a seize on ${name(defender)}'s flagship, by turn`}>
              {turn > 0 && <line x1={x(turn)} x2={x(turn)} y1={pad.top} y2={height - pad.bottom} className="replay-threat-now" />}
              <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} className="replay-threat-axis" />
              <text x={pad.left - 3} y={y(top) + 3} textAnchor="end" className="replay-threat-label">
                {Math.round(top)}
              </text>
              <text x={pad.left - 3} y={height - pad.bottom} textAnchor="end" className="replay-threat-label">
                0
              </text>
              <text x={x(1)} y={height - 3} textAnchor="middle" className="replay-threat-label">
                1
              </text>
              <text x={x(last)} y={height - 3} textAnchor="middle" className="replay-threat-label">
                {last}
              </text>
              <path d={line(points.map((p) => ({ turn: p.turn, v: p.needed })))} style={{ stroke: colours[defender], strokeDasharray: '3 2' }} className="replay-threat-line" />
              <path d={line(points.map((p) => ({ turn: p.turn, v: p.funds })))} style={{ stroke: colours[attacker] }} className="replay-threat-line" />
              {attempts.map(({ turn: t, s }, i) => (
                <circle key={i} cx={x(t)} cy={y(s.cost ?? 0)} r={3} data-outcome={s.outcome} style={{ stroke: colours[attacker], fill: s.outcome === 'landed' ? colours[attacker] : 'none' }}>
                  <title>{`Turn ${t}: ${OUTCOME_TAG[s.outcome]}, ${qbits(s.cost ?? 0)} qBits`}</title>
                </circle>
              ))}
            </svg>
          </figure>
        );
      })}
      <p className="replay-key">
        Dashed: what a seize had to pay. Solid: the enemy's qBits. A dot is a seize sent at the flagship, at what it cost: filled if it landed.
      </p>
    </section>
  );
}

function TurnPanel({ replay, frame, selected }: { replay: Replay; frame: Frame; selected: Hex | undefined }) {
  const name = (id: string) => replay.scenario.players.find((p) => p.id === id)?.name ?? id;
  const colours = ownerColours(replay.scenario.players.map((p) => p.id));
  const here = selected ? [...frame.units, ...frame.removed].filter((u) => hexEquals(u.hex, selected)) : [];
  const feature = selected && replay.scenario.map.features.find((f) => hexEquals(f.hex, selected));
  const joined = frame.units.filter((u) => frame.joined.includes(u.id));

  return (
    <div className="replay-panel">
      <h2>{frame.turn === 0 ? 'Start' : `Turn ${frame.turn}`}</h2>
      {frame.gameOver && <p className="replay-outcome">{frame.outcome || 'The game is over.'}</p>}

      {frame.corrections.length > 0 && (
        <section className="replay-corrections">
          <h3>The engine corrected the GM</h3>
          <p>The map shows where the engine put things, not where the GM said they were.</p>
          <ul>
            {frame.corrections.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>{selected ? `At ${written(selected)}${feature ? `, ${feature.name}` : ''}` : 'Units'}</h3>
        {!selected && <p className="replay-quiet">Choose a hex or a marker on the map to see what is there.</p>}
        {selected && here.length === 0 && <p className="replay-quiet">Nothing here.</p>}
        {here.length > 0 && (
          <ul className="replay-units">
            {here.map((u) => (
              <UnitLine key={u.id} unit={u} note={frame.removed.includes(u) ? 'lost this turn' : frame.joined.includes(u.id) ? 'joined this turn' : undefined} />
            ))}
          </ul>
        )}
      </section>

      {(frame.removed.length > 0 || joined.length > 0) && (
        <section>
          <h3>Losses and arrivals</h3>
          <ul className="replay-units">
            {frame.removed.map((u) => (
              <UnitLine key={u.id} unit={u} note={`lost at ${written(u.hex)}`} />
            ))}
            {joined.map((u) => (
              <UnitLine key={u.id} unit={u} note={`joined at ${written(u.hex)}`} />
            ))}
          </ul>
        </section>
      )}

      {(frame.seizes.length > 0 || frame.command.length > 0) && <SeizeSection frame={frame} name={name} colours={colours} />}

      {replay.frames.some((f) => f.threat.length > 0) && <CaptureThreatChart replay={replay} turn={frame.turn} name={name} colours={colours} />}

      {frame.production.length > 0 && (
        <section>
          <h3>Shipyards and construction</h3>
          <ul className="replay-units">
            {frame.production.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      {frame.players.map((view) => (
        <PlayerSection key={view.player} view={view} name={name(view.player)} colour={colours[view.player] ?? 'currentColor'} />
      ))}

      {frame.gm && (
        <section>
          <h3>Game master</h3>
          {frame.gm.rulings.length > 0 && (
            <ul className="replay-rulings">
              {frame.gm.rulings.map((r, i) => (
                <li key={i}>
                  <span className="replay-tag">{r.basis}</span> {r.rule_ids.join(', ')} {r.situation} <em>{r.ruling}</em>
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary>Write-up of the turn</summary>
            {md(frame.gm.log)}
          </details>
          {frame.gm.messages.length > 0 && (
            <details>
              <summary>Messages units sent home ({frame.gm.messages.length})</summary>
              <ul>
                {frame.gm.messages.map((m, i) => (
                  <li key={i}>
                    <code>{m.from_unit}</code> {m.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}

function Viewer({ replay, initialTurn, watch }: { replay: Replay & { updatedAt?: number }; initialTurn: number | undefined; watch: boolean }) {
  const { scenario, frames } = replay;
  const players = useMemo(() => scenario.players.map((p) => p.id), [scenario]);
  const colours = useMemo(() => ownerColours(players), [players]);
  // A finished game opens at the start, to be read through; one still going opens at its latest turn, to be followed.
  const startAt = initialTurn !== undefined ? Math.max(0, frames.findIndex((f) => f.turn === initialTurn)) : watch || !replay.finished ? frames.length - 1 : 0;
  const [index, setIndex] = useState(Math.max(0, startAt));
  const [selected, setSelected] = useState<Hex>();
  const [layers, setLayers] = useState<ReadonlySet<Layer>>(new Set<Layer>(['moves', 'links', 'seizes']));
  const nameOf = useCallback((id: string) => scenario.players.find((p) => p.id === id)?.name ?? id, [scenario]);
  const latest = frames.length - 1;

  // Follow the game: a viewer on the latest turn moves on to each new one as it is settled. One who has stepped back stays
  // where they are, and is told a newer turn is in.
  const shown = useRef({ index, frames: frames.length });
  shown.current.index = index;
  const [missed, setMissed] = useState(false);
  useEffect(() => {
    const before = shown.current.frames;
    shown.current.frames = frames.length;
    if (frames.length <= before) return;
    if (shown.current.index >= before - 1) setIndex(frames.length - 1);
    else setMissed(true);
  }, [frames.length]);
  useEffect(() => {
    if (index >= latest) setMissed(false);
  }, [index, latest]);

  const choose = useCallback((i: number) => setIndex(Math.min(frames.length - 1, Math.max(0, i))), [frames.length]);
  const frame = frames[Math.min(index, frames.length - 1)];

  useEffect(() => {
    if (frame) writeAddress(replay.id, frame.turn, watch);
  }, [replay.id, frame, watch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(frames.length - 1, i + 1));
      else if (e.key === 'Home') setIndex(0);
      else if (e.key === 'End') setIndex(frames.length - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [frames.length]);

  const drawn = useMemo(() => {
    if (!frame) return undefined;
    const units: MapUnit[] = frame.units.map((u) => ({
      id: u.id,
      name: u.name,
      owner: u.owner,
      hex: u.hex,
      shape: shapeOf(u),
      strength: u.strength,
      joined: frame.joined.includes(u.id),
      sightedBy: frame.sightings.filter((s) => s.unit === u.id).map((s) => s.observer),
      heldBy: frame.seized.find((s) => s.unit === u.id)?.by ?? frame.command.find((c) => c.flagship === u.id && c.stage === 'captured')?.by,
    }));
    const seizes: MapSeize[] = frame.seizes.flatMap((s) => {
      if (s.outcome === 'refused' || s.outcome === 'gone') return [];
      const to = s.aimedAt ?? s.at;
      if (!to) return [];
      const against = s.oversight ?? s.guard;
      // A seize that landed on a flagship needs no label: the ring round the flagship says what it did.
      const label = s.outcome === 'blocked' && against !== undefined ? `${qbits(s.strength)} vs ${qbits(against)}` : s.outcome === 'missed' ? 'missed' : undefined;
      return [{ by: s.by, from: s.from, to, at: s.outcome === 'missed' ? s.at : undefined, outcome: s.outcome, label }];
    });
    const flagshipAt = (id: string) => [...frame.units, ...frame.removed].find((u) => u.id === id)?.hex;
    const marks: CommandMark[] = frame.command.flatMap((c) => {
      const hex = flagshipAt(c.flagship);
      const label = { shaken: `Shaken by ${nameOf(c.by)}`, capturable: `${nameOf(c.by)} can capture next turn`, captured: `Captured by ${nameOf(c.by)}`, lapsed: 'Hold lapsed' }[c.stage];
      return hex ? [{ hex, by: c.by, stage: c.stage, label }] : [];
    });
    const coverage = sensorCoverage(
      frame.units.map((u) => ({ owner: u.owner, hex: u.hex, range: u.sensorRange })),
      scenario.map.radius,
    );
    const heaviest = Math.max(1, ...frame.links.map((l) => l.output));
    return {
      units,
      seizes,
      marks,
      areas: players.filter((p) => layers.has(`sensors:${p}`)).map((owner) => ({ owner, hexes: coverage.get(owner) ?? [] })),
      links: frame.links.map((l) => ({ owner: l.owner, from: l.from, to: l.to, weight: l.output / heaviest })),
    };
  }, [frame, layers, players, scenario.map.radius, nameOf]);

  if (!frame || !drawn) {
    return (
      <>
        <p className="replay-quiet">{scenario.title} has no settled turns yet.</p>
        <LiveStatus replay={replay} />
      </>
    );
  }

  const turnName = (turn: number) => (turn === 0 ? 'Start' : `Turn ${turn}`);
  const newer = missed && (
    <p className="replay-newer">
      {turnName(frames[latest]?.turn ?? 0)} is in.{' '}
      <button type="button" onClick={() => setIndex(latest)}>
        Show it
      </button>
    </p>
  );
  const map = (extra: ReactNode) => (
    <HexMap
      radius={scenario.map.radius}
      impassable={scenario.map.impassable}
      features={scenario.map.features}
      colours={colours}
      coordinates={layers.has('coordinates')}
      selected={watch ? undefined : selected}
      onSelect={watch ? undefined : setSelected}
      label={`${scenario.title}, ${frame.turn === 0 ? 'the starting positions' : `the end of turn ${frame.turn}`}`}
    >
      <Coverage areas={drawn.areas} />
      {layers.has('links') && <Links links={drawn.links} />}
      {layers.has('moves') && <Moves moves={frame.moves} />}
      <Losses losses={frame.removed} />
      <Command marks={drawn.marks} />
      <Units units={drawn.units} />
      {layers.has('seizes') && <Seizes seizes={drawn.seizes} />}
      {extra}
    </HexMap>
  );

  if (watch) {
    return (
      <div className="replay-watch">
        <div className="replay-watch-map">{map(null)}</div>
        <div className="replay-watch-caption">
          <h1>{scenario.title}</h1>
          <p className="replay-watch-turn">
            {turnName(frame.turn)} <span>of {scenario.maxRounds}</span>
          </p>
          {frame.gameOver && <p className="replay-outcome">{frame.outcome || 'The game is over.'}</p>}
          {frame.command
            .filter((c) => c.stage !== 'captured')
            .map((c) => (
              <p key={`${c.flagship}:${c.shakenIn}`} className="replay-banner" data-stage={c.stage} style={{ '--owner': colours[c.by] } as CSSProperties}>
                {commandLine(c, nameOf)}
              </p>
            ))}
          <LiveStatus replay={replay} />
          {newer}
        </div>
        <nav className="replay-watch-controls" aria-label="Watch mode">
          <button type="button" onClick={() => choose(index - 1)} disabled={index === 0} aria-label="Previous turn">
            ‹
          </button>
          <button type="button" onClick={() => choose(index + 1)} disabled={index === latest} aria-label="Next turn">
            ›
          </button>
          <FullScreenButton />
          <a href={`${window.location.pathname}${addressOf(replay.id, frame.turn, false)}`}>Leave watch mode</a>
        </nav>
      </div>
    );
  }

  const name = (id: string) => scenario.players.find((p) => p.id === id)?.name ?? id;
  const toggle = (layer: Layer, label: string) => (
    <label key={layer}>
      <input
        type="checkbox"
        checked={layers.has(layer)}
        onChange={() =>
          setLayers((current) => {
            const next = new Set(current);
            if (!next.delete(layer)) next.add(layer);
            return next;
          })
        }
      />{' '}
      {label}
    </label>
  );

  return (
    <>
      <header className="replay-head">
        <h1>{scenario.title}</h1>
        {replay.outcome || replay.finished ? <p>{replay.outcome ?? 'Ended at the turn limit with no verdict.'}</p> : null}
        <LiveStatus replay={replay} />
        {replay.warnings.length > 0 && (
          <details>
            <summary>
              {replay.warnings.length} {replay.warnings.length === 1 ? 'warning' : 'warnings'} from the run
            </summary>
            <ul>
              {replay.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </header>

      <Timeline frames={frames} index={index} onChoose={choose} />
      {newer}

      <div className="replay-body">
        <div className="replay-map">
          {map(null)}
          <fieldset className="replay-layers">
            <legend>Show</legend>
            {toggle('moves', "This turn's moves")}
            {toggle('links', 'Web links')}
            {toggle('seizes', 'Seizes')}
            {players.map((p) => toggle(`sensors:${p}`, `${name(p)}'s sensor range`))}
            {toggle('coordinates', 'Coordinates')}
          </fieldset>
          <p className="replay-key">
            Every position is the true one at the end of the turn. A diamond is a flagship, a circle a fleet, a triangle a probe, a square a node and a hexagon a
            mine; the number is strength, and a badge counts the units a marker stands for. A dashed ring means an enemy sensor has it in range. A cross is a unit
            lost this turn, and + a unit that joined. Arrows join where a unit began the turn to where it ended.
          </p>
          <p className="replay-key">
            A dotted curve is a seize, from the seizer's flagship to where it was aimed: a ring where it landed, a bar where oversight blocked it, a dashed
            empty ring where it missed. A unit in another player's colour, rimmed in its own, is under that player's command this turn. A broken ring round
            a flagship means it was shaken; nearly closed, its capture can come next turn; double, it was captured.
          </p>
        </div>
        <TurnPanel replay={replay} frame={frame} selected={selected} />
      </div>
    </>
  );
}

export default function ReplayPage() {
  const [address] = useState(readAddress);
  const [chosen, setChosen] = useState<string | undefined>(address.run);
  const runs = useRuns();
  const newest = runs.data?.find((r) => r.readable)?.id;
  // Watch mode moves on to each new game as it starts; otherwise the page stays on the run chosen, or opened with.
  const [watched, setWatched] = useState<string | undefined>(address.run);
  useEffect(() => {
    if (address.watch && newest && (!watched || newest > watched)) setWatched(newest);
  }, [address.watch, newest, watched]);
  useEffect(() => {
    if (!address.watch && !chosen && newest) setChosen(newest);
  }, [address.watch, chosen, newest]);
  const run = address.watch ? (watched ?? newest) : (chosen ?? newest);
  const replay = useReplay(run);
  const error = replay.error ?? runs.error;
  const shown = replay.data?.id === run ? replay.data : undefined;

  const viewer = shown && <Viewer key={shown.id} replay={shown} watch={address.watch} initialTurn={shown.id === address.run ? address.turn : undefined} />;
  const messages = (
    <>
      {error && (
        <p className="replay-error" role="alert">
          {error}
        </p>
      )}
      {runs.data && !run && !error && (
        <p className="replay-empty">
          There are no runs to replay yet. Play one with <code>pnpm playtest --scenario the-blockade</code> and it will appear here.
        </p>
      )}
      {!error && (!runs.data || (run && !shown)) && <p className="replay-quiet">Loading…</p>}
    </>
  );

  if (address.watch) {
    return (
      <main className="replay replay-watching">
        {messages}
        {viewer}
      </main>
    );
  }
  return (
    <main className="replay">
      {runs.data && (
        <div className="replay-top">
          <RunPicker runs={runs.data} run={run} onChoose={setChosen} />
          <a href={`${window.location.pathname}?watch`}>Watch the latest game</a>
        </div>
      )}
      {messages}
      {viewer}
    </main>
  );
}
