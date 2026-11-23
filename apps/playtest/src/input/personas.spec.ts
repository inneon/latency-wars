import { findWorkspaceRoot } from './scenario-loader';
import { assignPersonas, loadPersonas, parsePersona, parsePersonaChoice } from './personas';

const players = [
  { id: 'blue', persona: 'bold' },
  { id: 'red', persona: 'careful' },
];

describe('personalities', () => {
  it('loads the library, each with its name and text', async () => {
    const library = await loadPersonas(findWorkspaceRoot(__dirname));
    expect([...library.keys()]).toEqual(expect.arrayContaining(['bold', 'careful', 'spymaster', 'admiral']));
    expect(library.get('spymaster')).toMatchObject({ id: 'spymaster', name: 'The Spymaster' });
    expect(library.get('spymaster')?.text).toContain('What you value');
  });

  it('needs a "# Name" heading', () => {
    expect(parsePersona('x', '# The X\n\nPlays like X.')).toEqual({ id: 'x', name: 'The X', text: 'Plays like X.' });
    expect(() => parsePersona('x', 'no heading')).toThrow('# Name');
  });

  it("gives each player the scenario's default, unless the run names another", async () => {
    const library = await loadPersonas(findWorkspaceRoot(__dirname));
    expect(assignPersonas(players, library).map((p) => p.persona.id)).toEqual(['bold', 'careful']);
    expect(assignPersonas(players, library, { red: 'industrialist' }).map((p) => p.persona.id)).toEqual(['bold', 'industrialist']);
    expect(() => assignPersonas(players, library, { green: 'bold' })).toThrow('not a player');
    expect(() => assignPersonas(players, library, { blue: 'pirate' })).toThrow('Unknown personality "pirate"');
  });

  it('draws a different personality for each player at random', async () => {
    const library = await loadPersonas(findWorkspaceRoot(__dirname));
    const drawn = assignPersonas(players, library, 'random', () => 0).map((p) => p.persona.id);
    expect(drawn).toHaveLength(2);
    expect(new Set(drawn).size).toBe(2);
  });

  it('reads the --persona option', () => {
    expect(parsePersonaChoice('random')).toBe('random');
    expect(parsePersonaChoice('blue=spymaster, red=industrialist')).toEqual({ blue: 'spymaster', red: 'industrialist' });
    expect(() => parsePersonaChoice('blue')).toThrow('Invalid --persona');
  });
});
