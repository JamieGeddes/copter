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

export interface Waypoint {
  label: string;
  /** Screen position in CSS pixels. */
  x: number;
  y: number;
  onScreen: boolean;
  kind: 'pad' | 'survivor' | 'gate' | 'area' | 'fuel' | 'cargo';
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
  ['E', 'Release load'],
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
  private toastTimer = 0;
  private markerEls: HTMLElement[] = [];
  private objectivesKey = '';

  constructor(container: HTMLElement, aircraft: { name: string; role: string }, levelName: string) {
    this.root = el('div', 'hud', container);
    el('div', 'vignette', this.root);

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
    this.wind = el('div', 'wind', inst);
    el('span', 'label', this.wind, 'WIND');
    this.windArrow = el('span', 'wind-arrow', this.wind, '↑');
    this.windText = el('span', 'wind-text', this.wind);
    this.status = el('div', 'status', inst, '');

    this.winch = el('div', 'panel winch', this.root);
    this.winchText = el('div', 'winch-text', this.winch);
    const wt = el('div', 'bar', this.winch);
    this.winchFill = el('div', 'fill progress', wt);

    this.toast = el('div', 'toast', this.root);
    this.markers = el('div', 'markers', this.root);

    this.help = el('div', 'panel help', this.root);
    for (const [keys, action] of CONTROLS) {
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

  /** Wind as seen on screen: `angle` in radians clockwise from up, speed in knots. */
  updateWind(angle: number | undefined, knots: number): void {
    this.wind.style.display = angle === undefined ? 'none' : 'flex';
    if (angle === undefined) return;
    this.windArrow.style.transform = `rotate(${angle}rad)`;
    this.windText.textContent = `${Math.round(knots)} kt`;
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
