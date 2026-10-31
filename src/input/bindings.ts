/** Keyboard bindings using `KeyboardEvent.code`, so layouts such as AZERTY still work positionally. */
export const BINDINGS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  climb: ['Space', 'KeyQ'],
  descend: ['ShiftLeft', 'ShiftRight', 'KeyZ'],
  action: ['KeyE', 'Enter', 'NumpadEnter'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
  pause: ['KeyP', 'Escape'],
  help: ['KeyH'],
  mute: ['KeyM'],
  heightLine: ['KeyL'],
} as const;

export type Action = keyof typeof BINDINGS;

/** Codes whose default browser behaviour (scrolling) should be suppressed. */
export const PREVENT_DEFAULT = new Set<string>([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

export interface ControlAxes {
  /** Screen-relative stick: +x right, +y up the screen. Length <= 1. */
  x: number;
  y: number;
  /** +1 climb, -1 descend. */
  climb: number;
}

export const isActive = (held: ReadonlySet<string>, action: Action): boolean =>
  BINDINGS[action].some((code) => held.has(code));

/** Converts the set of held keys into normalised control axes. */
export const axesFromKeys = (held: ReadonlySet<string>): ControlAxes => {
  let x = (isActive(held, 'right') ? 1 : 0) - (isActive(held, 'left') ? 1 : 0);
  let y = (isActive(held, 'up') ? 1 : 0) - (isActive(held, 'down') ? 1 : 0);
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  const climb = (isActive(held, 'climb') ? 1 : 0) - (isActive(held, 'descend') ? 1 : 0);
  return { x, y, climb };
};
