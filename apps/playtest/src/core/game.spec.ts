import { findWorkspaceRoot, loadScenario } from '../input/scenario-loader';
import type { Agent, JsonSchema } from '../types/agent';
import type { PlaytestEvent } from '../types/events';
import type { Scenario } from '../types/scenario';
import type { Feedback, GmFeedback, GmIntel, GmResolution, PlayerTurn } from '@latency-wars/playtest-contracts';
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

const resolution = (scenario: Scenario, turn: number, over = false, extra: Partial<GmResolution> = {}): GmResolution => ({
  resolution_log: `log ${turn}`,
  true_state: `state ${turn}`,
  // Nobody moves.
  units: unitStates(scenario),
  removed_units: [],
  // Blue Line acks every turn; sent at the end of a turn from 1 hex away, each ack arrives two Planning phases later.
  messages: turn > 0 ? [{ from_unit: 'blue-line', text: `ACK-FROM-LINE-${turn}`, instant_ack: false }] : [],
  player_notes: [
    { player_id: 'blue', note: `SECRET-BLUE-${turn}` },
    { player_id: 'red', note: `SECRET-RED-${turn}` },
  ],
  overrides: [],
  rulings: [{ situation: 'pass-through', ruling: 'they fight', rule_ids: ['MOVE-03'], basis: 'invented' }],
  game_over: over,
  outcome: over ? 'Blue wins' : '',
  ...extra,
});

const turn = (purchases: PlayerTurn['qbit_purchases'] = []): PlayerTurn => ({
  situation_assessment: '',
  qbit_purchases: purchases,
  orders: [{ unit: 'Line', order: 'Hold', delivery: 'light' }],
  questions_for_gm: [],
  rules_confusions: ['what is age?'],
});

function setup(
  scenario: Scenario,
  gameOverOnTurn: number,
  { speedingOnTurn = 0, purchases = {} }: { speedingOnTurn?: number; purchases?: Record<string, PlayerTurn['qbit_purchases']> } = {},
) {
  const gm = new ScriptedAgent('gm', (label) => {
    if (label === 'setup') return resolution(scenario, 0);
    if (label === 'debrief') return gmFeedback;
    if (label.includes('intel')) {
      return { private_notes: '', snapshot: true, pings: [], response: 'INTEL-FOR-RED', rulings: [] } satisfies GmIntel;
    }
    const n = Number(label.split(' ')[1]);
    // On the speeding turn, the GM moves Blue Line two hexes; its speed is 1.
    const units = unitStates(scenario).map((u) => (n === speedingOnTurn && u.id === 'blue-line' ? { ...u, q: 0, r: 0 } : u));
    return resolution(scenario, n, n === gameOverOnTurn, { units });
  });
  const player = (id: string) =>
    new ScriptedAgent(id, (label) => {
      if (label === 'debrief') return feedback;
      // Red buys instant intel on turn 1.
      if (id === 'red' && label === 'turn 1' && !purchases[`${id}:${label}`]) return turn([{ kind: 'snapshot' }]);
      // Scripted purchases are asked for, then repeated in the final submission, as a real player would.
      const asked = purchases[`${id}:${label.replace(' final', '')}`];
      if (asked) return turn(asked);
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

    expect(red.prompts.map((p) => p.label)).toEqual(['turn 1', 'turn 1 final', 'debrief']);
    expect(red.prompts[1]?.prompt).toContain('INTEL-FOR-RED');
    expect(gm.prompts.map((p) => p.label)).toEqual(['setup', 'turn 1 intel red', 'turn 1 resolve', 'debrief']);
    expect(gm.prompts[2]?.prompt).toContain('"orders"');
  });

  it('quotes a hijack before it is bought, and hands the bought ones to the GM priced', async () => {
    // Red asks to spoof Blue Line on turn 1 with no track on it: quoted as refused, so nothing reaches the GM.
    // Blue asks to seize Red Line on turn 2 with no track either. Neither has a fresh track in this static game,
    // so both are refused; the flow is what's under test here, pricing is covered in the engine's tests.
    const { gm, blue, red, agents } = setup(scenario, 99, {
      purchases: {
        'red:turn 1': [{ kind: 'spoof', target: 'blue-line', order: 'Hold' }],
        'blue:turn 2': [{ kind: 'seize', target: 'red-line', order: 'Attack(blue-line)' }],
      },
    });
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 2, emit: (e) => events.push(e) });

    // A quote needs no GM call unless intel was asked for too.
    expect(gm.prompts.map((p) => p.label)).toEqual(['setup', 'turn 1 resolve', 'turn 2 resolve', 'debrief']);
    expect(red.prompts.map((p) => p.label)).toEqual(['turn 1', 'turn 1 final', 'turn 2', 'debrief']);
    expect(red.prompts[1]?.prompt).toContain('spoof `blue-line` → Hold: refused. You have no track on blue-line.');
    expect(blue.prompts.find((p) => p.label === 'turn 2 final')?.prompt).toContain('seize `red-line`');
    expect(events.filter((e) => e.type === 'quotes').map((e) => e.type === 'quotes' && [e.turn, e.player, e.intel === undefined])).toEqual([
      [1, 'red', true],
      [2, 'blue', true],
    ]);
    // Refused purchases are not bought, so the GM is told nothing about them.
    expect(gm.prompts.map((p) => p.prompt).join('\n')).not.toContain('Hijacks bought');
  });

  it('stops when the GM declares game over, then debriefs everyone and writes a synthesis', async () => {
    const { gm, analyst, agents } = setup(scenario, 2);
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 10, emit: (e) => events.push(e) });

    expect(events.filter((e) => e.type === 'gm_resolution')).toHaveLength(2);
    expect(gm.prompts.at(-1)?.label).toBe('debrief');
    expect(events.filter((e) => e.type === 'player_feedback')).toHaveLength(2);
    expect(analyst.prompts[0]?.prompt).toContain('[invented] (MOVE-03) pass-through → they fight');
    expect(analyst.prompts[0]?.prompt).toContain('Turn 1, blue: what is age?');
    expect(events.at(-1)).toEqual({ type: 'synthesis', report: 'REPORT' });
  });

  it("appends the engine's sensor picture to each player's report", async () => {
    const { blue, agents } = setup(scenario, 99);
    await runPlaytest({ scenario, agents, maxRounds: 1, emit: () => undefined });

    const report = blue.prompts[0]?.prompt ?? '';
    expect(report).toContain('SECRET-BLUE-0');
    expect(report).toContain('## Sensor picture (Planning phase, turn 1)');
    // Blue Line is 1 hex from Blue's flagship, so its latest report is a turn old (LIGHT-06).
    expect(report).toContain('Blue Line (`blue-line`, fleet, strength 4) at (-2, 2) at the end of turn -1 (age 1)');
    expect(report).toContain('Contacts:\n- None.');
    expect(report).not.toContain('red-line');
  });

  it('delivers fleet messages when light would bring them, never sooner', async () => {
    const { blue, red, agents } = setup(scenario, 99);
    await runPlaytest({ scenario, agents, maxRounds: 3, emit: () => undefined });

    const prompts = blue.prompts.filter((p) => /^turn \d$/.test(p.label)).map((p) => p.prompt);
    expect(prompts[0]).toContain('## Messages received\n\nNone.');
    expect(prompts[1]).not.toContain('ACK-FROM-LINE');
    // Sent at the end of turn 1 from 1 hex away: it lands in the Planning phase of turn 3.
    expect(prompts[2]).toContain('**Blue Line** (`blue-line`, sent turn 1): ACK-FROM-LINE-1');
    expect(prompts[2]).not.toContain('ACK-FROM-LINE-2');
    expect(red.prompts.map((p) => p.prompt).join('\n')).not.toContain('ACK-FROM-LINE');
  });

  it("corrects a GM's illegal move itself, and tells the GM next turn instead of sending the turn back", async () => {
    const { gm, agents } = setup(scenario, 99, { speedingOnTurn: 1 });
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 2, emit: (e) => events.push(e) });

    expect(events.filter((e) => e.type === 'correction')).toEqual([]);
    expect(events.filter((e) => e.type === 'engine')).toEqual([
      expect.objectContaining({ turn: 1, adjustments: [expect.stringContaining('blue-line moved to (0, 0), 2 hexes from (-2, 2)')] }),
    ]);
    const nextResolve = gm.prompts.find((p) => p.label === 'turn 2 resolve')?.prompt ?? '';
    expect(nextResolve).toContain('The engine corrected your last resolution');
    expect(nextResolve).toContain('blue-line moved to (0, 0)');
    expect(nextResolve).toMatch(/\| `blue-line` \| blue \| fleet \| \(-1, \d\) \|/);
  });
});
