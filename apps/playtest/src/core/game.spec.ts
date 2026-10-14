import { findWorkspaceRoot, loadScenario } from '../input/scenario-loader';
import type { Agent, JsonSchema } from '../types/agent';
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
  async send(label: string, prompt: string, responseSchema?: JsonSchema): Promise<string> {
    this.prompts.push({ label, prompt });
    const reply = this.reply(label, prompt);
    return responseSchema ? JSON.stringify(reply) : String(reply);
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

const unitStates = (scenario: Scenario) =>
  scenario.units.map((u) => ({ id: u.id, owner: u.owner, class: u.class, q: u.hex.q, r: u.hex.r, strength: u.strength }));

const resolution = (scenario: Scenario, turn: number, over = false, redMentions: GmResolution['player_reports'][number]['mentions'] = []): GmResolution => ({
  resolution_log: `log ${turn}`,
  true_state: `state ${turn}`,
  // Nobody moves.
  units: unitStates(scenario),
  player_reports: [
    { player_id: 'blue', report: `SECRET-BLUE-${turn}`, mentions: [{ unit_id: 'blue-line', observed_turn: turn - 1 }] },
    { player_id: 'red', report: `SECRET-RED-${turn}`, mentions: redMentions },
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

function setup(scenario: Scenario, gameOverOnTurn: number, { leakOnTurn = 0, stubborn = false } = {}) {
  const gm = new ScriptedAgent('gm', (label) => {
    if (label === 'setup') return resolution(scenario, 0);
    if (label === 'debrief') return gmFeedback;
    if (label.includes('intel')) {
      return { private_notes: '', snapshot: true, pings: [], response: 'INTEL-FOR-RED', mentions: [], rulings: [] } satisfies GmIntel;
    }
    const n = Number(label.split(' ')[1]);
    // On the leak turn, the first resolution tells Red where Blue's flagship is.
    // A stubborn GM keeps leaking through every correction.
    const leaking = n === leakOnTurn && (stubborn || !label.includes('correction'));
    const leak = leaking ? [{ unit_id: 'blue-flagship', observed_turn: n }] : [];
    return resolution(scenario, n, n === gameOverOnTurn, leak);
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
    const { blue, red, agents } = setup(scenario, 99);
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
    const { gm, red, agents } = setup(scenario, 99);
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 1, emit: (e) => events.push(e) });

    expect(red.prompts.map((p) => p.label)).toEqual(['turn 1', 'turn 1 after intel', 'debrief']);
    expect(red.prompts[1]?.prompt).toContain('INTEL-FOR-RED');
    expect(gm.prompts.map((p) => p.label)).toEqual(['setup', 'turn 1 intel red', 'turn 1 resolve', 'debrief']);
    expect(gm.prompts[2]?.prompt).toContain('"orders"');
  });

  it('stops when the GM declares game over, then debriefs everyone and writes a synthesis', async () => {
    const { gm, analyst, agents } = setup(scenario, 2);
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 10, emit: (e) => events.push(e) });

    expect(events.filter((e) => e.type === 'gm_resolution')).toHaveLength(2);
    expect(gm.prompts.at(-1)?.label).toBe('debrief');
    expect(events.filter((e) => e.type === 'player_feedback')).toHaveLength(2);
    expect(analyst.prompts[0]?.prompt).toContain('[invented] (OPEN-06) pass-through → they fight');
    expect(analyst.prompts[0]?.prompt).toContain('Turn 1, blue: what is age?');
    expect(events.at(-1)).toEqual({ type: 'synthesis', report: 'REPORT' });
  });

  it("appends the engine's sensor picture to each player's report", async () => {
    const { blue, agents } = setup(scenario, 99);
    await runPlaytest({ scenario, agents, maxRounds: 1, emit: () => undefined });

    const report = blue.prompts[0]?.prompt ?? '';
    expect(report).toContain('SECRET-BLUE-0');
    expect(report).toContain('## Sensor picture (Planning phase, turn 1)');
    // Blue Line is 3 hexes from Blue's flagship, so its latest report is a turn old (LIGHT-06).
    expect(report).toContain('Blue Line (`blue-line`, fleet, strength 4) at (-2, 1) at the end of turn -1 (age 1)');
    expect(report).toContain('Contacts:\n- None.');
    expect(report).not.toContain('red-line');
  });

  it("sends a report that leaks hidden information back to the GM, and the player never sees it", async () => {
    const { gm, red, agents } = setup(scenario, 99, { leakOnTurn: 1 });
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 2, emit: (e) => events.push(e) });

    const corrections = events.filter((e) => e.type === 'correction');
    expect(corrections).toEqual([
      expect.objectContaining({
        agent: 'gm',
        label: 'turn 1 resolve',
        problems: expect.stringContaining('refers to blue-flagship, but red has no information about it in turn 2'),
      }),
    ]);
    expect(gm.prompts.map((p) => p.label)).toContain('turn 1 resolve (correction 1)');
    expect(red.prompts.map((p) => p.prompt).join('\n')).not.toContain('blue-flagship');
  });

  it('keeps playing when the GM never fixes a problem, and records it as unresolved', async () => {
    const { agents } = setup(scenario, 99, { leakOnTurn: 1, stubborn: true });
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 3, emit: (e) => events.push(e) });

    expect(events.filter((e) => e.type === 'correction')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'unresolved')).toEqual([
      expect.objectContaining({ agent: 'gm', label: 'turn 1 resolve', problems: expect.stringContaining('blue-flagship') }),
    ]);
    expect(events.filter((e) => e.type === 'gm_resolution').map((e) => e.turn)).toEqual([1, 2, 3]);
    expect(events.at(-1)).toEqual({ type: 'synthesis', report: 'REPORT' });
  });
});
