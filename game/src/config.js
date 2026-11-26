// config.js — every tuning number and colour for Skyline Courier in one place.
// The playfield is a fixed 1280x720 logical area; the renderer scales it to the
// window, so no rule below depends on the screen size.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second. */
export const STEP = 1 / 60;

export const PLANE = {
  baseSpeed: 42,
  maxSpeed: 165,
  turnRate: 0.85,
  climbRate: 30,
  descendRate: 42,
  throttleRate: 0.55,
  cruiseThrottle: 0.62,
  cameraBehind: 26,
  cameraAbove: 7,
  focal: 620,
};

export const FUEL = {
  capacity: 100,
  drainFull: 1.7,
  drainIdle: 0.3,
  lowWarning: 25,
};

export const DAMAGE = {
  max: 100,
  terrainHit: 34,
  ringGraze: 0,
};

export const SCORE = {
  ring: 150,
  landing: 400,
  delivery: 250,
  sortieBonus: 200,
};

export const SORTIES = [
  { name: 'Ring Run', goal: 'Fly through rings 1–6', rings: [0, 1, 2, 3, 4, 5], needsLanding: false },
  { name: 'Runway Landing', goal: 'Land on the runway', rings: [], needsLanding: true },
  { name: 'Courier Delivery', goal: 'Fly rings 7–14, then land', rings: [6, 7, 8, 9, 10, 11, 12, 13], needsLanding: true },
];

export const PALETTE = {
  backdrop: '#0b1020',
  skyTop: '#2f6fb4',
  skyMid: '#7fb2e0',
  skyLow: '#cfe6f5',
  sun: '#ffe9a8',
  groundLow: '#4d7a3d',
  groundMid: '#6b8f4e',
  groundHigh: '#8a7a5a',
  rock: '#7d7468',
  snow: '#eef3f6',
  grid: 'rgba(255,255,255,0.16)',
  runway: '#3a3f4a',
  runwayEdge: '#f2f2f2',
  runwayLine: '#ffd94d',
  ring: '#ffb400',
  ringGlow: 'rgba(255,180,0,0.45)',
  ringDone: '#7ddc8a',
  planeBody: '#e8eef4',
  planeWing: '#c33d2e',
  planeGlass: '#1d3a5f',
  planeTrim: '#f2a900',
  hud: '#eef4f8',
  hudDim: '#aebfd0',
  hudWarn: '#ff5a4d',
  hudGood: '#7ddc8a',
  panel: 'rgba(12,18,34,0.88)',
  panelEdge: '#3d5a80',
  text: '#eef1f5',
  muted: '#9fb2c8',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'skyline-courier.best';
