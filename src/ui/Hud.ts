import { formatTime } from '../missions/medals';

export interface HudState {
  altitude: number;
  speedKnots: number;
  verticalSpeed: number;
  fuel: number;
  damage: number;
  landed: boolean;
  servicing: boolean;
}

export interface MissionHudState {
  title: string;
  elapsed: number;
  timeLimit?: number;
  objectives: { text: string; state: 'done' | 'current' | 'todo' }[];
  detail: string;
  progress: number;
  passengers?: { aboard: number; capacity: number };
}

export interface FireHudState {
  /** 0..1, how close the fire is to the town. */
  threat: number;
  /** Ground on fire in hectares. */
  areaHa: number;
  /** 0..1 */
  bucketFill: number;
  bucketText: string;
}

export interface MountainHudState {
  /** Spare thrust as a fraction of weight; negative means the aircraft cannot hover. */
  thrustMargin: number;
  /** Cloud base above the aircraft in metres (negative when in cloud), if there is a cloud layer. */
  cloudGap?: number;
  /** 0..1 progress towards disorientation in cloud. */
  exposure: number;
}

/** Offsets of a load from its seat on an assembly, for the placement readouts. */
export interface PlacementHudState {
  /** Which part, e.g. "Mast section 2 of 4". */
  title: string;
  /** Height of the load's base above the seat, in metres. */
  height: number;
  seated: boolean;
  /** Horizontal distance to the seat, its tolerance, and the screen direction to move the load (radians clockwise from up). */
  lateral: number;
  lateralTolerance: number;
  angle: number;
  /** Heading error in degrees: positive means turn clockwise. */
  turn: number;
  turnTolerance: number;
  /** 0..1 progress of the bolting, and the seconds it takes. */
  bolt: number;
  boltSeconds: number;
}

export interface CallHudItem {
  label: string;
  severity: 'critical' | 'serious';
  care: 'trauma' | 'burns';
  /** Name of the hospital the casualty needs. */
  hospital: string;
  timeLeft: number;
  /** Still inside the golden hour. */
  golden: boolean;
  state: 'waiting' | 'loading' | 'aboard' | 'handover';
}

export interface Waypoint {
  label: string;
  /** Screen position in CSS pixels. */
  x: number;
  y: number;
  onScreen: boolean;
  kind: 'pad' | 'survivor' | 'gate' | 'area' | 'fuel' | 'cargo' | 'water' | 'fire' | 'town' | 'call';
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string) => {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

const CONTROLS: [string, string][] = [
  ['W A S D / ← ↑ → ↓', 'Fly'],
  ['Space / Q', 'Climb'],
  ['Shift / Z', 'Descend'],
  ['+ / − / wheel', 'Zoom'],
  ['E', 'Release load / drop water'],
  ['L', 'Height line'],
  ['M', 'Mute'],
  ['P / Esc', 'Pause'],
  ['H', 'Hide help'],
];

/** In-flight overlay: instruments, mission panel, messages and markers. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly alt: HTMLElement;
  private readonly spd: HTMLElement;
  private readonly vs: HTMLElement;
  private readonly fuelBar: HTMLElement;
  private readonly damageBar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly passengers: HTMLElement;
  private readonly loadRow: HTMLElement;
  private readonly loadMass: HTMLElement;
  private readonly loadBar: HTMLElement;
  private readonly fireRow: HTMLElement;
  private readonly threatBar: HTMLElement;
  private readonly areaText: HTMLElement;
  private readonly bucketBar: HTMLElement;
  private readonly bucketText: HTMLElement;
  private readonly haze: HTMLElement;
  private readonly fog: HTMLElement;
  private readonly mountainRow: HTMLElement;
  private readonly powerBar: HTMLElement;
  private readonly powerText: HTMLElement;
  private readonly cloudText: HTMLElement;
  private readonly exposureRow: HTMLElement;
  private readonly exposureBar: HTMLElement;
  private readonly terrain: HTMLElement;
  private readonly terrainArrow: HTMLElement;
  private readonly terrainText: HTMLElement;
  private readonly wind: HTMLElement;
  private readonly windArrow: HTMLElement;
  private readonly windText: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly help: HTMLElement;
  private readonly mission: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly objectiveList: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly winch: HTMLElement;
  private readonly winchText: HTMLElement;
  private readonly winchFill: HTMLElement;
  private readonly markers: HTMLElement;
  private readonly calls: HTMLElement;
  private readonly callList: HTMLElement;
  private readonly lightText: HTMLElement;
  private readonly placement: HTMLElement;
  private readonly placementTitle: HTMLElement;
  private readonly heightValue: HTMLElement;
  private readonly offsetArrow: HTMLElement;
  private readonly offsetValue: HTMLElement;
  private readonly turnValue: HTMLElement;
  private readonly boltFill: HTMLElement;
  private readonly boltText: HTMLElement;
  private callsKey = '';
  private toastTimer = 0;
  private markerEls: HTMLElement[] = [];
  private objectivesKey = '';

  constructor(
    container: HTMLElement,
    aircraft: { name: string; role: string },
    levelName: string,
    options: { night?: boolean; crane?: boolean } = {},
  ) {
    this.root = el('div', options.night ? 'hud night' : 'hud', container);
    el('div', 'vignette', this.root);
    this.haze = el('div', 'haze', this.root);
    this.fog = el('div', 'haze fog', this.root);

    const top = el('div', 'panel top-left', this.root);
    el('div', 'brand', top, 'COPTER');
    el('div', 'aircraft', top, aircraft.name);
    el('div', 'sub', top, `${aircraft.role} · ${levelName}`);

    this.mission = el('div', 'panel objectives', this.root);
    const head = el('div', 'obj-head', this.mission);
    el('div', 'obj-title', head);
    this.timer = el('div', 'timer', head);
    this.objectiveList = el('div', 'obj-list', this.mission);
    this.detail = el('div', 'obj-detail', this.mission);
    const track = el('div', 'bar obj-bar', this.mission);
    this.progressFill = el('div', 'fill progress', track);

    const inst = el('div', 'panel instruments', this.root);
    const readout = (label: string) => {
      const row = el('div', 'readout', inst);
      el('span', 'label', row, label);
      return el('span', 'value', row, '0');
    };
    this.alt = readout('ALT');
    this.spd = readout('SPD');
    this.vs = readout('V/S');
    const bar = (label: string, cls: string) => {
      const row = el('div', 'bar-row', inst);
      el('span', 'label', row, label);
      const t = el('div', 'bar', row);
      return el('div', `fill ${cls}`, t);
    };
    this.fuelBar = bar('FUEL', 'fuel');
    this.damageBar = bar('DMG', 'damage');
    this.passengers = el('div', 'passengers', inst);
    this.loadRow = el('div', 'bar-row load', inst);
    el('span', 'label', this.loadRow, 'LOAD');
    this.loadBar = el('div', 'fill damage', el('div', 'bar', this.loadRow));
    this.loadMass = el('span', 'load-mass', this.loadRow);
    this.loadRow.style.display = 'none';
    this.fireRow = el('div', 'fire-info', inst);
    const threatRow = el('div', 'bar-row', this.fireRow);
    el('span', 'label', threatRow, 'TOWN');
    this.threatBar = el('div', 'fill threat', el('div', 'bar', threatRow));
    const bucketRow = el('div', 'bar-row', this.fireRow);
    el('span', 'label', bucketRow, 'WATER');
    this.bucketBar = el('div', 'fill water', el('div', 'bar', bucketRow));
    const infoRow = el('div', 'readout small', this.fireRow);
    el('span', 'label', infoRow, 'FIRE');
    this.areaText = el('span', 'value', infoRow);
    this.bucketText = el('div', 'bucket-text', this.fireRow);
    this.fireRow.style.display = 'none';
    this.mountainRow = el('div', 'mountain-info', inst);
    const powerRow = el('div', 'bar-row', this.mountainRow);
    el('span', 'label', powerRow, 'PWR');
    this.powerBar = el('div', 'fill power', el('div', 'bar', powerRow));
    this.powerText = el('span', 'load-mass', powerRow);
    const cloudRow = el('div', 'readout small', this.mountainRow);
    el('span', 'label', cloudRow, 'CLOUD');
    this.cloudText = el('span', 'value', cloudRow);
    this.exposureRow = el('div', 'bar-row', this.mountainRow);
    el('span', 'label', this.exposureRow, 'DISOR');
    this.exposureBar = el('div', 'fill damage', el('div', 'bar', this.exposureRow));
    this.mountainRow.style.display = 'none';
    this.wind = el('div', 'wind', inst);
    el('span', 'label', this.wind, 'WIND');
    this.windArrow = el('span', 'wind-arrow', this.wind, '↑');
    this.windText = el('span', 'wind-text', this.wind);
    this.status = el('div', 'status', inst, '');

    this.winch = el('div', 'panel winch', this.root);
    this.winchText = el('div', 'winch-text', this.winch);
    const wt = el('div', 'bar', this.winch);
    this.winchFill = el('div', 'fill progress', wt);

    this.terrain = el('div', 'panel terrain-warn', this.root);
    this.terrainArrow = el('span', 'terrain-arrow', this.terrain, '↑');
    this.terrainText = el('span', 'terrain-text', this.terrain);

    this.calls = el('div', 'panel calls', this.root);
    el('div', 'calls-head', this.calls, 'Emergency calls');
    this.callList = el('div', 'call-list', this.calls);
    this.lightText = el('div', 'light-text', this.calls);
    this.calls.style.display = 'none';

    this.placement = el('div', 'panel placement', this.root);
    this.placementTitle = el('div', 'placement-title', this.placement);
    const placementRow = (label: string) => {
      const row = el('div', 'readout small', this.placement);
      el('span', 'label', row, label);
      return el('span', 'value', row);
    };
    this.heightValue = placementRow('HEIGHT');
    const offsetRow = el('div', 'readout small', this.placement);
    el('span', 'label', offsetRow, 'OFFSET');
    const offset = el('span', 'value', offsetRow);
    this.offsetArrow = el('span', 'offset-arrow', offset, '↑');
    this.offsetValue = el('span', '', offset);
    this.turnValue = placementRow('TURN');
    const boltRow = el('div', 'bar-row', this.placement);
    el('span', 'label', boltRow, 'BOLT');
    this.boltFill = el('div', 'fill progress', el('div', 'bar', boltRow));
    this.boltText = el('span', 'load-mass', boltRow);
    this.placement.style.display = 'none';

    this.toast = el('div', 'toast', this.root);
    this.markers = el('div', 'markers', this.root);

    this.help = el('div', 'panel help', this.root);
    const extra: [string, string][] = [];
    if (options.night) extra.push(['F', 'Searchlight']);
    if (options.crane) extra.push(['[ / ]  or  , / .', 'Turn the load'], ['C', 'Precision camera']);
    const controls = [...CONTROLS.slice(0, 5), ...extra, ...CONTROLS.slice(5)];
    for (const [keys, action] of controls) {
      const row = el('div', 'help-row', this.help);
      el('span', 'keys', row, keys);
      el('span', 'action', row, action);
    }
  }

  destroy(): void {
    this.root.remove();
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  update(s: HudState): void {
    this.alt.textContent = `${Math.max(0, Math.round(s.altitude))} m`;
    this.spd.textContent = `${Math.round(s.speedKnots)} kt`;
    const vs = s.verticalSpeed;
    this.vs.textContent = `${vs > 0.3 ? '▲' : vs < -0.3 ? '▼' : '•'} ${Math.abs(vs).toFixed(1)}`;
    this.vs.classList.toggle('warn', vs < -3);
    this.fuelBar.style.width = `${(s.fuel * 100).toFixed(1)}%`;
    this.fuelBar.classList.toggle('low', s.fuel < 0.2);
    this.damageBar.style.width = `${(s.damage * 100).toFixed(1)}%`;
    this.status.textContent = s.servicing ? 'REFUELLING' : s.landed ? 'LANDED' : '';
  }

  updateMission(m: MissionHudState): void {
    (this.mission.querySelector('.obj-title') as HTMLElement).textContent = m.title;
    const remaining = m.timeLimit !== undefined ? m.timeLimit - m.elapsed : undefined;
    this.timer.textContent = remaining !== undefined ? formatTime(Math.max(0, remaining)) : formatTime(m.elapsed);
    this.timer.classList.toggle('warn', remaining !== undefined && remaining < 60);
    const key = m.objectives.map((o) => o.state).join();
    if (key !== this.objectivesKey) {
      this.objectivesKey = key;
      this.objectiveList.replaceChildren();
      for (const o of m.objectives) {
        el('div', `obj ${o.state}`, this.objectiveList, `${o.state === 'done' ? '✔' : o.state === 'current' ? '▸' : '○'} ${o.text}`);
      }
    }
    this.detail.textContent = m.detail;
    this.progressFill.style.width = `${(m.progress * 100).toFixed(1)}%`;
    this.passengers.style.display = m.passengers ? 'flex' : 'none';
    if (m.passengers) this.passengers.textContent = `ABOARD ${m.passengers.aboard} / ${m.passengers.capacity}`;
  }

  /**
   * Wind as seen on screen: `angle` in radians clockwise from up, speed in knots. Rising or
   * sinking air (m/s) and turbulence (0..1) are shown when strong enough to matter.
   */
  updateWind(angle: number | undefined, knots: number, up = 0, turbulence = 0): void {
    this.wind.style.display = angle === undefined ? 'none' : 'flex';
    if (angle === undefined) return;
    this.windArrow.style.transform = `rotate(${angle}rad)`;
    const vertical = Math.abs(up) >= 0.5 ? ` ${up > 0 ? '▲' : '▼'}${Math.abs(up).toFixed(1)}` : '';
    this.windText.textContent = `${Math.round(knots)} kt${vertical}${turbulence > 0.4 ? ' TURB' : ''}`;
    this.windText.classList.toggle('warn-text', up < -1.5 || turbulence > 0.6);
  }

  /** Guidance panel for the winch or cargo hook. Empty text hides it. */
  updateAssist(text: string, ok: boolean, progress: number): void {
    this.winch.classList.toggle('show', text !== '');
    this.winch.classList.toggle('ok', ok);
    this.winchText.textContent = text;
    this.winchFill.style.width = `${(Math.min(1, progress) * 100).toFixed(0)}%`;
  }

  /** Weight and damage of the slung load; hidden when nothing is carried. */
  updateLoad(load: { mass: number; damage: number } | undefined): void {
    this.loadRow.style.display = load ? 'flex' : 'none';
    if (!load) return;
    this.loadBar.style.width = `${(load.damage * 100).toFixed(1)}%`;
    this.loadMass.textContent = `${(load.mass / 1000).toFixed(1)} t`;
  }

  /** Wildfire gauges. Pass undefined on levels without a fire. */
  updateFire(s: FireHudState | undefined): void {
    this.fireRow.style.display = s ? 'block' : 'none';
    if (!s) return;
    this.threatBar.style.width = `${(s.threat * 100).toFixed(1)}%`;
    this.threatBar.classList.toggle('high', s.threat > 0.65);
    this.bucketBar.style.width = `${(s.bucketFill * 100).toFixed(1)}%`;
    this.areaText.textContent = `${s.areaHa.toFixed(1)} ha`;
    this.bucketText.textContent = s.bucketText;
  }

  /** Mountain gauges: power margin, cloud base and disorientation. Pass undefined to hide them. */
  updateMountain(s: MountainHudState | undefined): void {
    this.mountainRow.style.display = s ? 'block' : 'none';
    if (!s) return;
    const m = s.thrustMargin;
    this.powerBar.style.width = `${(Math.min(1, Math.max(0.02, (m + 0.1) / 0.5)) * 100).toFixed(1)}%`;
    this.powerBar.classList.toggle('low', m < 0.03);
    this.powerText.textContent = m < 0 ? 'NO HOVER' : `+${Math.round(m * 100)}%`;
    this.powerText.classList.toggle('warn-text', m < 0);
    this.cloudText.style.display = s.cloudGap === undefined ? 'none' : '';
    if (s.cloudGap !== undefined) {
      this.cloudText.textContent = s.cloudGap < 0 ? 'IN CLOUD' : `${Math.round(s.cloudGap)} m`;
      this.cloudText.classList.toggle('warn', s.cloudGap < 25);
    }
    this.exposureRow.style.display = s.exposure > 0.01 ? 'flex' : 'none';
    this.exposureBar.style.width = `${(Math.min(1, s.exposure) * 100).toFixed(1)}%`;
  }

  /**
   * Terrain proximity warning: `angle` is the screen direction of the nearest rock in radians
   * clockwise from up, `distance` the gap at the blade tips. Pass undefined to clear it.
   */
  updateTerrain(warning: { angle: number; distance: number; label?: string } | undefined): void {
    this.terrain.classList.toggle('show', !!warning);
    if (!warning) return;
    this.terrain.classList.toggle('close', warning.distance < 4);
    this.terrainArrow.style.transform = `rotate(${warning.angle}rad)`;
    this.terrainText.textContent = `${warning.label ?? 'TERRAIN'} ${Math.max(0, warning.distance).toFixed(0)} m`;
  }

  /** Screen area of the calls panel, which edge markers keep clear of. */
  get callsBottom(): number {
    return this.calls.style.display === 'none' ? 0 : this.calls.getBoundingClientRect().bottom;
  }

  /**
   * Emergency calls in progress, with each casualty's timer, and the searchlight mode. Pass
   * undefined to hide the panel.
   */
  updateCalls(items: CallHudItem[] | undefined, searchlight = ''): void {
    this.calls.style.display = items ? 'block' : 'none';
    if (!items) return;
    const key = items.map((c) => `${c.label}|${c.state}`).join();
    if (key !== this.callsKey) {
      this.callsKey = key;
      this.callList.replaceChildren();
      if (!items.length) el('div', 'call-idle', this.callList, 'Standing by…');
      for (const c of items) {
        const row = el('div', `call ${c.severity}${c.state === 'aboard' || c.state === 'handover' ? ' aboard' : ''}`, this.callList);
        const top = el('div', 'call-top', row);
        el('span', 'call-label', top, c.label);
        el('span', 'call-timer', top);
        const where =
          c.state === 'aboard' ? `Aboard → ${c.hospital}` : c.state === 'handover' ? 'Handing over…' : c.state === 'loading' ? 'Loading…' : 'At the scene';
        el('div', 'call-sub', row, `${c.severity} · ${c.care} · ${where}`);
      }
    }
    const timers = this.callList.querySelectorAll<HTMLElement>('.call-timer');
    items.forEach((c, i) => {
      const t = timers[i];
      if (!t) return;
      t.textContent = formatTime(Math.max(0, c.timeLeft));
      t.className = `call-timer ${c.timeLeft < 30 ? 'urgent' : c.golden ? 'golden' : 'late'}`;
    });
    this.lightText.textContent = searchlight;
  }

  /** Placement readouts while setting a part down on an assembly. Pass undefined to hide them. */
  updatePlacement(p: PlacementHudState | undefined): void {
    this.placement.style.display = p ? 'block' : 'none';
    if (!p) return;
    const grade = (e: HTMLElement, ok: boolean, near: boolean) => {
      e.classList.toggle('ok', ok);
      e.classList.toggle('near', !ok && near);
    };
    this.placementTitle.textContent = p.title;
    this.heightValue.textContent = p.seated ? 'SEATED' : `${p.height >= 0 ? '+' : ''}${p.height.toFixed(1)} m`;
    grade(this.heightValue, p.seated, p.height < 3);
    const lateralOk = p.lateral <= p.lateralTolerance;
    this.offsetArrow.style.visibility = lateralOk ? 'hidden' : 'visible';
    this.offsetArrow.style.transform = `rotate(${p.angle}rad)`;
    this.offsetValue.textContent = ` ${p.lateral.toFixed(1)} m`;
    grade(this.offsetValue.parentElement!, lateralOk, p.lateral <= p.lateralTolerance * 3);
    const turnOk = Math.abs(p.turn) <= p.turnTolerance;
    // The key that turns the load the right way: ] clockwise, [ anticlockwise.
    this.turnValue.textContent = turnOk ? `${Math.abs(p.turn).toFixed(0)}° ✔` : `${p.turn > 0 ? ']' : '['} ${Math.abs(p.turn).toFixed(0)}°`;
    grade(this.turnValue, turnOk, Math.abs(p.turn) <= p.turnTolerance * 3);
    this.boltFill.style.width = `${(Math.min(1, p.bolt) * 100).toFixed(1)}%`;
    this.boltText.textContent = `${(p.bolt * p.boltSeconds).toFixed(1)}/${p.boltSeconds} s`;
  }

  /** Cloud fog over the view, 0 (clear) to 1 (white-out). */
  setFog(level: number): void {
    this.fog.style.opacity = Math.min(1, Math.max(0, level)).toFixed(2);
  }

  /** Smoke haze over the view, 0 (clear) to 1 (thick). */
  setHaze(level: number): void {
    this.haze.style.opacity = Math.min(1, Math.max(0, level)).toFixed(2);
  }

  setWaypoints(points: Waypoint[]): void {
    while (this.markerEls.length < points.length) this.markerEls.push(el('div', 'marker', this.markers));
    // Nudge edge markers apart so targets in the same direction don't overlap.
    const placed: { x: number; y: number }[] = [];
    this.markerEls.forEach((m, i) => {
      const p = points[i];
      if (!p) {
        m.style.display = 'none';
        return;
      }
      let { x, y } = p;
      if (!p.onScreen) {
        for (let tries = 0; tries < 8 && placed.some((q) => Math.abs(q.x - x) < 84 && Math.abs(q.y - y) < 44); tries++) {
          y += y > window.innerHeight / 2 ? -46 : 46;
        }
        placed.push({ x, y });
      }
      m.style.display = 'block';
      m.className = `marker ${p.kind}${p.onScreen ? '' : ' edge'}`;
      m.style.transform = `translate(${x}px, ${y}px)`;
      m.textContent = p.onScreen ? `▼ ${p.label}` : p.label;
    });
  }

  message(text: string, seconds = 2.5): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastTimer = seconds;
  }

  tick(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }
}
