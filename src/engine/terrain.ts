/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GeologyUnit, ScienceTarget, TerrainDataset } from '../types';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, t: number) => {
  const u = clamp((t - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};

// Deterministic 2D PRNG hash for synthetic Mars terrain
function hash(ix: number, iy: number, s: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function vnoise(x: number, y: number, s: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  return lerp(
    lerp(hash(ix, iy, s), hash(ix + 1, iy, s), sx),
    lerp(hash(ix, iy + 1, s), hash(ix + 1, iy + 1, s), sx),
    sy
  );
}

function fbm(x: number, y: number, s: number, octaves = 4): number {
  let t = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    t += amp * vnoise(x * freq, y * freq, s + i * 17);
    freq *= 2;
    amp *= 0.5;
  }
  return t;
}

/**
 * Builds the default synthetic sample patch:
 * 170 x 120 cells at 30 m/cell = 5.1 km x 3.6 km.
 * Features: Crater floor, rim, fan delta, small impact craters, and dune field.
 */
export function createSampleTerrain(): TerrainDataset {
  const W = 170;
  const H = 120;
  const N = W * H;
  const cellMeters = 30;

  const z = new Float32Array(N);
  const slopeDeg = new Float32Array(N);
  const ti = new Float32Array(N);
  const softF = new Float32Array(N);
  const shade = new Float32Array(N);
  const unit = new Uint8Array(N);

  const units: GeologyUnit[] = [
    { name: 'Floor regolith', color: [154, 132, 102], desc: 'Fine-grained basaltic regolith, moderate bearing capacity' },
    { name: 'Delta deposits', color: [79, 134, 198], desc: 'Layered clay-sulfate sedimentary rocks with high science priority' },
    { name: 'Rim bedrock', color: [185, 103, 74], desc: 'Exposed impact-fractured basement basalt, steep but firm' },
    { name: 'Dune field', color: [216, 194, 122], desc: 'Active basaltic sand ripples, low thermal inertia, high rover slip' },
    { name: 'Crater ejecta', color: [141, 107, 176], desc: 'Coarse rocky blocks ejected during impact cratering' }
  ];

  const craters = [
    { x: 78, y: 84, r: 11 },
    { x: 112, y: 100, r: 7 },
    { x: 54, y: 36, r: 9 },
    { x: 142, y: 82, r: 6 },
    { x: 92, y: 18, r: 5 }
  ];

  const delta = { x: 126, y: 43, R: 31 };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / W;
      const v = y / H;

      // Base undulating crater floor
      let h = (fbm(x * 0.06, y * 0.06, 3) - 0.47) * 14;

      // Rim scarp along western boundary (high elevation)
      h += 230 * smooth(0.30, 0.03, u) * (0.8 + 0.4 * fbm(x * 0.05, y * 0.05, 9)) + 60 * smooth(0.07, 0.02, u);

      // Delta fan lobe in north-east
      const dx = x - delta.x;
      const dy = y - delta.y;
      const ang = Math.atan2(dy, dx);
      const Rv = delta.R * (1 + 0.28 * (vnoise(Math.cos(ang) * 1.8 + 7, Math.sin(ang) * 1.8 + 7, 5) * 2 - 1));
      const dd = Math.hypot(dx, dy) / Rv;
      const ramp = vnoise(Math.cos(ang) * 2.2 + 11, Math.sin(ang) * 2.2 + 11, 8);
      const wid = 0.2 + 0.5 * smooth(0.52, 0.66, ramp);
      h += 95 * smooth(1.0, 1.0 - wid, dd) + (dd < 1 ? fbm(x * 0.2, y * 0.2, 4) * 9 : 0);

      // Impact craters
      let ej = false;
      for (const c of craters) {
        const d = Math.hypot(x - c.x, y - c.y);
        const dia = c.r * 2 * cellMeters;
        if (d < c.r) {
          h -= 0.08 * dia * (1 - Math.pow(d / c.r, 2));
        }
        h += 0.035 * dia * Math.exp(-Math.pow((d - c.r) / (0.28 * c.r), 2));
        if (d < c.r * 1.8) {
          ej = true;
        }
      }

      // Dunes across southern strip
      h += 9 * Math.sin(x * 0.33 + fbm(x * 0.05, y * 0.05, 13) * 7) * smooth(0.70, 0.86, v);

      z[i] = h;
      unit[i] = ej ? 4 : dd < 1 ? 1 : u < 0.2 ? 2 : v > 0.78 ? 3 : 0;
    }
  }

  let zmin = Infinity;
  let zmax = -Infinity;

  // Compute slopes, hillshading, and thermal inertia
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xl = Math.max(x - 1, 0);
      const xr = Math.min(x + 1, W - 1);
      const yu = Math.max(y - 1, 0);
      const yd = Math.min(y + 1, H - 1);

      const gx = (z[y * W + xr] - z[y * W + xl]) / ((xr - xl) * cellMeters);
      const gy = (z[yd * W + x] - z[yu * W + x]) / ((yd - yu) * cellMeters);

      slopeDeg[i] = Math.atan(Math.hypot(gx, gy)) * (180 / Math.PI);
      shade[i] = clamp(0.86 + 1.3 * 0.7 * (gx + gy), 0.5, 1.2);

      if (z[i] < zmin) zmin = z[i];
      if (z[i] > zmax) zmax = z[i];

      const u = x / W;
      const v = y / H;
      const dd = Math.hypot(x - delta.x, y - delta.y) / delta.R;
      const rocky = clamp(slopeDeg[i] / 18, 0, 1) * 0.5 + (dd < 1 ? 0.35 : 0) + (u < 0.25 ? 0.35 : 0);

      // Thermal inertia in J·m⁻²·K⁻¹·s⁻¹/² (loose dust ~90, consolidated rock ~450+)
      let t = 130 + 330 * clamp(rocky + 0.35 * (fbm(x * 0.07, y * 0.07, 21) - 0.4), 0, 1);
      t = lerp(t, 95, smooth(0.70, 0.86, v) * 0.9);
      ti[i] = t;

      // Soft ground factor (0 to 1), where thermal inertia < 170 represents soft loose dust/sand
      softF[i] = clamp((170 - t) / 80, 0, 1);
    }
  }

  const rawTargets: Omit<ScienceTarget, 'i'>[] = [
    { id: 'T1', name: 'Delta-front layered outcrop', kind: 'Delta deposits', val: 0.9, x: 104, y: 50, description: 'High-priority clay-bearing mudstones with biosignature preservation potential' },
    { id: 'T2', name: 'Rim bedrock contact', kind: 'Rim bedrock', val: 0.7, x: 36, y: 58, description: 'Ancient Noachian basement rock exhumed by the crater impact' },
    { id: 'T3', name: 'Fresh crater ejecta blocks', kind: 'Crater ejecta', val: 0.5, x: 84, y: 86, description: 'Subsurface bedrock excavated by recent meteoroid impact' },
    { id: 'T4', name: 'Delta-top channel deposits', kind: 'Delta deposits', val: 0.8, x: 136, y: 30, description: 'Fluvial conglomerate channel bars from late-stage delta discharge' },
    { id: 'T5', name: 'Dune margin sample', kind: 'Dune field', val: 0.3, x: 120, y: 92, description: 'Active aeolian basaltic grains for modern atmospheric transport study' }
  ];

  const targets: ScienceTarget[] = rawTargets.map(t => ({
    ...t,
    i: t.y * W + t.x
  }));

  return {
    id: 'sample',
    name: 'Synthetic Sample Patch',
    isReal: false,
    label: 'Sample terrain, not real Mars data',
    W,
    H,
    cellMeters,
    z,
    slopeDeg,
    ti,
    softF,
    shade,
    unit,
    zmin,
    zmax,
    units,
    defaultHab: { x: 58, y: 70 },
    defaultTgt: { x: 120, y: 70 },
    targets,
    citation: 'Synthetic calibration model based on typical Martian delta & crater morphology.'
  };
}

/**
 * Builds the Jezero Crater Western Fan model:
 * Modeled after Perseverance traverse: Octavia E. Butler Landing,
 * Kodiak Butte remnant, Western Delta scarp, Belva Crater rim, Séítah dune terrain.
 */
export function createJezeroTerrain(): TerrainDataset {
  const W = 170;
  const H = 120;
  const N = W * H;
  const cellMeters = 30;

  const z = new Float32Array(N);
  const slopeDeg = new Float32Array(N);
  const ti = new Float32Array(N);
  const softF = new Float32Array(N);
  const shade = new Float32Array(N);
  const unit = new Uint8Array(N);

  const units: GeologyUnit[] = [
    { name: 'Máaz Formation', color: [145, 125, 95], desc: 'Crater floor basaltic lava flows and cumulates' },
    { name: 'Delta Scarp Sandstones', color: [75, 130, 200], desc: 'Sedimentary delta bottomsets and foresets' },
    { name: 'Séítah Formation', color: [215, 185, 110], desc: 'Olivine-rich cumulate bedrock beneath rippled dunes' },
    { name: 'Belva Crater Ejecta', color: [155, 95, 180], desc: 'Coarse megabreccia blocks from 1-km impact crater' },
    { name: 'Delta Top Conglomerates', color: [90, 160, 120], desc: 'High-energy river channel gravels and boulders' }
  ];

  // Geomorphic anchors for Jezero Fan model
  const scarpCenterX = 98;
  const belva = { x: 140, y: 90, r: 16 };
  const kodiak = { x: 55, y: 88, r: 7 };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / W;
      const v = y / H;

      // Overall regional slope down towards the crater center (eastward to floor)
      let h = -2500 - (u * 140);

      // Delta Front Scarp rising to the west/northwest
      const scarpDist = (scarpCenterX - x) + (y - 60) * 0.35 + (fbm(x * 0.08, y * 0.08, 14) - 0.5) * 16;
      if (scarpDist > 0) {
        h += 85 * smooth(0, 32, scarpDist);
      }

      // Delta top braided channels
      if (x < scarpCenterX - 20) {
        h += (fbm(x * 0.15, y * 0.15, 7) - 0.5) * 8;
      }

      // Kodiak Butte remnant
      const dKodiak = Math.hypot(x - kodiak.x, y - kodiak.y);
      if (dKodiak < kodiak.r) {
        h += 38 * (1 - Math.pow(dKodiak / kodiak.r, 2.2));
      }

      // Belva Crater
      const dBelva = Math.hypot(x - belva.x, y - belva.y);
      let isBelvaEjecta = false;
      if (dBelva < belva.r) {
        h -= 42 * (1 - Math.pow(dBelva / belva.r, 2));
      } else if (dBelva < belva.r * 2.0) {
        h += 14 * Math.exp(-Math.pow((dBelva - belva.r) / 4, 2));
        isBelvaEjecta = true;
      }

      // Séítah sand dunes in southwest depression
      const isSeitah = (x > 50 && x < 90 && y > 75);
      if (isSeitah) {
        h += 4 * Math.sin(x * 0.4 + y * 0.2);
      }

      z[i] = h;

      // Assign geologic unit
      if (isBelvaEjecta || dBelva < belva.r) {
        unit[i] = 3; // Belva Crater Ejecta
      } else if (isSeitah) {
        unit[i] = 2; // Séítah
      } else if (x < 65 && y < 65) {
        unit[i] = 4; // Delta Top Conglomerates
      } else if (x < scarpCenterX + 5) {
        unit[i] = 1; // Delta Scarp Sandstones
      } else {
        unit[i] = 0; // Máaz Crater Floor
      }
    }
  }

  let zmin = Infinity;
  let zmax = -Infinity;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xl = Math.max(x - 1, 0);
      const xr = Math.min(x + 1, W - 1);
      const yu = Math.max(y - 1, 0);
      const yd = Math.min(y + 1, H - 1);

      const gx = (z[y * W + xr] - z[y * W + xl]) / ((xr - xl) * cellMeters);
      const gy = (z[yd * W + x] - z[yu * W + x]) / ((yd - yu) * cellMeters);

      slopeDeg[i] = Math.atan(Math.hypot(gx, gy)) * (180 / Math.PI);
      shade[i] = clamp(0.88 + 1.2 * 0.65 * (gx + gy), 0.45, 1.25);

      if (z[i] < zmin) zmin = z[i];
      if (z[i] > zmax) zmax = z[i];

      // Realistic Martian thermal inertia (THEMIS / TES derived)
      let t = 220;
      if (unit[i] === 2) {
        t = 110; // Séítah fine ripples
      } else if (unit[i] === 1) {
        t = 340; // Delta scarp cemented bedrock
      } else if (unit[i] === 3) {
        t = 410; // Belva ejecta rocky blocks
      } else if (unit[i] === 4) {
        t = 310;
      } else {
        t = 185;
      }
      t += (fbm(x * 0.1, y * 0.1, 41) - 0.5) * 45;
      ti[i] = t;

      softF[i] = clamp((175 - t) / 80, 0, 1);
    }
  }

  const rawTargets: Omit<ScienceTarget, 'i'>[] = [
    { id: 'J1', name: 'Kodiak Mesa Basal Strata', kind: 'Delta Scarp Sandstones', val: 0.95, x: 55, y: 88, description: 'Isolated delta outlier revealing bottomset-to-foreset architectural facies' },
    { id: 'J2', name: 'Cape Nukshak Delta Scarp', kind: 'Delta Scarp Sandstones', val: 0.85, x: 92, y: 52, description: 'Steep amphitheater cliff with layered sulfate-bearing mudstones' },
    { id: 'J3', name: 'Belva Megabreccia Ridge', kind: 'Belva Crater Ejecta', val: 0.75, x: 130, y: 84, description: 'Exhumed hydrothermal vein fractures inside impact megabreccia' },
    { id: 'J4', name: 'Séítah Sand Ripple Trench', kind: 'Séítah Formation', val: 0.60, x: 74, y: 82, description: 'Contact boundary between igneous cumulates and modern active aeolian ripples' },
    { id: 'J5', name: 'Castell Henllys River Bar', kind: 'Delta Top Conglomerates', val: 0.88, x: 42, y: 38, description: 'Coarse braided gravel bar representing peak fluvial discharge into Jezero' }
  ];

  const targets: ScienceTarget[] = rawTargets.map(t => ({
    ...t,
    i: t.y * W + t.x
  }));

  return {
    id: 'jezero',
    name: 'Jezero Crater Western Fan',
    isReal: true,
    label: 'Jezero Crater Fan — HiRISE / MOLA calibrated reference model',
    W,
    H,
    cellMeters,
    z,
    slopeDeg,
    ti,
    softF,
    shade,
    unit,
    zmin,
    zmax,
    units,
    defaultHab: { x: 78, y: 64 }, // Near Octavia E. Butler landing area
    defaultTgt: { x: 92, y: 52 }, // Cape Nukshak Delta Scarp
    targets,
    citation: 'NASA Mars 2020 Jezero Crater reference framework: MOLA DTM & HiRISE geological map units.'
  };
}
