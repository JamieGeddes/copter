# Copter

A browser-based isometric helicopter game. Each level puts you in a different helicopter on a different mission.

## Running

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests
npm run build    # production build in dist/
```

## Controls

| Keys | Action |
|---|---|
| W A S D or cursor keys | Fly (screen-relative) |
| Space / Q | Climb |
| Shift / Z | Descend |
| + / − / mouse wheel | Zoom |
| E | Release slung load / drop bucket water |
| L | Toggle height line |
| M | Mute |
| P / Esc | Pause |
| H | Toggle help |
| Enter | Confirm / start |
| R / X (paused) | Restart / quit to missions |

## Structure

| Folder | Contents |
|---|---|
| `src/core` | App state machine (menus, progress), level session |
| `src/levels` | Level and mission data, campaign order |
| `src/missions` | Mission runner, rescue winch, slung cargo, water bucket, medals |
| `src/heli` | Flight model, helicopter specs, models and rotors |
| `src/world` | Terrain generation (desert, coast, floodplain, forest), wind, collision, crowd behaviour, fire spread model and fuel map |
| `src/render` | Renderer, isometric camera, terrain, water, props, mission, bucket and fire visuals |
| `src/fx` | Particle effects (dust, smoke, fire) |
| `src/input` | Keyboard bindings |
| `src/audio` | Synthesised rotor sound |
| `src/ui` | HUD and menus |
| `tests` | Vitest unit tests: flight model, missions, winch, progress, input, camera maths, world, fire and level data |

## Missions

| # | Mission | Aircraft | Skill | Status |
|---|---|---|---|---|
| 1 | Flight School | Kestrel K-1 | Basic control and landing | Playable |
| 2 | Search and Rescue | Albatross HAR-3 | Precise hovering in wind | Playable |
| 3 | Heavy Lift | Hauler CH-4 (twin rotor) | Swinging underslung loads | Playable |
| 4 | Wildfire | Bucketeer FH-2 | Route planning and timing | Playable |
| 5 | Mountain Rescue | Chamois AS-5 | Terrain flying in thin air | Planned |
| 6 | Night Medevac | Lifeline EC-1 | Speed and tight landings | Planned |
| 7 | Sky Crane | Mantis S-64 | Precise placement | Planned |
| 8 | Convoy Escort | Viper AH-6 | Combat and awareness | Planned |

Missions unlock in order. Best times and medals are saved in the browser's local storage.

## Adding a level

A level is a `LevelDef` in `src/levels/`: terrain config, buildings, pads, roads, crowds, scenery, optional sea and wind, and a `MissionDef` with an ordered list of objectives (`takeoff`, `hover`, `gates`, `land`, `rescue`, `deliver`, `hook`, `place`, `fill`, `protect`, `extinguish`). Add it to `CAMPAIGN` in `src/levels/index.ts`; `tests/levels.test.ts` checks the data automatically.

## Wildfire

The fire is a grid over the terrain (`src/world/FireGrid.ts`, one cell per terrain vertex). Each cell has fuel, heat, wetness and a burning or burnt state. Burning cells heat their neighbours, which ignite once enough heat has built up; spread is faster uphill and downwind. Water wets cells so they resist ignition for a while, and puts out burning ones. `src/world/fuel.ts` builds the fuel map from the level: woodland and grass burn, buildings burn well, and water, rock, roads, pads and firebreaks do not. A level opts in with a `fire` definition (ignition points, head start, firebreaks and bonus assets). The model is pure and deterministic, and `tests/fireGrid.test.ts` and `tests/wildfire.test.ts` cover it.

The Bucketeer's bucket (`src/missions/Bucket.ts`) fills in about two seconds when dipped in water at low speed, and E drops a spray cone. The `protect` objective fails the mission as soon as any cell inside its zone burns.
