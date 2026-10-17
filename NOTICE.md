# Avisos de terceros

GO Vault usa datos y código de los siguientes proyectos:

## PvPoke — MIT
Fuente: https://github.com/pvpoke/pvpoke
Datos (`gamemaster/*.json`, `rankings/**`) y, en la Fase 7, el simulador de combate portado a TypeScript.

```
MIT License

Copyright (c) PvPoke contributors (https://github.com/pvpoke/pvpoke/graphs/contributors)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## PokeMiners / game_masters
Fuente: https://github.com/PokeMiners/game_masters (`latest/latest.json`).
Datos extraídos del propio juego (costos de mejora, multiplicadores, estadísticas base, evoluciones).
El repositorio no declara licencia; solo se usan datos factuales del juego, descargados por el script `data:fetch`.

## PokeAPI
- Datos (nombres en español): https://github.com/PokeAPI/pokeapi — BSD-3-Clause.
- Sprites: https://github.com/PokeAPI/sprites — se cargan por URL (no se redistribuyen); los sprites son propiedad de Nintendo / Game Freak / The Pokémon Company.

## Marcas
Pokémon y Pokémon GO son marcas de Nintendo, Creatures Inc., GAME FREAK inc. y Niantic. GO Vault es un proyecto de fans sin afiliación; no automatiza el juego ni maneja credenciales de Niantic.

## Archivos de PvPoke incluidos en el repositorio
`tests/vendor/pvpoke/` contiene copias sin modificar de `Battle.js`, `DamageCalculator.js`, `ActionLogic.js`, `TimelineEvent.js`, `TimelineAction.js`, `Pokemon.js` y un fragmento de `GameMaster.js` (PvPoke, MIT, © PvPoke contributors). Se usan solo en las pruebas como referencia del simulador. `src/sim/` es un port a TypeScript derivado de ese código (misma licencia MIT).
