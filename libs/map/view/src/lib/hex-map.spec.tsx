import { fireEvent, render, screen } from '@testing-library/react';
import { Command, Coverage, HexMap, Links, Losses, Moves, ownerColours, Seizes, Units } from './hex-map';

const colours = ownerColours(['blue', 'red']);

describe('HexMap', () => {
  it('draws the disc, the features by name, and coordinates when asked', () => {
    const { container, rerender } = render(
      <HexMap radius={2} label="The test system" features={[{ name: 'Pocket A', kind: 'zone', hex: { q: 0, r: 1 } }, { name: 'Inner', kind: 'planet', hex: { q: 1, r: 0 } }]} />,
    );
    expect(screen.getByRole('group', { name: 'The test system' })).toBeTruthy();
    expect(container.querySelectorAll('polygon.lw-hex')).toHaveLength(19);
    expect(screen.getByText('Pocket A')).toBeTruthy();
    // A long name is written on two lines.
    rerender(<HexMap radius={2} label="The test system" features={[{ name: 'Magnetosphere pocket A', kind: 'zone', hex: { q: 0, r: 1 } }]} />);
    expect(screen.getByText('Magnetosphere')).toBeTruthy();
    expect(screen.getByText('pocket A')).toBeTruthy();
    rerender(<HexMap radius={2} label="The test system" features={[{ name: 'Inner', kind: 'planet', hex: { q: 1, r: 0 } }]} />);
    expect(screen.getByText('Inner')).toBeTruthy();
    expect(screen.queryByText('-2,1')).toBeNull();

    rerender(<HexMap radius={2} label="The test system" coordinates />);
    expect(screen.getByText('-2,1')).toBeTruthy();
  });

  it('tells the page which hex was chosen, by the hex or by a marker in it', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <HexMap radius={2} label="map" colours={colours} onSelect={onSelect} selected={{ q: 1, r: 0 }}>
        <Units units={[{ id: 'blue-flagship', name: 'Blue Flagship', owner: 'blue', hex: { q: -1, r: 0 }, shape: 'flagship', strength: 3 }]} />
      </HexMap>,
    );
    fireEvent.click(container.querySelector('[data-hex="1,-1"]') as Element);
    expect(onSelect).toHaveBeenLastCalledWith({ q: 1, r: -1 });

    const marker = screen.getByRole('button', { name: 'blue: Blue Flagship at (-1, 0)' });
    fireEvent.click(marker);
    expect(onSelect).toHaveBeenLastCalledWith({ q: -1, r: 0 });
    fireEvent.keyDown(marker, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(container.querySelector('[data-selected="1,0"]')).toBeTruthy();
  });

  it('stacks a crowded hex into one marker per owner, with a count', () => {
    const fleet = (id: string, owner: string) => ({ id, owner, hex: { q: 0, r: 1 }, shape: 'fleet' as const, strength: 2 });
    const { container } = render(
      <HexMap radius={2} label="map" colours={colours} onSelect={() => undefined}>
        <Units units={[fleet('b1', 'blue'), fleet('b2', 'blue'), fleet('b3', 'blue'), { ...fleet('r1', 'red'), joined: true, sightedBy: ['blue'] }]} />
      </HexMap>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(2);
    const blue = screen.getByRole('button', { name: 'blue: b1, b2, b3 at (0, 1)' });
    expect(blue.querySelector('[data-count="3"]')).toBeTruthy();
    expect(blue.textContent).toContain('6');
    const red = screen.getByRole('button', { name: 'red: r1 at (0, 1)' });
    expect(red.querySelector('[data-count]')).toBeNull();
    expect(red.querySelector('[data-joined]')).toBeTruthy();
    expect(red.querySelector('[data-sighted-by="blue"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-token]')).toHaveLength(2);
  });

  it('draws moves, losses, links and sensor coverage as layers', () => {
    const a = { q: 0, r: 1 };
    const b = { q: 1, r: 1 };
    const { container } = render(
      <HexMap radius={2} label="map" colours={colours}>
        <Coverage areas={[{ owner: 'blue', hexes: [a, b] }]} />
        <Links links={[{ owner: 'red', from: a, to: b, weight: 1 }]} />
        <Moves moves={[{ owner: 'blue', from: a, to: b }, { owner: 'blue', from: a, to: b }, { owner: 'red', from: b, to: a }, { owner: 'red', from: a, to: a }]} />
        <Losses losses={[{ owner: 'red', hex: b }, { owner: 'red', hex: b }]} />
      </HexMap>,
    );
    expect(container.querySelectorAll('[data-coverage="blue"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-link="red"]')).toHaveLength(1);
    // Two units moving together are one arrow; a move that goes nowhere is none.
    expect(container.querySelectorAll('[data-move]')).toHaveLength(2);
    const loss = container.querySelector('[data-loss="red"]');
    expect(loss?.textContent).toBe('2');
  });

  it('draws a held unit in its holder\'s colour, and says so', () => {
    const { container } = render(
      <HexMap radius={2} label="map" colours={colours} onSelect={() => undefined}>
        <Units units={[{ id: 'blue-raider', name: 'Blue Raider', owner: 'blue', hex: { q: 1, r: 0 }, shape: 'fleet', strength: 2, heldBy: 'red' }]} />
      </HexMap>,
    );
    const marker = screen.getByRole('button', { name: "blue: Blue Raider at (1, 0), under red's command" });
    expect(marker.getAttribute('data-held-by')).toBe('red');
    // Filled red, rimmed blue.
    const style = container.querySelector('[data-held-by="red"] circle')?.getAttribute('style') ?? '';
    expect(style).toMatch(/fill: (#ff6b5e|rgb\(255, 107, 94\))/);
    expect(style).toMatch(/stroke: (#5aa9ff|rgb\(90, 169, 255\))/);
  });

  it('draws each seize by what became of it, and each shaken or captured flagship', () => {
    const { container } = render(
      <HexMap radius={3} label="map" colours={colours}>
        <Seizes
          seizes={[
            { by: 'blue', from: { q: -2, r: 0 }, to: { q: 1, r: 0 }, outcome: 'landed' },
            { by: 'red', from: { q: 2, r: 0 }, to: { q: -2, r: 0 }, outcome: 'blocked', label: '5 vs 6.5' },
            { by: 'blue', from: { q: -2, r: 0 }, to: { q: 2, r: -1 }, at: { q: 2, r: 0 }, outcome: 'missed' },
            { by: 'red', to: { q: 0, r: 2 }, outcome: 'landed' },
          ]}
        />
        <Command
          marks={[
            { hex: { q: 2, r: 0 }, by: 'blue', stage: 'shaken', label: 'Shaken by blue' },
            { hex: { q: -2, r: 0 }, by: 'red', stage: 'captured' },
          ]}
        />
      </HexMap>,
    );
    const outcomes = [...container.querySelectorAll('[data-seize]')].map((g) => g.getAttribute('data-seize'));
    expect(outcomes).toEqual(['landed', 'blocked', 'missed', 'landed']);
    // A seize with no sender drawn is only its end.
    expect(container.querySelectorAll('[data-seize] path')).toHaveLength(3);
    expect(screen.getByText('5 vs 6.5')).toBeTruthy();
    // The missed seize points on to where the flagship really was.
    expect(container.querySelector('[data-seize="missed"] line')).toBeTruthy();
    expect(container.querySelector('[data-command="shaken"]')?.textContent).toBe('Shaken by blue');
    expect(container.querySelectorAll('[data-command="captured"] circle')).toHaveLength(2);
  });

  it('refuses a layer drawn outside a map', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Units units={[]} />)).toThrow('inside a <HexMap>');
    error.mockRestore();
  });
});
