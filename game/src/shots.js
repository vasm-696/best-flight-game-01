// shots.js — the screenshot scenes behind ?shot=start|play|end. Each one plays
// the real rules forward from a fresh flight for a fixed number of steps,
// steered by a simple autopilot (aim at the next ring or the runway, hold
// throttle for the approach, climb or descend to the target's altitude), so
// the frame is what a short game really looks like and the same seed always
// gives the same frame.

import { STEP } from './config.js';
import { EVENT_OVER } from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 15;
const END_LIMIT_SECONDS = 600;
const END_RECKLESS_AFTER_SECONDS = 18;

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

/** Steer toward the flight's next target: turn, throttle and climb. */
function autopilot(flight) {
  const s = flight.state;
  const target = flight.nextTarget();
  if (!target) return { turn: 0, throttle: 0, climb: 0 };
  const dx = target.x - s.x;
  const dz = target.z - s.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const wantedHeading = Math.atan2(dx, dz);
  let err = wantedHeading - s.heading;
  err = ((err + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  const turn = clamp(err * 1.8, -1, 1);
  // Stay clear of the ground ahead: hold altitude until the final approach,
  // then descend onto the strip. Never aim below the ridge line en route.
  const aheadX = s.x + Math.sin(s.heading) * 130;
  const aheadZ = s.z + Math.cos(s.heading) * 130;
  const groundAhead = flight.world.heightAt(aheadX, aheadZ);
  let targetAlt = target.y;
  if (target.kind === 'runway') {
    // Glide slope: hold altitude far out, then step down onto the strip.
    if (dist > 350) targetAlt = Math.max(targetAlt, groundAhead + 55, 70);
    else if (dist > 150) targetAlt = Math.max(target.y + 14, groundAhead + 15);
    else targetAlt = target.y + 2;
  } else {
    targetAlt = Math.max(targetAlt, groundAhead + 30);
  }
  const climb = clamp((targetAlt - s.y) / 28, -1, 1);
  let throttle = 0.65;
  if (target.kind === 'runway' && dist < 320) throttle = 0.22; // slow for landing
  else if (dist > 500) throttle = 0.8;
  return { turn, throttle: throttle - s.throttle > 0 ? 1 : throttle - s.throttle < 0 ? -1 : 0, climb };
}

/**
 * Set the flight to the named scene (start, play or end; any other name is
 * start) and return the screen to draw over it and the best score to show.
 */
export function stageShot(name, flight) {
  flight.reset();
  if (name !== 'play' && name !== 'end') {
    for (let i = 0; i < START_SECONDS / STEP; i++) {
      flight.step(STEP, { turn: 0, throttle: 1, climb: 0.4 }, true);
    }
    return { screen: SCREEN_TITLE, best: 0 };
  }
  const limit = name === 'end' ? END_LIMIT_SECONDS : PLAY_SECONDS;
  for (let i = 0; i < limit / STEP; i++) {
    let controls;
    if (name === 'end' && i * STEP > END_RECKLESS_AFTER_SECONDS) {
      // A hurried pilot: full throttle, nose down, straight into the ridge.
      controls = { turn: 0, throttle: 1, climb: -1 };
    } else {
      controls = autopilot(flight);
    }
    if (flight.step(STEP, controls, false) & EVENT_OVER) break;
  }
  const over = flight.state.status === 'crashed' || flight.state.status === 'done';
  return { screen: over ? SCREEN_OVER : SCREEN_PLAY, best: flight.state.score };
}
