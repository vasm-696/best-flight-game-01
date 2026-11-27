// world.js — procedural terrain + rings + runway for Skyline Courier, plus the
// flight simulation that flies through it (plane state, throttle/turn discipline,
// fuel, damage, ring runs and runway landings across three sorties).
// Seeded only: every random value comes from a mulberry32 stream derived
// from the seed. No Math.random is used anywhere in this file, so the same
// seed always builds the same world.

import { DAMAGE, FUEL, PLANE, SCORE, SORTIES } from './config.js';

export function hashSeed(seed) {
  const text = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a) {
  let state = a >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  return mulberry32(hashSeed(seed));
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

// 2D value noise on an integer lattice, deterministic per seed.
function makeNoise(rng) {
  const size = 256;
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const at = (ix, iz) => {
    const x = ((ix % size) + size) % size;
    const z = ((iz % size) + size) % size;
    return grid[z * size + x];
  };
  return function noise(x, z) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = smooth(x - ix);
    const fz = smooth(z - iz);
    const a = at(ix, iz);
    const b = at(ix + 1, iz);
    const c = at(ix, iz + 1);
    const d = at(ix + 1, iz + 1);
    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return top + (bottom - top) * fz; // 0..1
  };
}

function fbm(noise, x, z, octaves) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm; // 0..1
}

export function createWorld(seed = 1) {
  const rng = makeRng(seed);
  const noise = makeNoise(rng);

  // Runway: a flat strip near the start so landings are possible.
  const runway = {
    x: 0,
    z: 120,
    length: 420,
    width: 34,
    heading: 0, // aligned with +Z flight direction
    elevation: 6,
  };

  // How much the terrain is flattened close to the runway centre line.
  function runwayFlatten(x, z) {
    const dz = Math.abs(z - runway.z);
    const dx = Math.abs(x - runway.x);
    if (dz > runway.length / 2 + 160 || dx > runway.width / 2 + 160) return 0;
    const along = 1 - Math.min(1, dz / (runway.length / 2 + 160));
    const across = 1 - Math.min(1, dx / (runway.width / 2 + 160));
    return Math.min(1, along * 0.7 + across * 0.7);
  }

  function rawHeight(x, z) {
    // Layered mountains: broad hills + sharper ridges + fine detail.
    const broad = fbm(noise, x * 0.004 + 13.7, z * 0.004 + 7.1, 3);
    const ridge = fbm(noise, x * 0.011 + 3.3, z * 0.011 + 9.9, 3);
    const detail = fbm(noise, x * 0.03 + 21.5, z * 0.03 + 4.4, 2);
    // Ridge sharpness: fold the ridge noise so peaks are crested.
    const ridged = 1 - Math.abs(ridge * 2 - 1);
    let h = broad * 46 + ridged * ridged * 78 + detail * 10 - 18;
    // Valley floor along the flight corridor so the course stays flyable.
    const corridor = Math.exp(-((x * x) / (2 * 170 * 170)));
    h = h * (1 - corridor * 0.55) + 2 * corridor;
    return h;
  }

  function heightAt(x, z) {
    const h = rawHeight(x, z);
    const flat = runwayFlatten(x, z);
    if (flat <= 0) return h;
    return h * (1 - flat) + runway.elevation * flat;
  }

  // Golden target rings along the course: varied altitude and lateral offset.
  const rings = [];
  const ringCount = 14;
  let courseX = 0;
  for (let i = 0; i < ringCount; i++) {
    const z = 420 + i * 260;
    // Meandering course centre, smooth by construction.
    courseX += (rng() - 0.5) * 180;
    courseX = Math.max(-260, Math.min(260, courseX));
    const ground = heightAt(courseX, z);
    const altitude = ground + 42 + rng() * 78;
    rings.push({
      index: i,
      x: courseX + (rng() - 0.5) * 60,
      y: altitude,
      z,
      radius: 20 + rng() * 10,
      passed: false,
    });
  }

  // A few distant peaks for the skyline silhouette.
  const peaks = [];
  for (let i = 0; i < 9; i++) {
    const px = (rng() - 0.5) * 2400;
    const pz = 600 + rng() * 3200;
    peaks.push({ x: px, z: pz, height: 140 + rng() * 160, width: 260 + rng() * 220 });
  }

  // Farmland and water, visual only: fixed patches along the flight corridor
  // so the ground reads as lived-in instead of one flat green. Generated
  // after the rings and peaks, so their seeded layout does not move.
  const fieldColors = ['#7a9a4a', '#b5a45e', '#5d8148', '#8a9a5b'];
  const fields = [];
  for (let i = 0; i < 10; i++) {
    const fx = (rng() - 0.5) * 900;
    const fz = 250 + rng() * 2200;
    if (Math.abs(fx) < 70 && fz < 500) continue; // keep the runway clear
    fields.push({
      x: fx,
      z: fz,
      w: 120 + rng() * 180,
      d: 90 + rng() * 160,
      color: fieldColors[i % fieldColors.length],
    });
  }
  const lakes = [];
  for (let i = 0; i < 3; i++) {
    const lx = (rng() - 0.5) * 800;
    const lz = 350 + rng() * 2000;
    if (Math.abs(lx) < 90 && lz < 600) continue;
    lakes.push({ x: lx, z: lz, rx: 90 + rng() * 120, rz: 60 + rng() * 90 });
  }

  return {
    seed: String(seed),
    heightAt,
    rawHeight,
    runway,
    rings,
    peaks,
    fields,
    lakes,
    courseLength: 420 + (ringCount - 1) * 260 + 400,
    groundAt(x, z) {
      return heightAt(x, z);
    },
    ringAt(i) {
      return rings[i] || null;
    },
    resetRings() {
      for (const r of rings) r.passed = false;
    },
  };
}

export default createWorld;

// --- Flight simulation -----------------------------------------------------

export const EVENT_RING = 1;
export const EVENT_HIT = 2;
export const EVENT_LAND = 4;
export const EVENT_SORTIE = 8;
export const EVENT_OVER = 16;
export const EVENT_FUEL_LOW = 32;

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function angleDelta(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * The plane and its sortie progress over a world. step() advances one fixed
 * step and returns what happened as bit flags, so the caller can react without
 * this module knowing about screens or sound. `controls` is
 * { turn: -1..1, throttle: -1..1, climb: -1..1 }.
 */
export function createFlight(world) {
  const runway = world.runway;
  const state = {
    x: 0,
    y: runway.elevation + 3,
    z: runway.z - runway.length / 2 + 30,
    heading: 0,
    speed: PLANE.baseSpeed,
    throttle: 0.35,
    fuel: FUEL.capacity,
    damage: 0,
    score: 0,
    sortieIndex: 0,
    ringsPassed: 0,
    landings: 0,
    time: 0,
    status: 'flying', // flying | landed | crashed | done
    message: '',
    fuelWarned: false,
    // True once the plane has climbed clear of the ground: only then does a
    // runway touchdown count as a landing, so sitting on the strip at the
    // start of a sortie cannot score over and over.
    airborne: false,
  };

  function sortie() {
    return SORTIES[state.sortieIndex] || null;
  }

  function nextRing() {
    const s = sortie();
    if (!s) return null;
    for (const i of s.rings) {
      if (!world.rings[i].passed) return world.rings[i];
    }
    return null;
  }

  /** Where the pilot should aim next: the next ring, or the runway. */
  function nextTarget() {
    const ring = nextRing();
    if (ring) return { kind: 'ring', x: ring.x, y: ring.y, z: ring.z, radius: ring.radius };
    return { kind: 'runway', x: runway.x, y: runway.elevation + 2, z: runway.z, radius: runway.width };
  }

  function reset() {
    state.x = 0;
    state.y = runway.elevation + 3;
    state.z = runway.z - runway.length / 2 + 30;
    state.heading = 0;
    state.speed = PLANE.baseSpeed;
    state.throttle = 0.35;
    state.fuel = FUEL.capacity;
    state.damage = 0;
    state.score = 0;
    state.sortieIndex = 0;
    state.ringsPassed = 0;
    state.landings = 0;
    state.time = 0;
    state.status = 'flying';
    state.message = '';
    state.fuelWarned = false;
    state.airborne = false;
    world.resetRings();
  }

  function advanceSortie(events) {
    state.score += SCORE.sortieBonus;
    state.sortieIndex += 1;
    if (state.sortieIndex >= SORTIES.length) {
      state.status = 'done';
      state.message = 'All sorties complete — courier run done.';
      return events | EVENT_OVER;
    }
    state.message = `Sortie ${state.sortieIndex + 1}: ${SORTIES[state.sortieIndex].name}`;
    return events | EVENT_SORTIE;
  }

  function checkSortieDone(events) {
    const s = sortie();
    if (!s) return events;
    if (nextRing() !== null) return events;
    if (s.needsLanding) return events; // landing completes it in step()
    return advanceSortie(events);
  }

  function step(dt, controls, harmless) {
    let events = 0;
    if (state.status === 'crashed' || state.status === 'done') return events;
    state.time += dt;

    // Throttle and steering. Turns stay effective at every speed, weaker slow.
    state.throttle = clamp(state.throttle + controls.throttle * PLANE.throttleRate * dt, 0, 1);
    const speedFactor = 0.55 + 0.45 * (state.speed / PLANE.maxSpeed);
    state.heading += controls.turn * PLANE.turnRate * speedFactor * dt;

    const targetSpeed = PLANE.baseSpeed + state.throttle * (PLANE.maxSpeed - PLANE.baseSpeed);
    if (state.fuel <= 0) {
      state.speed += (PLANE.baseSpeed * 0.4 - state.speed) * 0.6 * dt;
    } else {
      state.speed += (targetSpeed - state.speed) * 1.4 * dt;
    }

    // Climbing needs airspeed: the plane must roll up to speed on the runway
    // before it can leave the ground. Descending does not — gravity helps.
    const climbAuthority = clamp((state.speed - 45) / 60, 0, 1);
    const climbRate = controls.climb > 0 ? PLANE.climbRate * climbAuthority : PLANE.descendRate;
    state.y += controls.climb * climbRate * dt;
    state.x += Math.sin(state.heading) * state.speed * dt;
    state.z += Math.cos(state.heading) * state.speed * dt;

    // Fuel burns faster the harder the throttle is pushed.
    if (!harmless) {
      state.fuel = Math.max(
        0,
        state.fuel - (FUEL.drainIdle + state.throttle * (FUEL.drainFull - FUEL.drainIdle)) * dt,
      );
      if (state.fuel <= FUEL.lowWarning && !state.fuelWarned) {
        state.fuelWarned = true;
        events |= EVENT_FUEL_LOW;
      }
    }

    const ground = world.heightAt(state.x, state.z);
    if (state.y - ground > 14) state.airborne = true;

    // Ring crossings: crossing the ring's z-plane inside its circle scores.
    const ring = nextRing();
    if (ring && !harmless) {
      const prevZ = state.z - Math.cos(state.heading) * state.speed * dt;
      const crossed = (prevZ < ring.z && state.z >= ring.z) || (prevZ > ring.z && state.z <= ring.z);
      if (crossed) {
        const dx = state.x - ring.x;
        const dy = state.y - ring.y;
        if (Math.sqrt(dx * dx + dy * dy) < ring.radius) {
          ring.passed = true;
          state.ringsPassed += 1;
          state.score += SCORE.ring;
          events |= EVENT_RING;
          events = checkSortieDone(events);
        }
      }
    }

    // Runway touchdown: low, slow, lined up with the strip.
    const overRunway =
      Math.abs(state.x - runway.x) < runway.width / 2 + 4 &&
      Math.abs(state.z - runway.z) < runway.length / 2;
    if (overRunway && !harmless) {
      const heightAbove = state.y - runway.elevation;
      // A strip can be landed from either end: lined up with it in either
      // direction counts.
      const offAxis = Math.abs(angleDelta(state.heading, 0));
      const aligned = Math.min(offAxis, Math.abs(offAxis - Math.PI)) < 0.35;
      if (state.airborne && heightAbove < 5 && state.speed < 95 && aligned) {
        state.status = 'landed';
        state.airborne = false;
        state.landings += 1;
        state.score += SCORE.landing;
        state.fuel = FUEL.capacity;
        state.damage = 0;
        state.fuelWarned = false;
        state.y = runway.elevation + 2;
        state.speed = 0;
        state.throttle = 0;
        events |= EVENT_LAND;
        const s = sortie();
        if (s && s.needsLanding && nextRing() === null) {
          events = advanceSortie(events);
          if (state.status !== 'done') state.status = 'flying';
        } else if (state.status === 'landed') {
          // A refuel stop mid-sortie: back in the air on the next step.
          state.status = 'flying';
        }
        return events;
      }
    }

    // Terrain: flying into the ground hurts; enough damage ends the flight.
    if (state.y <= ground + 1.5) {
      if (harmless) {
        state.y = ground + 3;
      } else {
        state.damage += DAMAGE.terrainHit;
        state.y = ground + 4;
        state.speed *= 0.55;
        events |= EVENT_HIT;
        if (state.damage >= DAMAGE.max || state.fuel <= 0) {
          state.status = 'crashed';
          state.message = 'Crashed into the terrain.';
          return events | EVENT_OVER;
        }
      }
    }

    // Out of fuel with no runway under you: glide down until the ground ends it.
    if (state.fuel <= 0 && state.y <= ground + 2 && !harmless) {
      state.status = 'crashed';
      state.message = 'Out of fuel — forced landing short of the runway.';
      return events | EVENT_OVER;
    }

    return events;
  }

  reset();
  return { state, reset, step, sortie, nextRing, nextTarget, world };
}
