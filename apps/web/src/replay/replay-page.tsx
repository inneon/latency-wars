import { type Hex, hexEquals } from '@latency-wars/domain';
import { Coverage, HexMap, Links, Losses, type MapUnit, Moves, ownerColours, sensorCoverage, Units } from '@latency-wars/map-view';
import type { Frame, PlayerTurnView, PlaytestUnit, Replay, RunSummary } from '@latency-wars/playtest-replay';
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { runStarted, useReplay, useRuns } from './replay-client';
import './replay.css';

const md = (text: string) => <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>;
const written = (h: Hex) => `(${h.q}, ${h.r})`;
const qbits = (n: number) => String(Math.round(n * 100) / 100);
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

type Layer = 'moves' | 'links' | 'coordinates' | `sensors:${string}`;

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
          const notes = [
            f.removed.length ? `${f.removed.length} lost` : '',
            f.corrections.length ? 'engine corrected the GM' : '',
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
        view.spoofs.length > 0 ||
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
          {view.spoofs.map((s, i) => (
            <li key={`spoof${i}`}>
              {s.kind === 'seize' ? 'Seize' : 'Spoof'} <code>{s.target}</code> to {s.order}
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
  const [layers, setLayers] = useState<ReadonlySet<Layer>>(new Set<Layer>(['moves', 'links']));
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
    }));
    const coverage = sensorCoverage(
      frame.units.map((u) => ({ owner: u.owner, hex: u.hex, range: u.sensorRange })),
      scenario.map.radius,
    );
    const heaviest = Math.max(1, ...frame.links.map((l) => l.output));
    return {
      units,
      areas: players.filter((p) => layers.has(`sensors:${p}`)).map((owner) => ({ owner, hexes: coverage.get(owner) ?? [] })),
      links: frame.links.map((l) => ({ owner: l.owner, from: l.from, to: l.to, weight: l.output / heaviest })),
    };
  }, [frame, layers, players, scenario.map.radius]);

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
      <Units units={drawn.units} />
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
            {players.map((p) => toggle(`sensors:${p}`, `${name(p)}'s sensor range`))}
            {toggle('coordinates', 'Coordinates')}
          </fieldset>
          <p className="replay-key">
            Every position is the true one at the end of the turn. A diamond is a flagship, a circle a fleet, a triangle a probe, a square a node and a hexagon a
            mine; the number is strength, and a badge counts the units a marker stands for. A dashed ring means an enemy sensor has it in range. A cross is a unit
            lost this turn, and + a unit that joined. Arrows join where a unit began the turn to where it ended.
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
