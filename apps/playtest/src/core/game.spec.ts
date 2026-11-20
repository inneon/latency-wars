import { findWorkspaceRoot, loadScenario } from '../input/scenario-loader';
import type { Agent, JsonSchema, PlaytestAgents } from '../types/agent';
import type { PlaytestEvent } from '../types/events';
import type { Scenario } from '../types/scenario';
import type { Feedback, GmFeedback, GmResolution, PlayerTurn } from '@latency-wars/playtest-contracts';
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
  builds: [],
  yards_in_combat: [],
  rulings: [{ situation: 'pass-through', ruling: 'they fight', rule_ids: ['MOVE-03'], basis: 'invented' }],
  game_over: over,
  outcome: over ? 'Blue wins' : '',
  ...extra,
});

const turn = (purchases: PlayerTurn['qbit_purchases'] = [], orders: PlayerTurn['orders'] = [{ unit: 'Line', order: 'Hold', delivery: 'light' }]): PlayerTurn => ({
  situation_assessment: '',
  qbit_purchases: purchases,
  orders,
  questions_for_gm: [],
  rules_confusions: ['what is age?'],
});

function setup(
  scenario: Scenario,
  gameOverOnTurn: number,
  {
    speedingOnTurn = 0,
    stubOnTurn = 0,
    purchases = {},
    orders = {},
  }: {
    speedingOnTurn?: number;
    stubOnTurn?: number;
    purchases?: Record<string, PlayerTurn['qbit_purchases']>;
    orders?: Record<string, PlayerTurn['orders']>;
  } = {},
) {
  const gm = new ScriptedAgent('gm', (label) => {
    if (label === 'setup') return resolution(scenario, 0);
    const n = Number(label.split(' ')[1]);
    // On the speeding turn, the GM moves Blue Line two hexes; its speed is 1.
    const units = unitStates(scenario).map((u) => (n === speedingOnTurn && u.id === 'blue-line' ? { ...u, q: 0, r: 2 } : u));
    // On the stub turn, the GM's first reply leaves every unit out; its correction puts them back.
    if (n === stubOnTurn && !label.includes('correction')) return resolution(scenario, n, n === gameOverOnTurn, { units: [] });
    return resolution(scenario, n, n === gameOverOnTurn, { units });
  });
  const player = (id: string) =>
    new ScriptedAgent(id, (label) => {
      if (label === 'debrief') return feedback;
      // Red scans its flagship on turn 1.
      if (id === 'red' && label === 'turn 1' && !purchases[`${id}:${label}`]) return turn([{ kind: 'scan', target: 'red-flagship' }]);
      // Scripted purchases are asked for, then repeated in the final submission, as a real player would.
      const key = `${id}:${label.replace(' final', '')}`;
      return turn(purchases[key], orders[key]);
    });
  const blue = player('blue');
  const red = player('red');
  const analyst = new ScriptedAgent('analyst', () => 'REPORT');
  const gmDebriefers: ScriptedAgent[] = [];
  const newGmDebriefer = () => {
    const debriefer = new ScriptedAgent('gm', () => gmFeedback);
    gmDebriefers.push(debriefer);
    return debriefer;
  };
  return {
    gm,
    blue,
    red,
    analyst,
    gmDebriefers,
    agents: { gm, newGmDebriefer, players: new Map([['blue', blue], ['red', red]]), analyst },
  };
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
    expect(blueSaw).not.toContain('Intel snapshot');
    expect(redSaw).toContain('SECRET-RED-2');
    expect(redSaw).not.toContain('SECRET-BLUE');
  });

  it('charges for scans and shows them before the player commits orders, without asking the GM', async () => {
    const { gm, red, agents } = setup(scenario, 99);
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 1, emit: (e) => events.push(e) });

    expect(red.prompts.map((p) => p.label)).toEqual(['turn 1', 'turn 1 final', 'debrief']);
    // The-hunt: 8 qBits to start; a scan of the flagship itself costs the base QBIT_SCAN_COST, 1.
    expect(red.prompts[1]?.prompt).toContain('Scan `red-flagship` (FB-11): 1 qBits (base 1 + distance 0). Balance now 7.');
    expect(red.prompts[1]?.prompt).toContain('## Scan results (as of the end of turn 0, age 0)');
    expect(gm.prompts.map((p) => p.label)).toEqual(['setup', 'turn 1 resolve']);
    expect(gm.prompts[1]?.prompt).toContain('## Orders delivered in turn 1');
    expect(gm.prompts[1]?.prompt).toContain('| red | 7 | scan red-flagship (1) | nothing | 4 |');
  });

  it("keeps the qBit ledger and puts each player's balance and statement in their report", async () => {
    const { blue, red, agents } = setup(scenario, 99);
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 2, emit: (e) => events.push(e) });

    const report = (agent: typeof blue, n: number) => agent.prompts.find((p) => p.label === `turn ${n}`)?.prompt ?? '';
    expect(report(blue, 1)).toContain('## qBits\n\nBalance: 8 qBits.');
    // Blue: 8 decays by 8/3, then 4 is produced. Red spent 1 on a scan first: 7 decays by 7/3, then 4.
    expect(report(blue, 2)).toContain('Balance: 9.33 qBits.\nTurn 1: opened at 8; spent nothing; decay −2.67; production +4; closed at 9.33.');
    expect(report(red, 2)).toContain('Turn 1: opened at 8; spent scan red-flagship (1); decay −2.33; production +4; closed at 8.67.');
    expect(events.filter((e) => e.type === 'qbits').map((e) => e.type === 'qbits' && e.turn)).toEqual([1, 2]);
  });

  it("refuses an instant order the player can't afford, so the GM never sees it", async () => {
    // Blue sends three instant orders on turn 1 with 8 qBits: two are paid for (3 + 1 each), the third (3 + 2) isn't sent.
    const { gm, blue, agents } = setup(scenario, 99, {
      orders: {
        'blue:turn 1': [
          { unit: 'blue-line', order: 'Hold', delivery: 'instant' },
          { unit: 'blue-flagship', order: 'MoveTo((-3, 3))', delivery: 'instant' },
          { unit: 'blue-raider', order: 'MoveTo((0, 2))', delivery: 'instant' },
          { unit: 'blue-node-west', order: 'Hold', delivery: 'instant' },
        ],
      },
    });
    await runPlaytest({ scenario, agents, maxRounds: 2, emit: () => undefined });

    const resolve = gm.prompts.find((p) => p.label === 'turn 1 resolve')?.prompt ?? '';
    // The flagship's own order is local and free (ORD-05).
    expect(resolve).toContain('blue → `blue-flagship` (sent turn 1, light)');
    expect(resolve).toContain('blue → `blue-raider` (sent turn 1, instant)');
    expect(resolve).not.toContain('blue → `blue-node-west`');
    expect(resolve).toContain('| blue | 0 | instant order to blue-line (4), instant order to blue-raider (4) | instant order to blue-node-west (5, refused: balance 0) | 4 |');
    expect(blue.prompts.find((p) => p.label === 'turn 2')?.prompt).toContain('refused instant order to blue-node-west (5, refused: balance 0)');
  });

  it('quotes a spoof before it is bought, and hands the bought ones to the GM priced', async () => {
    // Red asks to spoof Blue Line on turn 1 with no track on it: quoted as refused, so nothing reaches the GM.
    // Blue asks to spoof Red Line on turn 2 with no track either. Neither has a fresh track in this static game,
    // so both are refused; the flow is what's under test here, pricing is covered in the engine's tests.
    const { gm, blue, red, agents } = setup(scenario, 99, {
      purchases: {
        'red:turn 1': [{ kind: 'spoof', target: 'blue-line', order: 'Hold' }],
        'blue:turn 2': [{ kind: 'spoof', target: 'red-line', order: 'Hold' }],
      },
    });
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 2, emit: (e) => events.push(e) });

    // A quote needs no GM call.
    expect(gm.prompts.map((p) => p.label)).toEqual(['setup', 'turn 1 resolve', 'turn 2 resolve']);
    expect(red.prompts.map((p) => p.label)).toEqual(['turn 1', 'turn 1 final', 'turn 2', 'debrief']);
    expect(red.prompts[1]?.prompt).toContain('spoof `blue-line` → Hold: refused. You have no track on blue-line.');
    expect(blue.prompts.find((p) => p.label === 'turn 2 final')?.prompt).toContain('spoof `red-line`');
    expect(events.filter((e) => e.type === 'quotes').map((e) => e.type === 'quotes' && [e.turn, e.player, e.intel.length === 0])).toEqual([
      [1, 'red', true],
      [2, 'blue', true],
    ]);
    // Refused purchases are not bought, so the GM is told nothing about them.
    expect(gm.prompts.map((p) => p.prompt).join('\n')).not.toContain('Spoofs bought');
  });

  it('quotes oversight, charges it in Emission and tells the GM (QBIT-09)', async () => {
    // Blue oversees Blue Line, 1 hex from its flagship, at strength 1: 1 + 1 qBits.
    const { gm, blue, agents } = setup(scenario, 99, {
      purchases: { 'blue:turn 1': [{ kind: 'oversee', target: 'blue-line', strength: 1 }] },
    });
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 1, emit: (e) => events.push(e) });

    expect(blue.prompts.find((p) => p.label === 'turn 1 final')?.prompt).toContain('oversee `blue-line` at strength 1: 2 qBits (distance 1 + strength 1)');
    const resolve = gm.prompts.find((p) => p.label === 'turn 1 resolve')?.prompt ?? '';
    expect(resolve).toContain('Oversight bought (QBIT-09)');
    expect(resolve).toContain('`blue-line` at strength 1');
    expect(events.filter((e) => e.type === 'hijacks').map((e) => e.type === 'hijacks' && [e.player, e.quotes.length, e.oversights.length])).toEqual([['blue', 0, 1]]);
  });

  it('stops when the GM declares game over, then debriefs everyone and writes a synthesis', async () => {
    const { gm, gmDebriefers, analyst, agents } = setup(scenario, 2);
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 10, emit: (e) => events.push(e) });

    expect(events.filter((e) => e.type === 'gm_resolution')).toHaveLength(2);
    expect(gm.prompts.at(-1)?.label).toBe('turn 2 resolve');
    expect(gmDebriefers.flatMap((d) => d.prompts.map((p) => p.label))).toEqual(['debrief']);
    expect(events.filter((e) => e.type === 'gm_feedback')).toHaveLength(1);
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
    // Blue Line is 1 hex from Blue's flagship, within its own sensors, so its report is current (LIGHT-03).
    expect(report).toContain('Blue Line (`blue-line`, fleet, strength 4) at (-2, 2) at the end of turn 0 (age 0)');
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

  it('sends a resolution that leaves units out back to the GM, even when it ends the game', async () => {
    const { gm, agents } = setup(scenario, 1, { stubOnTurn: 1 });
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 2, emit: (e) => events.push(e) });

    expect(gm.prompts.map((p) => p.label)).toEqual(['setup', 'turn 1 resolve', 'turn 1 resolve (correction 1)']);
    expect(events.filter((e) => e.type === 'correction')).toEqual([
      expect.objectContaining({ agent: 'gm', label: 'turn 1 resolve', problems: expect.stringContaining('blue-flagship') }),
    ]);
    // The corrected reply accounts for every unit, so the engine keeps nobody in place.
    expect(events.filter((e) => e.type === 'engine')).toEqual([]);
  });

  it("corrects a GM's illegal move itself, and tells the GM next turn instead of sending the turn back", async () => {
    const { gm, agents } = setup(scenario, 99, { speedingOnTurn: 1 });
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents, maxRounds: 2, emit: (e) => events.push(e) });

    expect(events.filter((e) => e.type === 'correction')).toEqual([]);
    expect(events.filter((e) => e.type === 'engine')).toEqual([
      expect.objectContaining({ turn: 1, adjustments: [expect.stringContaining('blue-line moved to (0, 2), but getting from (-2, 2) to (0, 2) takes 2 steps')] }),
    ]);
    const nextResolve = gm.prompts.find((p) => p.label === 'turn 2 resolve')?.prompt ?? '';
    expect(nextResolve).toContain('The engine corrected your last resolution');
    expect(nextResolve).toContain('blue-line moved to (0, 2)');
    expect(nextResolve).toMatch(/\| `blue-line` \| blue \| fleet \| \(-1, \d\) \|/);
  });

  it("debriefs the GM in a new conversation, with the game's record instead of its turns", async () => {
    const { gmDebriefers, agents } = setup(scenario, 2);
    await runPlaytest({ scenario, agents, maxRounds: 10, emit: () => undefined });

    const debrief = gmDebriefers[0]?.prompts[0]?.prompt ?? '';
    expect(debrief).toContain('Blue wins');
    expect(debrief).toContain('state 2');
    expect(debrief).toContain('[invented] (MOVE-03) pass-through → they fight');
    expect(debrief).toContain('Turn 1, blue: what is age?');
    expect(debrief).toContain('Step out of the GM role');
    expect(debrief).not.toContain('Resolve turn');
    expect(debrief).not.toContain('<debrief_feedback>');
  });

  /** A GM debriefer that rejects its first `failures` debriefs with `error`. */
  const failingDebriefs = (agents: PlaytestAgents, failures: number, error: string) => {
    let attempts = 0;
    const newGmDebriefer = () => {
      const agent = agents.newGmDebriefer();
      return {
        id: agent.id,
        send: (label: string, prompt: string, schema?: JsonSchema) =>
          ++attempts <= failures ? Promise.reject(new Error(error)) : agent.send(label, prompt, schema),
      };
    };
    return { agents: { ...agents, newGmDebriefer }, attempts: () => attempts };
  };

  it("asks again in a new conversation when the model's safeguards decline the GM's debrief", async () => {
    const { agents } = setup(scenario, 1);
    const failing = failingDebriefs(agents, 1, 'claude exited with code 1: {"stop_reason":"refusal"}');
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents: failing.agents, maxRounds: 1, emit: (e) => events.push(e) });

    expect(failing.attempts()).toBe(2);
    expect(events.filter((e) => e.type === 'gm_feedback')).toHaveLength(1);
    expect(events).toContainEqual({
      type: 'warning',
      message: "The model's safeguards declined the GM's debrief, so it was asked again in a new conversation.",
    });
  });

  it("keeps everyone else's feedback, and still writes the report, when one debrief fails", async () => {
    const { agents } = setup(scenario, 1);
    const failing = failingDebriefs(agents, 2, 'safeguards flagged this message\n{"details":1}');
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents: failing.agents, maxRounds: 1, emit: (e) => events.push(e) });

    expect(failing.attempts()).toBe(2);
    expect(events.filter((e) => e.type === 'gm_feedback')).toEqual([]);
    expect(events.filter((e) => e.type === 'player_feedback')).toHaveLength(2);
    expect(events).toContainEqual({
      type: 'warning',
      message: "The GM's debrief failed, so it is missing: safeguards flagged this message (declined by the model's safeguards)",
    });
    expect(events.at(-1)).toEqual({ type: 'synthesis', report: 'REPORT' });
  });

  it("doesn't retry a GM debrief that failed for any other reason", async () => {
    const { agents } = setup(scenario, 1);
    const failing = failingDebriefs(agents, 1, 'network down');
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario, agents: failing.agents, maxRounds: 1, emit: (e) => events.push(e) });

    expect(failing.attempts()).toBe(1);
    expect(events).toContainEqual({ type: 'warning', message: "The GM's debrief failed, so it is missing: network down" });
  });
});

describe('runPlaytest with matter (Ycnetal)', () => {
  let ycnetal: Scenario;
  beforeAll(async () => {
    ycnetal = await loadScenario(findWorkspaceRoot(__dirname), 'ycnetal');
  });

  it('loads every scenario the repo ships', async () => {
    for (const name of ['the-hunt', 'the-blockade', 'ycnetal']) {
      await expect(loadScenario(findWorkspaceRoot(__dirname), name)).resolves.toMatchObject({ units: expect.any(Array) });
    }
    expect(ycnetal.units.some((u) => u.class === 'mine')).toBe(true);
  });

  it('judges Produce itself, builds the unit, and tells players only their balance and output', async () => {
    const { blue, red, gm, agents } = setup(ycnetal, 99, {
      orders: { 'blue:turn 1': [{ unit: 'Blue Mine Thgil', order: 'Produce(probe)', delivery: 'light' }] },
    });
    const events: PlaytestEvent[] = [];
    await runPlaytest({ scenario: ycnetal, agents, maxRounds: 2, emit: (e) => events.push(e) });

    const gmTurn1 = gm.prompts.find((p) => p.label === 'turn 1 resolve')?.prompt ?? '';
    expect(gmTurn1).toContain('Produce orders (the engine judged these');
    expect(gmTurn1).toContain('probe');
    const production = events.filter((e) => e.type === 'production');
    expect(production.length).toBeGreaterThan(0);
    expect(JSON.stringify(production)).toContain('completed probe');

    const blueTurn2 = blue.prompts.find((p) => p.label === 'turn 2')?.prompt ?? '';
    expect(blueTurn2).toContain('## Matter');
    // The Matter section is the balance and total output only; the yard's own news reaches Blue as messages and sensor reports (LIGHT-18).
    const matterSection = blueTurn2.slice(blueTurn2.indexOf('## Matter'), blueTurn2.indexOf('## Messages received'));
    expect(matterSection).toBe("## Matter\n\nBalance: 10 matter.\nOutput: 3 matter a turn, as of last turn's Economy phase.\n\n");
    // Before the game ends and the fog lifts, Red hears nothing of Blue's yard.
    const redSaw = red.prompts.filter((p) => p.label.startsWith('turn')).map((p) => p.prompt).join('\n');
    expect(redSaw).not.toMatch(/Produce\(|blue-probe-2|blue-mine-thgil|Blue Mine/);
    expect(events.filter((e) => e.type === 'matter').length).toBe(2);
  });
});
