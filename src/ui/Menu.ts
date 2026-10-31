import { MissionRecord } from '../core/progress';
import { CampaignEntry } from '../levels';
import { formatTime, Medal } from '../missions/medals';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string) => {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

const medalBadge = (parent: HTMLElement, medal: Medal | undefined, large = false): void => {
  const b = el('span', `medal ${medal ?? 'none'}${large ? ' large' : ''}`, parent);
  b.title = medal ? `${medal} medal` : 'No medal yet';
};

const keyHint = (parent: HTMLElement, hints: [string, string][]): void => {
  const row = el('div', 'key-hints', parent);
  for (const [key, action] of hints) {
    const h = el('span', 'key-hint', row);
    el('kbd', '', h, key);
    h.append(` ${action}`);
  }
};

export interface SelectItem {
  entry: CampaignEntry;
  record: MissionRecord;
  unlocked: boolean;
}

export interface DebriefInfo {
  success: boolean;
  title: string;
  reason?: string;
  time: number;
  medal?: Medal;
  damage: number;
  bestTime?: number;
  newBest: boolean;
  hasNext: boolean;
  stats: [string, string][];
}

/** Full-screen menus drawn over the 3D view. */
export class Menu {
  private readonly root: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = el('div', 'menu', container);
  }

  hide(): void {
    this.root.classList.remove('show');
    this.root.replaceChildren();
  }

  private open(className: string): HTMLElement {
    this.root.replaceChildren();
    this.root.className = `menu show ${className}`;
    return el('div', 'card', this.root);
  }

  showTitle(): void {
    const card = this.open('title-screen');
    el('h1', '', card, 'COPTER');
    el('p', 'tagline', card, 'Eight helicopters. Eight missions. One pilot.');
    el('div', 'prompt', card, 'Press Enter');
  }

  showSelect(items: SelectItem[], selected: number): void {
    const card = this.open('select-screen');
    el('h2', '', card, 'Missions');
    const list = el('div', 'mission-list', card);
    items.forEach((item, i) => {
      const playable = item.unlocked && !!item.entry.level;
      const row = el('div', `mission${i === selected ? ' selected' : ''}${playable ? '' : ' locked'}`, list);
      el('span', 'num', row, String(i + 1).padStart(2, '0'));
      const info = el('div', 'info', row);
      el('div', 'm-title', info, item.entry.title);
      const status = !item.entry.level ? 'Coming soon' : !item.unlocked ? 'Locked' : item.entry.skill;
      el('div', 'm-aircraft', info, `${item.entry.aircraft} · ${status}`);
      const right = el('div', 'result', row);
      if (item.record.bestTime !== undefined) el('span', 'best', right, formatTime(item.record.bestTime));
      medalBadge(right, item.record.medal);
    });
    const sel = items[selected];
    if (sel) el('p', 'summary', card, sel.entry.summary);
    keyHint(card, [
      ['↑ ↓', 'Choose'],
      ['Enter', 'Brief'],
      ['Esc', 'Back'],
    ]);
  }

  showBriefing(entry: CampaignEntry, record: MissionRecord): void {
    const level = entry.level!;
    const m = level.mission;
    const card = this.open('briefing-screen');
    el('div', 'eyebrow', card, `${level.name} · ${entry.aircraft}`);
    el('h2', '', card, m.title);
    for (const line of m.briefing) el('p', '', card, line);
    const obj = el('ol', 'brief-objectives', card);
    for (const o of m.objectives) el('li', '', obj, o.text);
    const medals = el('div', 'medal-times', card);
    for (const [medal, t] of [
      ['gold', m.medals.gold],
      ['silver', m.medals.silver],
    ] as [Medal, number][]) {
      const s = el('span', '', medals);
      medalBadge(s, medal);
      s.append(` under ${formatTime(t)}`);
    }
    if (m.timeLimit) el('span', 'limit', medals, `Time limit ${formatTime(m.timeLimit)}`);
    if (record.bestTime !== undefined) el('span', 'limit', medals, `Best ${formatTime(record.bestTime)}`);
    keyHint(card, [
      ['Enter', 'Fly'],
      ['Esc', 'Back'],
    ]);
  }

  showPause(): void {
    const card = this.open('pause-screen');
    el('h2', '', card, 'Paused');
    keyHint(card, [
      ['P', 'Resume'],
      ['R', 'Restart'],
      ['X', 'Quit to missions'],
    ]);
  }

  showDebrief(d: DebriefInfo): void {
    const card = this.open(`debrief-screen ${d.success ? 'success' : 'failure'}`);
    el('div', 'eyebrow', card, d.title);
    el('h2', '', card, d.success ? 'Mission complete' : 'Mission failed');
    if (d.reason) el('p', 'reason', card, d.reason);
    if (d.success) {
      const medal = el('div', 'debrief-medal', card);
      medalBadge(medal, d.medal, true);
      el('span', 'medal-name', medal, `${d.medal} medal`);
    }
    const stats = el('div', 'stats', card);
    const stat = (k: string, v: string) => {
      const r = el('div', 'stat', stats);
      el('span', 'k', r, k);
      el('span', 'v', r, v);
    };
    stat('Time', formatTime(d.time) + (d.newBest ? '  NEW BEST' : ''));
    stat('Damage', `${Math.round(d.damage * 100)}%`);
    for (const [k, v] of d.stats) stat(k, v);
    if (d.bestTime !== undefined && !d.newBest) stat('Best', formatTime(d.bestTime));
    const hints: [string, string][] = [];
    if (d.success && d.hasNext) hints.push(['Enter', 'Next mission']);
    hints.push(['R', 'Retry'], ['Esc', 'Missions']);
    keyHint(card, hints);
  }
}
