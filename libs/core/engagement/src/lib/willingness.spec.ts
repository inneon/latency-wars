import { hex, situation, unit } from './fixtures.spec-helper';
import { isWilling, willingness } from './willingness';

const raider = unit('blue-raider', 'blue', 'fleet', hex(1, 0));
const line = unit('red-line', 'red', 'fleet', hex(0, 0));
const redFlagship = unit('red-flagship', 'red', 'flagship', hex(0, 0));
const redMine = unit('red-mine', 'red', 'mine', hex(0, 1));
const blueFlagship = unit('blue-flagship', 'blue', 'flagship', hex(1, 0));

describe('willingness (MOVE-04)', () => {
  it('is never willing against a unit of its own side', () => {
    const friend = unit('blue-line', 'blue', 'fleet', hex(1, 0));
    expect(willingness(situation([raider, friend], { 'blue-raider': { stance: 'aggressive' } }), raider, friend)).toEqual({ willing: false, reasons: [] });
  });

  it('with no order and a Balanced stance, a fleet is willing only against fleets and flagships in its own hex', () => {
    const s = situation([raider, line, redFlagship, redMine]);
    expect(isWilling(s, raider, line)).toBe(false);
    const sharing = situation([{ ...raider, hex: hex(0, 0) }, line, redFlagship]);
    expect(willingness(sharing, { ...raider, hex: hex(0, 0) }, line).reasons).toEqual(['same-hex']);
    expect(willingness(sharing, { ...raider, hex: hex(0, 0) }, redFlagship).reasons).toEqual(['same-hex']);
  });

  it('the same-hex clause never covers a structure', () => {
    const onMine = { ...raider, hex: hex(0, 1) };
    expect(isWilling(situation([onMine, redMine]), onMine, redMine)).toBe(false);
  });

  it('Attack makes a fleet willing against its target only, at any distance', () => {
    const far = { ...raider, hex: hex(5, 0) };
    const s = situation([far, line, redFlagship], { 'blue-raider': { order: { kind: 'attack', target: 'red-flagship' } } });
    expect(willingness(s, far, redFlagship).reasons).toEqual(['attack']);
    expect(isWilling(s, far, line)).toBe(false);
  });

  it('Defend makes a fleet willing against any enemy within ENGAGE_RANGE of the defended hex', () => {
    const s = situation([raider, line], { 'blue-raider': { order: { kind: 'defend', hex: hex(-1, 0) } } });
    expect(willingness(s, raider, line).reasons).toEqual(['defend']);
    const s2 = situation([raider, line], { 'blue-raider': { order: { kind: 'defend', hex: hex(3, 0) } } });
    expect(isWilling(s2, raider, line)).toBe(false);
  });

  it('Escort makes a fleet willing against any enemy within ENGAGE_RANGE of its charge, whatever that enemy’s orders', () => {
    const escort = unit('red-escort', 'red', 'fleet', hex(-2, 0));
    const s = situation([escort, redFlagship, raider], { 'red-escort': { order: { kind: 'escort', charge: 'red-flagship' } } });
    expect(willingness(s, escort, raider).reasons).toEqual(['escort']);
    const away = { ...raider, hex: hex(3, 0) };
    expect(isWilling(situation([escort, redFlagship, away], s.decisions), escort, away)).toBe(false);
  });

  it('an escort whose charge is gone has no escort clause', () => {
    const escort = unit('red-escort', 'red', 'fleet', hex(1, 1));
    expect(isWilling(situation([escort, raider], { 'red-escort': { order: { kind: 'escort', charge: 'red-flagship' } } }), escort, raider)).toBe(false);
  });

  it('an Aggressive stance makes a fleet willing against any enemy unit within ENGAGE_RANGE, structures and flagships included', () => {
    const s = situation([raider, line, redFlagship, redMine], { 'blue-raider': { stance: 'aggressive' } });
    expect(willingness(s, raider, line).reasons).toEqual(['aggressive']);
    expect(willingness(s, raider, redFlagship).reasons).toEqual(['aggressive']);
    expect(willingness(s, raider, redMine).reasons).toEqual(['aggressive']);
    const far = { ...raider, hex: hex(3, 0) };
    expect(isWilling(situation([far, line], s.decisions), far, line)).toBe(false);
  });

  it('lists every clause that holds', () => {
    const sharing = { ...raider, hex: hex(0, 0) };
    const s = situation([sharing, line], { 'blue-raider': { stance: 'aggressive', order: { kind: 'attack', target: 'red-line' } } });
    expect(willingness(s, sharing, line).reasons).toEqual(['attack', 'aggressive', 'same-hex']);
  });

  it('a flagship and a structure are never willing (FLAG-01)', () => {
    const s = situation([blueFlagship, line, redMine], { 'blue-flagship': { stance: 'aggressive' } });
    expect(willingness(s, blueFlagship, line)).toEqual({ willing: false, reasons: [], limit: 'flagship' });
    expect(willingness(s, redMine, blueFlagship)).toEqual({ willing: false, reasons: [], limit: 'structure' });
  });

  it('a spoofed fleet is never willing, even in an enemy’s hex (QBIT-02)', () => {
    const sharing = { ...raider, hex: hex(0, 0) };
    const s = situation([sharing, redFlagship], { 'blue-raider': { spoofed: true, order: { kind: 'attack', target: 'red-flagship' } } });
    expect(willingness(s, sharing, redFlagship)).toEqual({ willing: false, reasons: [], limit: 'spoofed' });
  });

  it('an evading fleet is willing only under the same-hex clause (AUTO-03)', () => {
    const decisions = { 'blue-raider': { evading: true, stance: 'evasive' as const, order: { kind: 'attack' as const, target: 'red-line' } } };
    expect(willingness(situation([raider, line], decisions), raider, line)).toEqual({ willing: false, reasons: [], limit: 'evading' });
    const sharing = { ...raider, hex: hex(0, 0) };
    expect(willingness(situation([sharing, line], decisions), sharing, line)).toEqual({ willing: true, reasons: ['same-hex'], limit: 'evading' });
  });

  it('a fleet a house rule makes unwilling is never willing, even in an enemy’s hex', () => {
    const probe = { ...raider, hex: hex(0, 0) };
    expect(willingness(situation([probe, line], { 'blue-raider': { unwilling: true, stance: 'aggressive' } }), probe, line)).toEqual({
      willing: false,
      reasons: [],
      limit: 'unwilling',
    });
  });
});
