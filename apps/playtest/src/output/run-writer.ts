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

  constructor(private readonly config: RunConfig) {
    mkdirSync(config.outDir, { recursive: true });
    this.eventsFile = path.join(config.outDir, 'events.jsonl');
    const { scenario, maxRounds } = config;
    console.log(`Play-testing "${scenario.title}" for up to ${maxRounds} turns → ${this.relative(config.outDir)}`);
  }

  /** Called for each event as it happens, so a failed run still leaves its log behind. */
  readonly event = (e: PlaytestEvent): void => {
    this.events.push(e);
    appendFileSync(this.eventsFile, JSON.stringify(e) + '\n');
    console.log(`  ${describe(e)}`);
  };

  /** Writes the Markdown outputs from whatever events arrived, complete or not. */
  finish(usage: AgentUsage[]): void {
    const { outDir, scenario } = this.config;
    const report = path.join(outDir, 'report.md');
    const transcript = path.join(outDir, 'transcript.md');
    writeFileSync(transcript, renderTranscript(scenario, this.events));
    writeFileSync(report, renderReport(scenario, this.events, usage));

    const cost = usage.reduce((sum, u) => sum + (u.costUsd ?? 0), 0);
    console.log(`\nEstimated cost $${cost.toFixed(2)}. Output:`);
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
