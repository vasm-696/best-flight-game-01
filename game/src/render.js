// render.js — drawing only: the flight state and the world in, pixels out.
// A pseudo-3D chase view: the camera sits behind and above the plane and looks
// along its heading. Terrain is drawn as projected ground strips, the runway as
// a perspective strip, rings as gold circles facing the camera, and the plane
// itself is drawn in the frame, banking with the turn. The 1280x720 playfield
// is scaled to fit the window and centred.

import { FIELD, FONT, PALETTE, PLANE } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const CX = FIELD.width / 2;
const HORIZON_BASE = 300;
const FOCAL = PLANE.focal;

// Fixed cloud angles (radians around the compass) and heights: no randomness.
const CLOUDS = [
  { angle: 0.4, height: 190, size: 150 },
  { angle: 1.2, height: 230, size: 210 },
  { angle: 2.1, height: 170, size: 130 },
  { angle: 2.9, height: 250, size: 190 },
  { angle: 3.8, height: 200, size: 160 },
  { angle: 4.6, height: 240, size: 220 },
  { angle: 5.4, height: 180, size: 140 },
  { angle: 5.9, height: 260, size: 170 },
];

function groundColor(h) {
  if (h > 130) return PALETTE.snow;
  if (h > 95) return PALETTE.rock;
  if (h > 55) return PALETTE.groundHigh;
  if (h > 22) return PALETTE.groundMid;
  return PALETTE.groundLow;
}

function headingDegrees(heading) {
  let d = (heading * 180) / Math.PI;
  d = ((d % 360) + 360) % 360;
  return d;
}

function compassLabel(deg) {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(deg / 45) % 8];
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const fonts = new Map();

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  function text(value, x, y, size, color, align, baseline) {
    if (!fonts.has(size)) fonts.set(size, `${size}px ${FONT}`);
    context.font = fonts.get(size);
    context.fillStyle = color;
    context.textAlign = align || 'left';
    context.textBaseline = baseline || 'alphabetic';
    context.fillText(value, x, y);
  }

  function drawSky(heading, time) {
    const sky = context.createLinearGradient(0, 0, 0, HORIZON_BASE + 120);
    sky.addColorStop(0, PALETTE.skyTop);
    sky.addColorStop(0.55, PALETTE.skyMid);
    sky.addColorStop(1, PALETTE.skyLow);
    context.fillStyle = sky;
    context.fillRect(0, 0, FIELD.width, HORIZON_BASE + 130);
    // Sun: fixed ahead-right of the course so every shot has the same light.
    const sunAngle = 0.9 - heading;
    const sunX = CX + Math.sin(sunAngle) * 420;
    const sunY = 108 - Math.cos(sunAngle) * 30 + Math.sin(time * 0.05) * 2;
    context.fillStyle = PALETTE.sun;
    context.beginPath();
    context.arc(sunX, sunY, 34, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(255,233,168,0.25)';
    context.beginPath();
    context.arc(sunX, sunY, 52, 0, Math.PI * 2);
    context.fill();
    // Clouds: fixed angles, drifting slowly with time, wrapped around the compass.
    context.fillStyle = 'rgba(255,255,255,0.85)';
    for (const cloud of CLOUDS) {
      let rel = cloud.angle - heading + time * 0.002;
      rel = ((rel + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      if (Math.abs(rel) > 1.1) continue;
      const x = CX + rel * 620;
      const y = cloud.height - 40;
      context.beginPath();
      context.ellipse(x, y, cloud.size / 2, 20, 0, 0, Math.PI * 2);
      context.ellipse(x + 40, y + 8, cloud.size / 3, 15, 0, 0, Math.PI * 2);
      context.fill();
    }
  }

  function makeProjector(plane, pitch) {
    const sinH = Math.sin(plane.heading);
    const cosH = Math.cos(plane.heading);
    const cam = {
      x: plane.x - sinH * PLANE.cameraBehind,
      y: plane.y + PLANE.cameraAbove,
      z: plane.z - cosH * PLANE.cameraBehind,
    };
    const horizonY = HORIZON_BASE + pitch * 46;
    return {
      cam,
      horizonY,
      project(px, py, pz) {
        const dx = px - cam.x;
        const dy = py - cam.y;
        const dz = pz - cam.z;
        const fwd = dx * sinH + dz * cosH;
        if (fwd < 6) return null;
        const lat = dx * cosH - dz * sinH;
        return {
          x: CX + (lat / fwd) * FOCAL,
          y: horizonY - (dy / fwd) * FOCAL,
          fwd,
        };
      },
      // Same projection, but points behind the camera are clamped onto the
      // near plane instead of dropped: used for the runway strip, which the
      // camera can straddle at takeoff, so the strip still reads instead of
      // vanishing the moment its near end passes behind the camera.
      projectClamped(px, py, pz) {
        const dx = px - cam.x;
        const dy = py - cam.y;
        const dz = pz - cam.z;
        const fwd = Math.max(dx * sinH + dz * cosH, 6);
        const lat = dx * cosH - dz * sinH;
        return {
          x: CX + (lat / fwd) * FOCAL,
          y: horizonY - (dy / fwd) * FOCAL,
          fwd,
        };
      },
    };
  }

  function drawTerrain(world, projector) {
    // Ground strips, far to near: each row samples the heightmap across the
    // view and is filled by the height at its centre.
    const rows = [];
    let d = 42;
    while (d < 1500) {
      rows.push(d);
      d *= 1.17;
    }
    const cols = 14;
    for (let r = rows.length - 1; r >= 0; r--) {
      const d0 = rows[r];
      const d1 = r + 1 < rows.length ? rows[r + 1] : d0 * 1.17;
      // Wide enough that the far rows still span the frame: at 0.95 the
      // strips stopped short of the screen edges and left dark bands.
      const spread0 = d0 * 1.35;
      const spread1 = d1 * 1.35;
      const pts0 = [];
      const pts1 = [];
      let centreH = 0;
      for (let c = 0; c <= cols; c++) {
        const t = c / cols - 0.5;
        const wx0 = projector.cam.x + Math.sin(0) * 0 + t * 2 * spread0;
        void wx0;
        // World point at distance d along the heading, offset laterally by t.
        const sinH = Math.sin(currentHeading);
        const cosH = Math.cos(currentHeading);
        const x0 = projector.cam.x + sinH * d0 + cosH * t * 2 * spread0;
        const z0 = projector.cam.z + cosH * d0 - sinH * t * 2 * spread0;
        const x1 = projector.cam.x + sinH * d1 + cosH * t * 2 * spread1;
        const z1 = projector.cam.z + cosH * d1 - sinH * t * 2 * spread1;
        const h0 = world.heightAt(x0, z0);
        const h1 = world.heightAt(x1, z1);
        if (c === Math.floor(cols / 2)) centreH = (h0 + h1) / 2;
        pts0.push(projector.project(x0, h0, z0));
        pts1.push(projector.project(x1, h1, z1));
      }
      if (!pts0[0] || !pts1[0]) continue;
      context.fillStyle = groundColor(centreH);
      context.beginPath();
      context.moveTo(pts0[0].x, pts0[0].y);
      for (let c = 1; c <= cols; c++) if (pts0[c]) context.lineTo(pts0[c].x, pts0[c].y);
      for (let c = cols; c >= 0; c--) if (pts1[c]) context.lineTo(pts1[c].x, pts1[c].y);
      context.closePath();
      context.fill();
    }
    // Ground grid: a few fixed world-x lines running ahead, faint white.
    context.strokeStyle = PALETTE.grid;
    context.lineWidth = 1;
    // No line on the flight path itself: gx=0 ran straight through the
    // plane and read as a string tied to its nose.
    for (let gx = -600; gx <= 600; gx += 200) {
      if (gx === 0) continue;
      context.beginPath();
      let started = false;
      for (let z = 0; z <= 900; z += 60) {
        const p = projector.project(
          projector.cam.x + Math.sin(currentHeading) * z + Math.cos(currentHeading) * (gx - 0),
          world.heightAt(
            projector.cam.x + Math.sin(currentHeading) * z + Math.cos(currentHeading) * gx,
            projector.cam.z + Math.cos(currentHeading) * z - Math.sin(currentHeading) * gx,
          ) + 0.4,
          projector.cam.z + Math.cos(currentHeading) * z - Math.sin(currentHeading) * gx,
        );
        if (!p) continue;
        if (!started) {
          context.moveTo(p.x, p.y);
          started = true;
        } else context.lineTo(p.x, p.y);
      }
      context.stroke();
    }
  }

  // The heading the terrain pass is drawing for; set once per frame.
  let currentHeading = 0;

  function drawPeaks(world, projector) {
    for (const peak of world.peaks) {
      const base = projector.project(peak.x, world.heightAt(peak.x, peak.z), peak.z);
      const top = projector.project(peak.x, peak.height, peak.z);
      if (!base || !top) continue;
      const half = (peak.width / base.fwd) * FOCAL * 0.5;
      context.fillStyle = 'rgba(125,116,104,0.85)';
      context.beginPath();
      context.moveTo(base.x - half, base.y);
      context.lineTo(top.x, top.y);
      context.lineTo(base.x + half, base.y);
      context.closePath();
      context.fill();
      context.fillStyle = 'rgba(238,243,246,0.9)';
      context.beginPath();
      context.moveTo(top.x - half * 0.32, top.y + (base.y - top.y) * 0.3);
      context.lineTo(top.x, top.y);
      context.lineTo(top.x + half * 0.32, top.y + (base.y - top.y) * 0.3);
      context.closePath();
      context.fill();
    }
  }

  function drawRunway(world, projector) {
    const r = world.runway;
    const half = r.width / 2;
    // If the whole strip is behind the camera there is nothing to draw;
    // otherwise clamp the near corners onto the near plane instead of
    // dropping the strip — at takeoff the plane is already past the
    // threshold, and the old all-or-nothing check made the runway vanish
    // from the cover shot entirely.
    const ahead = [
      projector.project(r.x - half, r.elevation + 0.3, r.z - r.length / 2),
      projector.project(r.x + half, r.elevation + 0.3, r.z - r.length / 2),
      projector.project(r.x + half, r.elevation + 0.3, r.z + r.length / 2),
      projector.project(r.x - half, r.elevation + 0.3, r.z + r.length / 2),
    ];
    if (ahead.every((c) => c === null)) return;
    const corners = [
      projector.projectClamped(r.x - half, r.elevation + 0.3, r.z - r.length / 2),
      projector.projectClamped(r.x + half, r.elevation + 0.3, r.z - r.length / 2),
      projector.projectClamped(r.x + half, r.elevation + 0.3, r.z + r.length / 2),
      projector.projectClamped(r.x - half, r.elevation + 0.3, r.z + r.length / 2),
    ];
    context.fillStyle = PALETTE.runway;
    context.beginPath();
    context.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) context.lineTo(corners[i].x, corners[i].y);
    context.closePath();
    context.fill();
    context.strokeStyle = PALETTE.runwayEdge;
    context.lineWidth = 2;
    context.stroke();
    // Centreline dashes, stepping along the strip.
    context.strokeStyle = PALETTE.runwayLine;
    context.lineWidth = 2;
    for (let s = -r.length / 2 + 20; s < r.length / 2 - 10; s += 40) {
      const a = projector.projectClamped(r.x, r.elevation + 0.5, r.z + s);
      const b = projector.projectClamped(r.x, r.elevation + 0.5, r.z + s + 20);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }
  }

  function drawRings(world, projector, nextRing) {
    const sorted = [...world.rings].sort((a, b) => b.z - a.z);
    for (const ring of sorted) {
      const p = projector.project(ring.x, ring.y, ring.z);
      if (!p) continue;
      const rx = (ring.radius / p.fwd) * FOCAL;
      if (rx < 4) continue;
      const isNext = nextRing && ring.index === nextRing.index;
      context.lineWidth = Math.max(2, rx * 0.09);
      if (ring.passed) {
        context.strokeStyle = PALETTE.ringDone;
      } else if (isNext) {
        context.strokeStyle = PALETTE.ring;
        context.fillStyle = PALETTE.ringGlow;
        context.beginPath();
        context.ellipse(p.x, p.y, rx * 1.25, rx * 1.15, 0, 0, Math.PI * 2);
        context.fill();
      } else {
        context.strokeStyle = 'rgba(255,180,0,0.32)';
      }
      context.beginPath();
      context.ellipse(p.x, p.y, rx, rx * 0.92, 0, 0, Math.PI * 2);
      context.stroke();
      if (isNext) {
        // Keep the label clear of the compass and instrument band at the
        // top: when the ring rides high, label it from below instead.
        const labelY = p.y - rx - 10;
        if (labelY < 100) text(`RING ${ring.index + 1}`, p.x, p.y + rx + 30, 20, PALETTE.ring, 'center');
        else text(`RING ${ring.index + 1}`, p.x, labelY, 20, PALETTE.ring, 'center');
      }
    }
  }

  function drawPlane(plane, bank, throttle) {
    const px = CX;
    const py = 498;
    context.save();
    context.translate(px, py);
    context.rotate(bank);
    // Main wing: wide, tapered, red tips.
    context.fillStyle = PALETTE.planeWing;
    context.beginPath();
    context.moveTo(-118, 6);
    context.lineTo(-30, -6);
    context.lineTo(30, -6);
    context.lineTo(118, 6);
    context.lineTo(104, 16);
    context.lineTo(-104, 16);
    context.closePath();
    context.fill();
    // Tailplane.
    context.fillStyle = PALETTE.planeBody;
    context.beginPath();
    context.moveTo(-42, -52);
    context.lineTo(-12, -58);
    context.lineTo(12, -58);
    context.lineTo(42, -52);
    context.lineTo(30, -40);
    context.lineTo(-30, -40);
    context.closePath();
    context.fill();
    // Fuselage, seen from behind and above.
    context.fillStyle = PALETTE.planeBody;
    context.beginPath();
    context.moveTo(-16, -62);
    context.quadraticCurveTo(0, -72, 16, -62);
    context.lineTo(20, 34);
    context.quadraticCurveTo(0, 46, -20, 34);
    context.closePath();
    context.fill();
    // Tail fin.
    context.fillStyle = PALETTE.planeWing;
    context.beginPath();
    context.moveTo(-4, -60);
    context.lineTo(0, -92);
    context.lineTo(6, -60);
    context.closePath();
    context.fill();
    // Cockpit glass.
    context.fillStyle = PALETTE.planeGlass;
    context.beginPath();
    context.ellipse(0, -38, 10, 16, 0, 0, Math.PI * 2);
    context.fill();
    // Gold trim stripe down the fuselage.
    context.fillStyle = PALETTE.planeTrim;
    context.fillRect(-2, -30, 4, 58);
    // Engine glow grows with throttle.
    if (throttle > 0.15) {
      context.fillStyle = `rgba(255,170,60,${0.25 + throttle * 0.5})`;
      context.beginPath();
      context.ellipse(0, 48, 8, 10 + throttle * 16, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawCompass(heading) {
    const deg = headingDegrees(heading);
    const y = 26;
    context.save();
    context.beginPath();
    context.rect(CX - 190, 8, 380, 34);
    context.clip();
    context.fillStyle = 'rgba(12,18,34,0.55)';
    context.fillRect(CX - 190, 8, 380, 34);
    for (let off = -180; off <= 180; off += 15) {
      const a = deg + off;
      const norm = ((a % 360) + 360) % 360;
      const x = CX + off * 1.05;
      // Round before the modulo: with a fractional heading the exact
      // equality almost never hit, so the letters only appeared when the
      // heading was exactly a multiple of 15 degrees.
      const major = Math.round(norm) % 45 === 0;
      context.strokeStyle = major ? PALETTE.hud : PALETTE.hudDim;
      context.lineWidth = major ? 2 : 1;
      // Ticks live in the top half of the strip, labels in the bottom
      // half: the old ticks ran through the label row and the letters
      // read as a jumble with a line struck through each one.
      context.beginPath();
      context.moveTo(x, y + 2);
      context.lineTo(x, y + (major ? -8 : -2));
      context.stroke();
      if (major) text(compassLabel(Math.round(norm)), x, y + 2, 13, PALETTE.hud, 'center', 'top');
    }
    context.restore();
    context.strokeStyle = PALETTE.hud;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(CX, 8);
    context.lineTo(CX, 18);
    context.stroke();
    text(`${Math.round(deg)}°`, CX, 52, 18, PALETTE.hud, 'center', 'top');
  }

  function bar(x, y, w, h, frac, color, label) {
    context.fillStyle = 'rgba(12,18,34,0.6)';
    context.fillRect(x, y, w, h);
    context.fillStyle = color;
    context.fillRect(x + 2, y + 2, Math.max(0, (w - 4) * Math.max(0, Math.min(1, frac))), h - 4);
    context.strokeStyle = PALETTE.hudDim;
    context.lineWidth = 1;
    context.strokeRect(x, y, w, h);
    text(label, x, y - 6, 15, PALETTE.hud, 'left', 'bottom');
  }

  function drawArtificialHorizon(bank, pitch) {
    const cx = FIELD.width - 92;
    const cy = FIELD.height - 92;
    const r = 52;
    context.save();
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    context.clip();
    context.translate(cx, cy);
    context.rotate(-bank);
    context.translate(0, pitch * 30);
    context.fillStyle = '#5aa0d8';
    context.fillRect(-r, -r, r * 2, r);
    context.fillStyle = '#8a6a44';
    context.fillRect(-r, 0, r * 2, r);
    context.fillStyle = PALETTE.hud;
    context.fillRect(-r, -1, r * 2, 2);
    context.restore();
    context.strokeStyle = PALETTE.hud;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    context.stroke();
    // Fixed aircraft symbol.
    context.fillStyle = PALETTE.hudWarn;
    context.fillRect(cx - 16, cy - 2, 12, 4);
    context.fillRect(cx + 4, cy - 2, 12, 4);
    context.fillRect(cx - 2, cy - 2, 4, 4);
    text('ATT', cx, cy + r + 18, 13, PALETTE.hudDim, 'center', 'top');
  }

  function drawHud(flight, world, tilt) {
    const s = flight.state;
    const deg = headingDegrees(s.heading);
    const target = flight.nextTarget();
    // Top-left instrument boxes.
    const boxes = [
      [`ALT`, `${Math.round(s.y * 3)} ft`],
      [`SPD`, `${Math.round(s.speed * 1.9)} kt`],
      [`HDG`, `${Math.round(deg)}°`],
    ];
    boxes.forEach(([label, value], i) => {
      const x = 22 + i * 132;
      context.fillStyle = 'rgba(12,18,34,0.6)';
      context.fillRect(x, 14, 120, 52);
      text(label, x + 10, 28, 14, PALETTE.hudDim, 'left', 'top');
      text(value, x + 10, 46, 22, PALETTE.hud, 'left', 'top');
    });
    drawCompass(s.heading);
    // Top-right: score, sortie, time.
    const sortie = flight.sortie();
    text(`SCORE ${s.score}`, FIELD.width - 22, 24, 24, PALETTE.hud, 'right', 'top');
    text(
      sortie ? `SORTIE ${s.sortieIndex + 1}/3 · ${sortie.name}` : 'COURSE COMPLETE',
      FIELD.width - 22,
      52,
      16,
      PALETTE.hudDim,
      'right',
      'top',
    );
    text(`${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}`, FIELD.width - 22, 74, 16, PALETTE.hudDim, 'right', 'top');
    // Bottom-left fuel and damage bars.
    bar(22, FIELD.height - 66, 220, 16, s.fuel / 100, s.fuel < 25 ? PALETTE.hudWarn : PALETTE.hudGood, `FUEL ${Math.round(s.fuel)}%`);
    bar(22, FIELD.height - 30, 220, 16, 1 - s.damage / 100, s.damage > 60 ? PALETTE.hudWarn : PALETTE.hudGood, `DAMAGE ${Math.min(100, Math.round(s.damage))}%`);
    drawArtificialHorizon(tilt.bank, tilt.pitch);
    // Target readout: distance and direction to the next ring or the runway.
    if (target) {
      const dx = target.x - s.x;
      const dz = target.z - s.z;
      const dist = Math.round(Math.sqrt(dx * dx + dz * dz));
      const label = target.kind === 'ring' ? `RING ${world.rings.findIndex((r) => r.x === target.x && r.z === target.z) + 1}` : 'RUNWAY';
      const turnTo = Math.atan2(dx, dz);
      let rel = turnTo - s.heading;
      rel = ((rel + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const arrow = rel > 0.25 ? '▶' : rel < -0.25 ? '◀' : '▲';
      text(`${arrow} ${label} · ${dist}m`, CX, 84, 20, PALETTE.ring, 'center', 'top');
    }
    if (s.message) text(s.message, CX, 112, 18, PALETTE.hud, 'center', 'top');
    if (s.fuel < 25 && s.status === 'flying') {
      const blink = Math.floor(s.time * 2) % 2 === 0;
      if (blink) text('LOW FUEL — land on the runway', CX, 140, 20, PALETTE.hudWarn, 'center', 'top');
    }
  }

  function drawPanel(title, lines, prompt) {
    const width = 640;
    const height = 150 + lines.length * 34;
    const x = (FIELD.width - width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = PALETTE.panel;
    context.fillRect(x, y, width, height);
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.strokeRect(x, y, width, height);
    text(title, FIELD.width / 2, y + 62, 46, PALETTE.text, 'center');
    lines.forEach((line, i) => {
      text(line, FIELD.width / 2, y + 112 + i * 34, 20, PALETTE.muted, 'center');
    });
    text(prompt, FIELD.width / 2, y + height - 34, 22, PALETTE.ring, 'center');
  }

  // Compact title block tucked into the upper-right corner: the old centred
  // panel hid the plane, so the title now leaves the centre of the frame —
  // the plane, the runway ahead and the next ring — in the open. Right, not
  // left, so the first ring (centre-left in the start shot) stays clear.
  function drawTitlePanel(best) {
    const width = 520;
    const height = 240;
    const x = FIELD.width - 24 - width;
    const y = 150;
    context.fillStyle = PALETTE.panel;
    context.fillRect(x, y, width, height);
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.strokeRect(x, y, width, height);
    text('Skyline Courier', x + 24, y + 52, 38, PALETTE.text, 'left');
    const lines = [
      'Fly the courier run: rings, runway landings,',
      'fuel and damage across three sorties.',
      'W/S throttle · A/D turn · R/F climb/descend.',
      best > 0 ? `Best score ${best}` : 'First flight — make it count.',
    ];
    lines.forEach((line, i) => {
      text(line, x + 24, y + 96 + i * 30, 16, PALETTE.muted, 'left');
    });
    text('Press Space or click to start', x + 24, y + height - 26, 19, PALETTE.ring, 'left');
  }

  function draw(flight, world, screen, best, tilt) {
    const s = flight.state;
    const t = tilt || { bank: 0, pitch: 0 };
    currentHeading = s.heading;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    const projector = makeProjector(s, t.pitch);
    drawSky(s.heading, s.time);
    // Fill below the horizon before the terrain strips paint over it.
    context.fillStyle = PALETTE.groundLow;
    context.fillRect(0, projector.horizonY, FIELD.width, FIELD.height - projector.horizonY);
    drawPeaks(world, projector);
    drawTerrain(world, projector);
    drawRunway(world, projector);
    drawRings(world, projector, flight.nextRing());
    drawPlane(s, t.bank, s.throttle);
    if (screen === SCREEN_TITLE) {
      // Instruments stay lit behind the title: the cover should read as a
      // flight in progress, not a menu over a postcard.
      drawHud(flight, world, t);
      drawTitlePanel(best);
      return;
    }
    drawHud(flight, world, t);
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The sky will wait for you.'], 'Press P to resume');
    } else if (screen === SCREEN_OVER) {
      const won = s.status === 'done';
      drawPanel(
        won ? 'Courier run complete' : 'Flight over',
        [
          s.message || (won ? 'All sorties complete.' : 'The courier run ended here.'),
          `Score ${s.score} · Rings ${s.ringsPassed} · Landings ${s.landings}`,
          `Best ${Math.max(best, s.score)}`,
        ],
        'Press Space or click to fly again',
      );
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
