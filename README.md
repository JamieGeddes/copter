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
| Enter | Start / restart |

## Structure

| Folder | Contents |
|---|---|
| `src/heli` | Flight model, helicopter specs, models and rotors |
| `src/world` | Terrain generation, level layout, collision, crowd behaviour |
| `src/render` | Renderer, isometric camera, terrain and prop meshes |
| `src/fx` | Particle effects (dust, smoke, fire) |
| `src/input` | Keyboard bindings |
| `src/audio` | Synthesised rotor sound |
| `src/ui` | HUD and menus |
| `tests` | Vitest unit tests for the flight model, input, camera maths and world |

## Status

Phase 1: flight prototype. One helicopter (Kestrel K-1 trainer) in a free-flight desert level with four helipads to land on.
