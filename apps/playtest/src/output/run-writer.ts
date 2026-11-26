import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PlaytestEvent } from '../types/events';
import type { RunConfig } from '../types/run-config';
import type { AgentUsage } from '../types/usage';
import { formatDuration, renderReport, renderTranscript } from './render';

/** Everything a run writes: progress to the console, and files to the output directory. */
export class RunWriter {
  private readonly events: PlaytestEvent[] = [];
  private readonly eventsFile: string;
  /** Someone is playing a seat, so progress must not give anything away. */
  private readonly quiet: boolean;
  private lastTurnShown = 0;
  private readonly startedAt = Date.now();

  constructor(private readonly config: RunConfig) {
    mkdirSync(config.outDir, { recursive: true });
    this.eventsFile = path.join(config.outDir, 'events.jsonl');
    this.quiet = (config.remote?.seats.length ?? 0) > 0;
    const { scenario, maxRounds } = config;
    console.log(`Play-testing "${scenario.title}" for up to ${maxRounds} turns → ${this.relative(config.outDir)}`);
    if (this.quiet) {
      console.log('Someone is playing a seat, so progress here is kept to turn numbers. Don\'t open the run folder until the game ends.');
      if (config.backend.kind === 'clipboard') {
        console.log('Note: with the clipboard backend you relay the other chats yourself, so you will see their prompts.');
      }
    }
  }

  /** Prints each remote seat's URL, and opens it in the browser. */
  seats(urls: ReadonlyMap<string, string>): void {
    for (const [seat, url] of urls) {
      console.log(`\nSeat ${seat}: ${url}`);
      openInBrowser(url);
    }
    if (urls.size > 0) console.log('');
  }

  /** Called for each event as it happens, so a failed run still leaves its log behind. */
  readonly event = (e: PlaytestEvent): void => {
    this.events.push(e);
    appendFileSync(this.eventsFile, JSON.stringify(e) + '\n');
    const line = this.quiet ? this.describeQuietly(e) : describe(e);
    if (line) console.log(`  ${line}`);
  };

  /** Turn numbers and milestones only: nothing about who did what. */
  private describeQuietly(e: PlaytestEvent): string | null {
    if (e.type === 'report' && e.turn !== this.lastTurnShown) {
      this.lastTurnShown = e.turn;
      return `Turn ${e.turn}`;
    }
    if (e.type === 'gm_feedback') return 'Debrief';
    if (e.type === 'synthesis') return 'Report written';
    return null;
  }

  /** Writes the Markdown outputs from whatever events arrived, complete or not. */
  finish(usage: AgentUsage[]): void {
    const { outDir, scenario } = this.config;
    const report = path.join(outDir, 'report.md');
    const transcript = path.join(outDir, 'transcript.md');
    const duration = formatDuration(Date.now() - this.startedAt);
    writeFileSync(transcript, renderTranscript(scenario, this.events));
    writeFileSync(report, renderReport(scenario, this.events, usage, duration));

    const cost = usage.reduce((sum, u) => sum + (u.costUsd ?? 0), 0);
    const priced = usage.some((u) => u.costUsd != null);
    console.log(`\nRan in ${duration}.${priced ? ` Estimated cost $${cost.toFixed(2)}.` : ''} Output:`);
    console.log(`  ${this.relative(report)}`);
    console.log(`  ${this.relative(transcript)}`);
  }

  private relative(p: string): string {
    return path.relative(this.config.workspaceRoot, p);
  }
}

function describe(e: PlaytestEvent): string {
  switch (e.type) {
    case 'scenario':
    case 'state':
      return '';
    case 'setup':
      return 'GM set up the game';
    case 'player_turn':
      return `Turn ${e.turn}: ${e.player} submitted ${e.submission.orders.length} order(s)${
        e.submission.qbit_purchases.length ? ` and ${e.submission.qbit_purchases.length} qBit purchase(s)` : ''
      }`;
    case 'quotes':
      return `Turn ${e.turn}: quotes for ${e.player}${e.intel.length ? ` (with ${e.intel.filter((i) => i.bought).length} scan(s))` : ''}`;
    case 'hijacks':
      return `Turn ${e.turn}: ${e.player} bought ${e.quotes.filter((q) => !q.refused).length} spoof(s) and ${e.oversights.filter((o) => !o.refused).length} oversight(s)`;
    case 'gm_decisions':
      return `Turn ${e.turn}: GM decided every fleet's behaviour (${e.decisions.rulings.length} ruling(s))`;
    case 'movement':
      return `Turn ${e.turn}: engine ran Movement: ${e.phase.moved.length} move(s), ${e.phase.engagements.length} engagement(s), ${e.phase.combats.length} combat(s)`;
    case 'combat':
      return `Turn ${e.turn}: engine resolved ${e.phase.combats.filter((c) => !c.unresolved).length} combat(s), ${e.phase.destroyed.length} unit(s) destroyed`;
    case 'gm_resolution':
      return `Turn ${e.turn}: GM resolved the turn (${e.resolution.rulings.length} ruling(s))${
        e.resolution.game_over ? ` — game over: ${e.resolution.outcome}` : ''
      }`;
    case 'report':
      return `Turn ${e.turn}: ${e.player} received their report`;
    case 'engine':
      return `${e.turn === 0 ? 'Setup' : `Turn ${e.turn}`}: engine corrected ${e.adjustments.length} thing(s)${
        e.overrides.length ? `; GM declared ${e.overrides.length} override(s)` : ''
      }`;
    case 'qbits':
      return `Turn ${e.turn}: engine settled the qBit ledger`;
    case 'matter':
      return `Turn ${e.turn}: engine settled the matter ledger`;
    case 'production':
      return `Turn ${e.turn}: engine handled ${e.notes.length} production and construction event(s)`;
    case 'construction':
      return `Turn ${e.turn}: engine worked out ${e.phase.outcomes.length} build outcome(s), ${e.phase.built.length} completed, ${e.phase.differences.length} difference(s) from the GM (ECON-03)`;
    case 'seeded':
      return `Turn ${e.turn}: ${e.player}'s ${e.reports.length} seeded unit(s) reported (QBIT-11)`;
    case 'capture':
      return `Turn ${e.turn}: ${e.captured.map((c) => `${c.by} captured ${c.flagship}`).join(', ')} (QBIT-13)`;
    case 'cascade':
      return e.completed
        ? `Turn ${e.turn}: ${e.completed.join(' and ')} completed a Cascade (QBIT-12)`
        : `Turn ${e.turn}: ${e.player}'s Cascade charge ${e.refused ? `refused: ${e.refused}` : `paid, ${e.count} of ${e.turns}`} (QBIT-12)`;
    case 'correction':
      return `${e.agent} (${e.label}): reply sent back to be fixed`;
    case 'unresolved':
      return `WARNING: ${e.agent} (${e.label}): accepted with unresolved problems after the last correction`;
    case 'player_feedback':
      return `${e.player} gave feedback`;
    case 'gm_feedback':
      return 'GM gave feedback';
    case 'ranking':
      return `After turn ${e.turn}: private ranking recorded for the analyst`;
    case 'synthesis':
      return 'Analyst wrote the report';
    case 'warning':
      return `WARNING: ${e.message}`;
  }
}

/** Best effort: if it fails, the URL is printed anyway. */
function openInBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  try {
    spawn(command, [url], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
  } catch {
    // Nothing to do: the URL is on screen.
  }
}
