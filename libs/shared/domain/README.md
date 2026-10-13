# domain

The few types every part of the game shares, and nothing else (YAGNI applies):

- `Hex` with `hexDistance` (`SPACE-05`), `hexEquals`, `formatHex`.
- `PlayerId`, `UnitId`, `UnitClass`, and `Unit`: the minimum a unit on the map has (owner, class, hex, speed, sensor range). Libraries that need more take `U extends Unit`.

Import with `@latency-wars/domain`. Add to it only when a second library needs the same type.

Run `nx test domain` for the unit tests.
