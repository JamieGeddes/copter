export interface HudState {
  altitude: number;
  speedKnots: number;
  verticalSpeed: number;
  fuel: number;
  damage: number;
  landed: boolean;
  servicing: boolean;
}

export interface Waypoint {
  label: string;
  /** Screen position in CSS pixels. */
  x: number;
  y: number;
  onScreen: boolean;
  done: boolean;
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
  ['L', 'Height line'],
  ['M', 'Mute'],
  ['P / Esc', 'Pause'],
  ['H', 'Hide help'],
];

/** DOM overlay for instruments, messages and menus. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly alt: HTMLElement;
  private readonly spd: HTMLElement;
  private readonly vs: HTMLElement;
  private readonly fuelBar: HTMLElement;
  private readonly damageBar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly help: HTMLElement;
  private readonly objectives: HTMLElement;
  private readonly markers: HTMLElement;
  private readonly overlay: HTMLElement;
  private toastTimer = 0;
  private markerEls: HTMLElement[] = [];

  constructor(container: HTMLElement, aircraft: { name: string; role: string }, levelName: string) {
    this.root = el('div', 'hud', container);
    el('div', 'vignette', this.root);

    const top = el('div', 'panel top-left', this.root);
    el('div', 'brand', top, 'COPTER');
    el('div', 'aircraft', top, aircraft.name);
    el('div', 'sub', top, `${aircraft.role} · ${levelName}`);

    this.objectives = el('div', 'panel objectives', this.root);

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
      const track = el('div', 'bar', row);
      return el('div', `fill ${cls}`, track);
    };
    this.fuelBar = bar('FUEL', 'fuel');
    this.damageBar = bar('DMG', 'damage');
    this.status = el('div', 'status', inst, '');

    this.toast = el('div', 'toast', this.root);
    this.markers = el('div', 'markers', this.root);

    this.help = el('div', 'panel help', this.root);
    for (const [keys, action] of CONTROLS) {
      const row = el('div', 'help-row', this.help);
      el('span', 'keys', row, keys);
      el('span', 'action', row, action);
    }

    this.overlay = el('div', 'overlay', this.root);
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

  setObjectives(title: string, items: { label: string; done: boolean }[]): void {
    this.objectives.replaceChildren();
    el('div', 'obj-title', this.objectives, title);
    for (const item of items) {
      el('div', `obj ${item.done ? 'done' : ''}`, this.objectives, `${item.done ? '✔' : '○'} ${item.label}`);
    }
  }

  setWaypoints(points: Waypoint[]): void {
    while (this.markerEls.length < points.length) this.markerEls.push(el('div', 'marker', this.markers));
    // Nudge edge markers apart so pads in the same direction don't overlap.
    const placed: { x: number; y: number }[] = [];
    const adjusted = points.map((p) => {
      if (p.done || p.onScreen) return p;
      let { x, y } = p;
      for (let tries = 0; tries < 8 && placed.some((q) => Math.abs(q.x - x) < 84 && Math.abs(q.y - y) < 44); tries++) {
        y += y > window.innerHeight / 2 ? -46 : 46;
      }
      placed.push({ x, y });
      return { ...p, x, y };
    });
    this.markerEls.forEach((m, i) => {
      const p = adjusted[i];
      if (!p || p.done) {
        m.style.display = 'none';
        return;
      }
      m.style.display = 'block';
      m.classList.toggle('edge', !p.onScreen);
      m.style.transform = `translate(${p.x}px, ${p.y}px)`;
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

  showOverlay(title: string, lines: string[], prompt: string): void {
    this.overlay.replaceChildren();
    const card = el('div', 'card', this.overlay);
    el('h1', '', card, title);
    for (const l of lines) el('p', '', card, l);
    el('div', 'prompt', card, prompt);
    this.overlay.classList.add('show');
  }

  hideOverlay(): void {
    this.overlay.classList.remove('show');
  }
}
