// input.js — keyboard and mouse steering for Skyline Courier.
//
// Keys: W / ArrowUp throttle up, S / ArrowDown throttle down, A / ArrowLeft
// and D / ArrowRight turn, R / PageUp climb, F / PageDown descend.
// Space or Enter confirms (start / restart), P or Escape pauses.
// Mouse: moving the pointer left or right of centre steers; above or below
// centre climbs or descends. One-shot presses are queued as bit flags and
// taken once by the loop, so a press between two frames is never lost and
// never counted twice.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;

const THROTTLE_UP = new Set(['KeyW', 'ArrowUp']);
const THROTTLE_DOWN = new Set(['KeyS', 'ArrowDown']);
const TURN_LEFT = new Set(['KeyA', 'ArrowLeft']);
const TURN_RIGHT = new Set(['KeyD', 'ArrowRight']);
const CLIMB = new Set(['KeyR', 'PageUp']);
const DESCEND = new Set(['KeyF', 'PageDown']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);

export function createInput(canvas) {
  const keys = new Set();
  let actions = 0;
  let mouseX = 0;
  let mouseY = 0;
  let mouseActive = false;

  window.addEventListener('keydown', (event) => {
    if (
      THROTTLE_UP.has(event.code) ||
      THROTTLE_DOWN.has(event.code) ||
      TURN_LEFT.has(event.code) ||
      TURN_RIGHT.has(event.code) ||
      CLIMB.has(event.code) ||
      DESCEND.has(event.code)
    ) {
      keys.add(event.code);
      event.preventDefault();
      return;
    }
    if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
      event.preventDefault();
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup: let go on blur.
  window.addEventListener('blur', () => {
    keys.clear();
    mouseActive = false;
  });
  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = (event.clientX - rect.left) / rect.width - 0.5;
    mouseY = (event.clientY - rect.top) / rect.height - 0.5;
    mouseActive = true;
  });
  canvas.addEventListener('pointerdown', () => {
    actions |= ACTION_CONFIRM;
  });
  canvas.addEventListener('pointerleave', () => {
    mouseActive = false;
  });

  function has(set) {
    for (const code of set) if (keys.has(code)) return true;
    return false;
  }

  return {
    /** Steering for this frame: { turn: -1..1, throttle: -1..1, climb: -1..1 }. */
    controls() {
      let turn = (has(TURN_RIGHT) ? 1 : 0) - (has(TURN_LEFT) ? 1 : 0);
      let climb = (has(CLIMB) ? 1 : 0) - (has(DESCEND) ? 1 : 0);
      if (mouseActive) {
        // Mouse steers gently; keys always win when held.
        if (turn === 0) turn = Math.max(-1, Math.min(1, mouseX * 2.4));
        if (climb === 0) climb = Math.max(-1, Math.min(1, -mouseY * 2.4));
      }
      const throttle = (has(THROTTLE_UP) ? 1 : 0) - (has(THROTTLE_DOWN) ? 1 : 0);
      return { turn, throttle, climb };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
