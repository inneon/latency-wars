import type { z } from 'zod';
import { findWorkspaceRoot, loadScenario } from '../input/scenario-loader';
import type { Agent } from '../types/agent';
import type { PlaytestEvent } from '../types/events';
import type { Scenario } from '../types/scenario';
import type { Feedback, GmFeedback, GmIntel, GmResolution, PlayerTurn } from '../types/schemas';
import { runPlaytest } from './game';

class ScriptedAgent implements Agent {
  readonly prompts: { label: string; prompt: string }[] = [];
  constructor(
    readonly id: string,
    private readonly reply: (label: string, prompt: string) => unknown,
  ) {}
  async ask<S extends z.ZodType>(label: string, prompt: string, schema: S): Promise<z.infer<S>> {
    this.prompts.push({ label, prompt });
    return schema.parse(this.reply(label, prompt));
  }
  async write(label: string, prompt: string): Promise<string> {
    this.prompts.push({ label, prompt });
    return String(this.reply(label, prompt));
  }
}

const feedback: Feedback = {
  most_fun: 'fun',
  least_fun: 'dull',
  memorable_moment: 'moment',
  fun: { rating: 4, explanation: '' },
  comprehensibility: { rating: 3, explanation: '' },
  comprehensiveness: { rating: 2, explanation: '' },
  rule_issues: [{ rule_id: 'LIGHT-03', issue: 'hard to compute', suggestion: 'add a table' }],
  missing_rules: [],
  top_suggestion: 'combat',
  anything_else: '',
};
const gmFeedback: GmFeedback = { ...feedback, adjudication_difficulties: ['bookkeeping'] };

const resolution = (turn: number, over = false): GmResolution => ({
  resolution_log: `log ${turn}`,
  true_state: `state ${turn}`,
  player_reports: [
    { player_id: 'blue', report: `SECRET-BLUE-${turn}` },
    { player_id: 'red', report: `SECRET-RED-${turn}` },
  ],
  rulings: [{ situation: 'pass-through', ruling: 'they fight', rule_ids: ['OPEN-06'], basis: 'invented' }],
  game_over: over,
  outcome: over ? 'Blue wins' : '',
});

const turn = (intel: string[] = []): PlayerTurn => ({
  situation_assessment: '',
  instant_intel_requests: intel,
  orders: [{ unit: 'Line', order: 'Hold', delivery: 'light' }],
  other_actions: [],
  questions_for_gm: [],
  rules_confusions: ['what is age?'],
});

function setup(gameOverOnTurn: number) {
  const gm = new ScriptedAgent('gm', (label) => {
    if (label === 'setup') return resolution(0);
    if (label === 'debrief') return gmFeedback;
    if (label.includes('intel')) return { private_notes: '', response: 'INTEL-FOR-RED', rulings: [] } satisfies GmIntel;
    const n = Number(label.split(' ')[1]);
    return resolution(n, n === gameOverOnTurn);
  });
  const player = (id: string) =>
    new ScriptedAgent(id, (label) => {
      if (label === 'debrief') return feedback;
      // Red buys instant intel on turn 1.
      if (id === 'red' && label === 'turn 1') return turn(['snapshot']);
      return turn();
    });
  const blue = player('blue');
  const red = player('red');
  const analyst = new ScriptedAgent('analyst', () => 'REPORT');
  return { gm, blue, red, analyst, agents: { gm, players: new Map([['blue', blue], ['red', red]]), analyst } };
}

describe('runPlaytest', () => {
  let scenario: Scenario;
  beforeAll(async () => {
    scenario = await loadScenario(findWorkspaceRoot(__dirname), 'the-hunt');
  });

  it('only ever shows each player their own reports', async () => {
    const { blue, red, agents } = setup(99);
    await runPlaytest({ scenario, agents, maxRounds: 3, emit: () => undefined });

    const blueSaw = blue.prompts.map((p) => p.prompt).join('\n');
    const redSaw = red.prompts.map((p) => p.prompt).join('\n');
    expect(blueSaw).toContain('SECRET-BLUE-0');
    expect(blueSaw).not.toContain('SECRET-RED');
    expect(blueSaw).not.toContain('INTEL-FOR-RED');
    expect(redSaw).toContain('SECRET-RED-2');
    expect(redSaw).not.toContain('SECRET-BLUE');
  });

  it('resolves instant intel before the player commits orders', async () => {
    const { gm, red, agents } = setup(99);
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 1, emit: (e) => events.push(e) });

    expect(red.prompts.map((p) => p.label)).toEqual(['turn 1', 'turn 1 after intel', 'debrief']);
    expect(red.prompts[1]?.prompt).toContain('INTEL-FOR-RED');
    expect(gm.prompts.map((p) => p.label)).toEqual(['setup', 'turn 1 intel red', 'turn 1 resolve', 'debrief']);
    expect(gm.prompts[2]?.prompt).toContain('"orders"');
  });

  it('stops when the GM declares game over, then debriefs everyone and writes a synthesis', async () => {
    const { gm, analyst, agents } = setup(2);
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 10, emit: (e) => events.push(e) });

    expect(events.filter((e) => e.type === 'gm_resolution')).toHaveLength(2);
    expect(gm.prompts.at(-1)?.label).toBe('debrief');
    expect(events.filter((e) => e.type === 'player_feedback')).toHaveLength(2);
    expect(analyst.prompts[0]?.prompt).toContain('[invented] (OPEN-06) pass-through → they fight');
    expect(analyst.prompts[0]?.prompt).toContain('Turn 1, blue: what is age?');
    expect(events.at(-1)).toEqual({ type: 'synthesis', report: 'REPORT' });
  });
});
