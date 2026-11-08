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
| F | Searchlight: auto, locked ahead or off (Night Medevac) |
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
| `src/missions` | Mission runner, rescue winch, landing pickups, casualty queue, slung cargo, water bucket, medals |
| `src/heli` | Flight model, helicopter specs, models and rotors |
| `src/world` | Terrain generation (desert, coast, floodplain, forest, alpine, city), city layout, traffic, wind (mountain air, gusts between towers), wires, collision, crowd behaviour, fire spread model and fuel map |
| `src/render` | Renderer, isometric camera, terrain, water, props, lit windows, night lights, searchlight, traffic, cloud layer, mission, incident, bucket and fire visuals |
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
| 5 | Mountain Rescue | Chamois AS-5 | Terrain flying in thin air | Playable |
| 6 | Night Medevac | Lifeline EC-1 | Speed and tight landings | Playable |
| 7 | Sky Crane | Mantis S-64 | Precise placement | Planned |
| 8 | Convoy Escort | Viper AH-6 | Combat and awareness | Planned |

Missions unlock in order. Best times and medals are saved in the browser's local storage.

## Adding a level

A level is a `LevelDef` in `src/levels/`: terrain config, buildings, pads, roads, crowds, scenery, optional sea and wind, and a `MissionDef` with an ordered list of objectives (`takeoff`, `hover`, `gates`, `land`, `rescue`, `deliver`, `hook`, `place`, `fill`, `protect`, `extinguish`, `casualties`). Add it to `CAMPAIGN` in `src/levels/index.ts`; `tests/levels.test.ts` checks the data automatically.

## Wildfire

The fire is a grid over the terrain (`src/world/FireGrid.ts`, one cell per terrain vertex). Each cell has fuel, heat, wetness and a burning or burnt state. Burning cells heat their neighbours, which ignite once enough heat has built up; spread is faster uphill and downwind. Water wets cells so they resist ignition for a while, and puts out burning ones. `src/world/fuel.ts` builds the fuel map from the level: woodland and grass burn, buildings burn well, and water, rock, roads, pads and firebreaks do not. A level opts in with a `fire` definition (ignition points, head start, firebreaks and bonus assets). The model is pure and deterministic, and `tests/fireGrid.test.ts` and `tests/wildfire.test.ts` cover it.

The Bucketeer's bucket (`src/missions/Bucket.ts`) fills in about two seconds when dipped in water at low speed, and E drops a spray cone. The `protect` objective fails the mission as soon as any cell inside its zone burns.

## Mountain Rescue

Grauhorn uses the `alpine` terrain kind: a valley rising to a ridge with spurs, peaks, a cliff band and a glacier, coloured from meadow and pine woods through scree and rock to snow.

- **Thin air:** an aircraft with a `serviceCeiling` loses thrust linearly with altitude (`liftAtAltitude` in `src/heli/FlightModel.ts`). Climb rate follows spare thrust, and with none it sinks. Ground effect and translational lift add a little. The HUD power gauge shows the margin.
- **Mountain wind:** `World.windAt(x, z, y)` lifts air blowing up a slope and sinks it on the way down, fading with height; downwind of higher ground the wind drops and churns. A level opts in with `wind.orographic`.
- **Rotor strike:** with `rotorStrike` on, rock rising into the disc knocks the aircraft back and damages it, or destroys it at speed. A terrain warning shows the direction and gap, and beeps faster as it closes. Cable car wires are fatal.
- **Pickups and trips:** survivors with `pickup: 'landing'` walk to an aircraft landed nearby (`src/missions/Boarding.ts`); others need the winch. During a `rescue` followed by a `deliver`, landing on the delivery pad unloads passengers, so missions can need several trips.
- **Weather:** a mission `weather` lowers the cloud base over time. Too long in cloud fails the mission, as does cloud reaching a site with survivors still waiting. Everything above the base fades into cloud via a shared shader uniform (`src/render/cloud.ts`).

`tests/mountain.test.ts` covers these, plus the Grauhorn balance (loaded summit hovers are impossible, sites close top first).

## Night Medevac

Varrow uses the `city` terrain kind: level paved ground, parks and a river between embankment walls. `planCity` (`src/world/cityPlan.ts`) lays out a street grid split by the river, with bridges on some streets, and fills the blocks with lots whose buildings rise towards downtown: office towers, flats and terraced houses. Special sites (hospitals, stadium, the scenes) are reserved and placed by hand.

- **Calls:** a `casualties` objective runs the queue in `src/missions/Medevac.ts`. Calls come in on a schedule, or a few seconds early when the crew is idle, so they overlap. One casualty fits in the cabin: land inside the cordon to load them, then on the roof pad of the hospital that treats them (trauma or burns). A casualty whose timer runs out before the handover begins is lost and the mission fails. Handovers inside the golden window count towards the result, and gold needs every one.
- **Night:** dim moonlight and procedural lit windows (`src/render/windows.ts`), sodium street lamps with pools of light, lit pads with edge lights, a floodlit stadium, and red obstruction lights on cranes, masts, pylons and the tallest towers (`src/render/night.ts`). Glows are additive points sized in metres; there is no bloom pass.
- **Searchlight:** a shadow-casting spot light with a visible beam (`src/render/Searchlight.ts`). In auto mode it swings onto the scene or hospital being flown to once within range, otherwise it lights the ground ahead. F cycles auto, locked ahead and off. It is keyboard-controlled, in line with the keyboard-only controls.
- **Traffic:** cars drive loops along each road and keep left (`src/world/Traffic.ts`), keeping their distance and queuing behind a scene that closes the road.
- **Wires:** cableways now come in three kinds: cable car, power lines and crane jibs. Any of them in the rotor is fatal, and a WIRES warning shows the direction and gap as one gets close.
- **Wind between towers:** with `wind.channel`, wind along a street between tall buildings speeds up and gusts, and drops but churns in a tower's lee.

`tests/medevac.test.ts` covers the casualty queue and objective, traffic, city wind, wires, the city layout and the Varrow balance (scenes clear of obstacles and wires, both hospitals used, calls that overlap but can be answered in time).
