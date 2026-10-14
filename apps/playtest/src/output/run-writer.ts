import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PlaytestEvent } from '../types/events';
import type { RunConfig } from '../types/run-config';
import type { AgentUsage } from '../types/usage';
import { renderReport, renderTranscript } from './render';

/** Everything a run writes: progress to the console, and files to the output directory. */
export class RunWriter {
  private readonly events: PlaytestEvent[] = [];
  private readonly eventsFile: string;
  /** Someone is playing a seat, so progress must not give anything away. */
  private readonly quiet: boolean;
  private lastTurnShown = 0;

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
    writeFileSync(transcript, renderTranscript(scenario, this.events));
    writeFileSync(report, renderReport(scenario, this.events, usage));

    const cost = usage.reduce((sum, u) => sum + (u.costUsd ?? 0), 0);
    const priced = usage.some((u) => u.costUsd != null);
    console.log(`\n${priced ? `Estimated cost $${cost.toFixed(2)}. ` : ''}Output:`);
    console.log(`  ${this.relative(report)}`);
    console.log(`  ${this.relative(transcript)}`);
  }

  private relative(p: string): string {
    return path.relative(this.config.workspaceRoot, p);
  }
}

function describe(e: PlaytestEvent): string {
  switch (e.type) {
    case 'setup':
      return 'GM set up the game';
    case 'player_turn':
      return `Turn ${e.turn}: ${e.player} submitted ${e.submission.orders.length} order(s)${
        e.submission.instant_intel_requests.length ? ' and asked for instant intel' : ''
      }`;
    case 'gm_intel':
      return `Turn ${e.turn}: GM resolved instant intel for ${e.player}`;
    case 'gm_resolution':
      return `Turn ${e.turn}: GM resolved the turn (${e.resolution.rulings.length} ruling(s))${
        e.resolution.game_over ? ` — game over: ${e.resolution.outcome}` : ''
      }`;
    case 'report':
      return `Turn ${e.turn}: ${e.player} received their report`;
    case 'correction':
      return `${e.agent} (${e.label}): reply sent back to be fixed`;
    case 'unresolved':
      return `WARNING: ${e.agent} (${e.label}): accepted with unresolved problems after the last correction`;
    case 'player_feedback':
      return `${e.player} gave feedback`;
    case 'gm_feedback':
      return 'GM gave feedback';
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
