import { RotorAudio } from '../audio/RotorAudio';
import { Sfx } from '../audio/Sfx';
import { axesFromKeys } from '../input/bindings';
import { Keyboard } from '../input/Keyboard';
import { CAMPAIGN, CAMPAIGN_ORDER, CampaignEntry } from '../levels';
import { Stage } from '../render/Stage';
import { Menu, SelectItem } from '../ui/Menu';
import { Progress } from './progress';
import { Session } from './Session';

type Screen = 'title' | 'select' | 'briefing' | 'playing' | 'paused' | 'ending' | 'debrief';

/** Seconds between the mission ending and the debrief appearing. */
const ENDING_DELAY = 2.5;

const storage = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/** Top-level state machine: title, mission select, briefing, flight, pause and debrief. */
export class App {
  private readonly container: HTMLElement;
  private readonly stage: Stage;
  private readonly keyboard = new Keyboard();
  private readonly audio = new RotorAudio();
  private readonly sfx = new Sfx(this.audio);
  private readonly menu: Menu;
  private readonly progress = new Progress(storage());
  private session: Session;
  /** Which campaign entry the current session belongs to (undefined for the menu backdrop). */
  private sessionEntry?: CampaignEntry;
  private screen: Screen = 'title';
  private selected = 0;
  private endingTimer = 0;
  private last = performance.now();

  constructor(container: HTMLElement) {
    this.container = container;
    this.stage = new Stage(container);
    this.menu = new Menu(container);
    this.session = this.createBackdrop();
    this.menu.showTitle();
    // Start on the first mission that still needs flying.
    const firstOpen = CAMPAIGN.findIndex((c) => c.level && !this.progress.get(c.id).completed);
    this.selected = Math.max(0, firstOpen);
    if (import.meta.env.DEV) (window as unknown as { __copter: App }).__copter = this;
  }

  start(): void {
    const loop = (now: number) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Exposed for automated checks in development. */
  get current(): { screen: Screen; session: Session } {
    return { screen: this.screen, session: this.session };
  }

  private createBackdrop(): Session {
    const level = CAMPAIGN[0].level!;
    this.sessionEntry = undefined;
    return new Session(this.stage, this.container, level, this.audio, this.sfx);
  }

  private load(entry: CampaignEntry): void {
    this.session.dispose();
    this.session = new Session(this.stage, this.container, entry.level!, this.audio, this.sfx);
    this.sessionEntry = entry;
  }

  private items(): SelectItem[] {
    return CAMPAIGN.map((entry) => ({
      entry,
      record: this.progress.get(entry.id),
      unlocked: this.progress.isUnlocked(entry.id, CAMPAIGN_ORDER),
    }));
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const kb = this.keyboard;

    if (kb.wasPressed('mute')) this.audio.setMuted(!this.audio.isMuted);
    if (kb.wasPressed('zoomIn')) this.stage.iso.zoom(0.85);
    if (kb.wasPressed('zoomOut')) this.stage.iso.zoom(1 / 0.85);
    if (kb.wheelSteps() !== 0) this.stage.iso.zoom(Math.pow(1.1, kb.wheelSteps()));

    switch (this.screen) {
      case 'title':
        this.session.demo(dt);
        if (kb.wasPressed('confirm')) {
          this.audio.start();
          this.sfx.play('select');
          this.openSelect();
        }
        break;
      case 'select':
        this.session.demo(dt);
        this.handleSelect();
        break;
      case 'briefing':
        this.session.update(dt, null);
        if (kb.wasPressed('confirm')) {
          this.sfx.play('select');
          this.menu.hide();
          this.session.hud.setVisible(true);
          this.session.hud.message(this.session.level.mission.objectives[0].text, 3.5);
          this.screen = 'playing';
        } else if (kb.wasPressed('back')) {
          this.session.dispose();
          this.session = this.createBackdrop();
          this.openSelect();
        }
        break;
      case 'playing':
        if (kb.wasPressed('pause')) {
          this.screen = 'paused';
          this.menu.showPause();
          this.audio.update(0, 0);
          break;
        }
        if (kb.wasPressed('help')) this.session.hud.toggleHelp();
        if (kb.wasPressed('heightLine')) this.session.toggleHeightLine();
        this.session.update(dt, axesFromKeys(kb.held));
        if (this.session.outcome) {
          this.screen = 'ending';
          this.endingTimer = ENDING_DELAY;
        }
        break;
      case 'paused':
        if (kb.wasPressed('pause') || kb.wasPressed('confirm')) {
          this.menu.hide();
          this.screen = 'playing';
        } else if (kb.wasPressed('restart')) {
          this.restart();
        } else if (kb.wasPressed('quit')) {
          this.quitToSelect();
        }
        break;
      case 'ending':
        this.session.update(dt, null);
        this.endingTimer -= dt;
        if (this.endingTimer <= 0) this.showDebrief();
        break;
      case 'debrief':
        this.session.update(dt, null);
        if (kb.wasPressed('confirm')) {
          const next = this.nextEntry();
          if (this.session.outcome?.success && next) {
            this.selected = CAMPAIGN.indexOf(next);
            this.brief(next);
          } else {
            this.restart();
          }
        } else if (kb.wasPressed('restart')) {
          this.restart();
        } else if (kb.wasPressed('back')) {
          this.quitToSelect();
        }
        break;
    }

    this.stage.render();
    kb.endFrame();
  }

  private openSelect(): void {
    this.screen = 'select';
    this.menu.showSelect(this.items(), this.selected);
  }

  private handleSelect(): void {
    const kb = this.keyboard;
    const n = CAMPAIGN.length;
    if (kb.wasPressed('up') || kb.wasPressed('down')) {
      this.selected = (this.selected + (kb.wasPressed('up') ? n - 1 : 1)) % n;
      this.sfx.play('move');
      this.menu.showSelect(this.items(), this.selected);
    } else if (kb.wasPressed('confirm')) {
      const item = this.items()[this.selected];
      if (item.unlocked && item.entry.level) {
        this.sfx.play('select');
        this.brief(item.entry);
      } else {
        this.sfx.play('warning');
      }
    } else if (kb.wasPressed('back')) {
      this.screen = 'title';
      this.menu.showTitle();
    }
  }

  private brief(entry: CampaignEntry): void {
    this.load(entry);
    this.screen = 'briefing';
    this.menu.showBriefing(entry, this.progress.get(entry.id));
  }

  private restart(): void {
    if (!this.sessionEntry) return;
    this.load(this.sessionEntry);
    this.menu.hide();
    this.session.hud.setVisible(true);
    this.session.hud.message(this.session.level.mission.objectives[0].text, 3.5);
    this.screen = 'playing';
  }

  private quitToSelect(): void {
    this.session.dispose();
    this.session = this.createBackdrop();
    this.openSelect();
  }

  private nextEntry(): CampaignEntry | undefined {
    if (!this.sessionEntry) return undefined;
    const next = CAMPAIGN[CAMPAIGN.indexOf(this.sessionEntry) + 1];
    return next?.level ? next : undefined;
  }

  private showDebrief(): void {
    const outcome = this.session.outcome!;
    const entry = this.sessionEntry!;
    const prev = this.progress.get(entry.id);
    let newBest = false;
    if (outcome.success && outcome.medal) {
      newBest = this.progress.record(entry.id, outcome.time, outcome.medal).newBestTime;
    }
    this.screen = 'debrief';
    this.session.hud.setVisible(false);
    this.menu.showDebrief({
      success: outcome.success,
      title: `${entry.title} · ${entry.aircraft}`,
      reason: outcome.reason,
      time: outcome.time,
      medal: outcome.medal,
      damage: outcome.damage,
      bestTime: prev.bestTime,
      newBest,
      hasNext: !!this.nextEntry(),
      stats: outcome.stats,
    });
  }
}
