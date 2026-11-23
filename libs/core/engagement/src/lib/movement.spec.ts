import { afterStep, isEngaged, startMovement } from './movement';
import { at, hex, situation, unit } from './fixtures.spec-helper';

describe('afterStep (MOVE-03)', () => {
  const raider = unit('blue-raider', 'blue', 'fleet', hex(3, 0), 2);
  const line = unit('red-line', 'red', 'fleet', hex(0, 0));
  const attack = { 'blue-raider': { order: { kind: 'attack' as const, target: 'red-line' } } };

  it('engages two hostile units within ENGAGE_RANGE when one is willing, and records why', () => {
    const step1 = afterStep(startMovement(), situation([at(raider, 2, 0), at(line, 1, 0)], attack));
    expect(step1.engagements).toEqual([{ step: 1, a: { unit: 'blue-raider', reasons: ['attack'] }, b: { unit: 'red-line', reasons: [] } }]);
    expect(isEngaged(step1.state, 'blue-raider')).toBe(true);
    expect(step1.state.stoppedAt['red-line']).toEqual(hex(1, 0));
  });

  it('doesn’t engage when neither side is willing: a spoofed fleet passes an enemy flagship', () => {
    const flagship = unit('red-flagship', 'red', 'flagship', hex(0, 0));
    const spoofed = { 'blue-raider': { spoofed: true, order: { kind: 'attack' as const, target: 'red-flagship' } } };
    const result = afterStep(startMovement(), situation([at(raider, 0, 0), flagship], spoofed));
    expect(result.engagements).toEqual([]);
  });

  it('engages units that started adjacent only once a step ends, even if nothing moved', () => {
    const adjacent = situation([at(raider, 1, 0), line], { 'red-line': { stance: 'aggressive' } });
    const state = startMovement();
    expect(isEngaged(state, 'red-line')).toBe(false);
    expect(afterStep(state, adjacent).engagements).toHaveLength(1);
  });

  it('stops engaged units: a later position for one is put back and recorded as a correction', () => {
    const step1 = afterStep(startMovement(), situation([at(raider, 1, 0), line], attack));
    const step2 = afterStep(step1.state, situation([at(raider, 0, 0), line], attack));
    expect(step2.corrections).toEqual([{ step: 2, unit: 'blue-raider', movedTo: hex(0, 0), stoppedAt: hex(1, 0) }]);
    expect(step2.units.find((u) => u.id === 'blue-raider')?.hex).toEqual(hex(1, 0));
  });

  it('engages a pair once, but lets a stopped unit engage newcomers in later steps', () => {
    const second = unit('blue-raider-2', 'blue', 'fleet', hex(-2, 0), 2);
    const both = { ...attack, 'blue-raider-2': { order: { kind: 'attack' as const, target: 'red-line' } } };
    const step1 = afterStep(startMovement(), situation([at(raider, 1, 0), line, second], both));
    expect(step1.engagements.map((e) => [e.a.unit, e.b.unit])).toEqual([['blue-raider', 'red-line']]);
    const step2 = afterStep(step1.state, situation([at(raider, 1, 0), line, at(second, -1, 0)], both));
    expect(step2.engagements.map((e) => [e.a.unit, e.b.unit, e.step])).toEqual([['red-line', 'blue-raider-2', 2]]);
    expect(step2.state.engagements).toHaveLength(2);
  });

  it('uses positions at the end of the step: a Defend clause holds only once the enemy is near the defended hex', () => {
    const defender = unit('red-line', 'red', 'fleet', hex(0, 0));
    const decisions = { 'red-line': { order: { kind: 'defend' as const, hex: hex(-1, 0) } } };
    // At (1, 0) the raider is 2 from the defended hex: not yet.
    expect(afterStep(startMovement(), situation([at(raider, 1, 0), defender], decisions)).engagements).toEqual([]);
  });
});
