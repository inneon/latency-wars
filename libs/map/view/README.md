# map-view

The star system's hex map, drawn in React and SVG. It knows hexes, units and overlays, and nothing about play-tests, events or the rules beyond the map's shape (`SPACE-01`, `SPACE-05`).

```tsx
<HexMap radius={6} features={features} colours={ownerColours(['blue', 'red'])} label="The Hunt, end of turn 3" onSelect={setHex}>
  <Coverage areas={areas} />
  <Links links={links} />
  <Moves moves={moves} />
  <Losses losses={losses} />
  <Units units={units} />
</HexMap>
```

`HexMap` draws the disc, the star and the named features; everything else is a layer passed as a child, drawn bottom first. A page adds layers of its own the same way.

| Layer | Draws |
|---|---|
| `Coverage` | A tint over the hexes each owner's sensors reach (`sensorCoverage` works them out) |
| `Links` | Lines between pairs of hexes, such as a web's links |
| `Moves` | An arrow from where units began the turn to where they ended; units that made the same move share one |
| `Losses` | A cross where an owner lost units |
| `Units` | One marker for each owner's fleets in a hex and one for their nodes: its most important unit's shape, the strength it adds up to and a count. A dashed ring is drawn for each owner in `sightedBy` |

`layout.ts` is the geometry and grouping with no rendering in it (`hexCenter`, `hexCorners`, `discHexes`, `stackTokens`, `mergeSegments`), so another renderer can draw from the same layout.

Colours are CSS custom properties with built-in fallbacks: `--lw-map-space`, `--lw-map-grid`, `--lw-map-ink`, `--lw-map-faint`, `--lw-map-star`, `--lw-map-zone`, `--lw-map-planet`. Set them on or above the map to restyle it.

Import with `@latency-wars/map-view`. Consumer: `apps/web` (the replay page).

Run `nx test map-view` for the unit tests.
