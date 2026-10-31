import { Action, BINDINGS, PREVENT_DEFAULT } from './bindings';

/** Tracks held keys and per-frame presses. Call `endFrame` once per rendered frame. */
export class Keyboard {
  readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private wheel = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.held.clear());
    target.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
  }

  /** True on the frame the action's key went down. */
  wasPressed(action: Action): boolean {
    return BINDINGS[action].some((code) => this.pressed.has(code));
  }

  /** Accumulated wheel steps since the last frame (+ = zoom out). */
  wheelSteps(): number {
    return this.wheel;
  }

  endFrame(): void {
    this.pressed.clear();
    this.wheel = 0;
  }
}
