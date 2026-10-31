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
| `src/missions` | Mission runner, rescue winch, medals |
| `src/heli` | Flight model, helicopter specs, models and rotors |
| `src/world` | Terrain generation (desert, coast), wind, collision, crowd behaviour |
| `src/render` | Renderer, isometric camera, terrain, water, props and mission visuals |
| `src/fx` | Particle effects (dust, smoke, fire) |
| `src/input` | Keyboard bindings |
| `src/audio` | Synthesised rotor sound |
| `src/ui` | HUD and menus |
| `tests` | Vitest unit tests: flight model, missions, winch, progress, input, camera maths, world and level data |

## Missions

| # | Mission | Aircraft | Skill | Status |
|---|---|---|---|---|
| 1 | Flight School | Kestrel K-1 | Basic control and landing | Playable |
| 2 | Search and Rescue | Albatross HAR-3 | Precise hovering in wind | Playable |
| 3 | Heavy Lift | Hauler CH-4 (twin rotor) | Swinging underslung loads | Planned |
| 4 | Wildfire | Bucketeer UH-2 | Route planning and timing | Planned |
| 5 | Mountain Rescue | Chamois AS-5 | Terrain flying in thin air | Planned |
| 6 | Night Medevac | Lifeline EC-1 | Speed and tight landings | Planned |
| 7 | Sky Crane | Mantis S-64 | Precise placement | Planned |
| 8 | Convoy Escort | Viper AH-6 | Combat and awareness | Planned |

Missions unlock in order. Best times and medals are saved in the browser's local storage.

## Adding a level

A level is a `LevelDef` in `src/levels/`: terrain config, buildings, pads, roads, crowds, scenery, optional sea and wind, and a `MissionDef` with an ordered list of objectives (`takeoff`, `hover`, `gates`, `land`, `rescue`, `deliver`). Add it to `CAMPAIGN` in `src/levels/index.ts`; `tests/levels.test.ts` checks the data automatically.
