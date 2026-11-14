/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DijkstraResult, MissionParams, PlannerResults, RouteCard, RouteMetrics, RouteStatus, ScienceTarget, TerrainDataset } from '../types';

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
];

const SQRT2 = Math.SQRT2;

export interface EdgeParams {
  cap: number;      // Hard slope limit cutoff in degrees
  softPen: number;  // Multiplier penalty for soft ground (e.g. 1.0 for fastest, 1.8 for safest)
}

/**
 * Anisotropic Tobler-style walking cost across a cell edge:
 * Accounts for slope grade (uphill vs downhill) and soft ground friction.
 */
export function calculateEdgeTime(
  terrain: TerrainDataset,
  params: MissionParams,
  a: number,
  b: number,
  isDiagonal: boolean,
  edgeParams: EdgeParams
): number {
  const dist = terrain.cellMeters * (isDiagonal ? SQRT2 : 1.0);
  const elevationDelta = terrain.z[b] - terrain.z[a];
  const slopeGrade = elevationDelta / dist; // rise / run
  const slopeAngleDeg = Math.atan(Math.abs(slopeGrade)) * (180 / Math.PI);

  if (slopeAngleDeg > edgeParams.cap) {
    return Infinity;
  }

  const soft = (terrain.softF[a] + terrain.softF[b]) * 0.5;

  // Tobler-style exponential walking equation modified for Martian EVA suit:
  // Slight downhill (-0.05 grade ~ 2.9°) is optimal; steep climbs & drops slow down.
  // Soft terrain (low thermal inertia) reduces walking speed by up to 45%.
  const velocityKmH = params.pace * Math.exp(-3.5 * (Math.abs(slopeGrade + 0.05) - 0.05)) * (1.0 - 0.45 * soft);
  
  if (velocityKmH <= 0.001) {
    return Infinity;
  }

  let timeHours = (dist / 1000) / velocityKmH;

  // Apply extra safety penalty against soft ground if requested (e.g. Safest route)
  if (edgeParams.softPen > 1.0) {
    timeHours *= (1.0 + (edgeParams.softPen - 1.0) * soft);
  }

  return timeHours;
}

/**
 * Binary min-heap for Dijkstra priority queue.
 */
class MinHeap {
  private keys: number[] = [];
  private values: number[] = [];

  push(key: number, value: number) {
    let i = this.keys.length;
    this.keys.push(key);
    this.values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[i] = this.keys[parent];
      this.values[i] = this.values[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.values[i] = value;
  }

  pop(): [number, number] {
    const minKey = this.keys[0];
    const minValue = this.values[0];
    const lastKey = this.keys.pop()!;
    const lastVal = this.values.pop()!;
    const len = this.keys.length;

    if (len > 0) {
      let i = 0;
      while (true) {
        let child = 2 * i + 1;
        if (child >= len) break;
        if (child + 1 < len && this.keys[child + 1] < this.keys[child]) {
          child++;
        }
        if (this.keys[child] >= lastKey) break;
        this.keys[i] = this.keys[child];
        this.values[i] = this.values[child];
        i = child;
      }
      this.keys[i] = lastKey;
      this.values[i] = lastVal;
    }

    return [minKey, minValue];
  }

  get size(): number {
    return this.keys.length;
  }
}

/**
 * Runs 8-neighbor Dijkstra over the terrain raster grid.
 * If reverse is true, calculates time to travel back to the source node.
 */
export function runDijkstra(
  terrain: TerrainDataset,
  params: MissionParams,
  srcNode: number,
  edgeParams: EdgeParams,
  reverse: boolean
): DijkstraResult {
  const { W, H } = terrain;
  const N = W * H;
  const dist = new Float64Array(N);
  dist.fill(Infinity);
  const link = new Int32Array(N);
  link.fill(-1);

  const heap = new MinHeap();
  dist[srcNode] = 0;
  heap.push(0, srcNode);

  while (heap.size > 0) {
    const [currentDist, u] = heap.pop();
    if (currentDist > dist[u]) continue;

    const ux = u % W;
    const uy = Math.floor(u / W);

    for (let q = 0; q < 8; q++) {
      const nx = ux + NEIGHBORS[q][0];
      const ny = uy + NEIGHBORS[q][1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;

      const n = ny * W + nx;
      const isDiag = q >= 4;

      // In forward search: walking u -> n. In reverse search: walking n -> u.
      const stepCost = reverse
        ? calculateEdgeTime(terrain, params, n, u, isDiag, edgeParams)
        : calculateEdgeTime(terrain, params, u, n, isDiag, edgeParams);

      if (stepCost === Infinity) continue;

      const newDist = currentDist + stepCost;
      if (newDist < dist[n]) {
        dist[n] = newDist;
        link[n] = u;
        heap.push(newDist, n);
      }
    }
  }

  return { dist, link };
}

/**
 * Reconstructs path from link array going backwards from target to source.
 */
export function reconstructPath(link: Int32Array, src: number, target: number): number[] {
  const path: number[] = [];
  let curr = target;
  while (curr !== -1) {
    path.push(curr);
    if (curr === src) break;
    curr = link[curr];
  }
  return path.reverse();
}

/**
 * Reconstructs path forward from link array from a reverse Dijkstra.
 */
export function reconstructReversePath(link: Int32Array, fromNode: number): number[] {
  const path: number[] = [];
  let curr = fromNode;
  while (curr !== -1) {
    path.push(curr);
    curr = link[curr];
  }
  return path;
}

export function isCellDiagonal(W: number, a: number, b: number): boolean {
  return (a % W !== b % W) && (Math.floor(a / W) !== Math.floor(b / W));
}

/**
 * Computes all operational metrics for a route path,
 * including retracing return walk time, steepest slope, soft ground, and science target encounters.
 */
export function computeRouteMetrics(
  terrain: TerrainDataset,
  params: MissionParams,
  path: number[],
  usableTime: number,
  options?: { isReturnTrip?: boolean; overrideBackTimeH?: number }
): RouteMetrics {
  const { W, cellMeters, z, softF } = terrain;
  const baseEdgeParams: EdgeParams = { cap: Infinity, softPen: 1.0 };

  let dist = 0;
  let tForward = 0;
  let tRetrace = 0;
  let maxDeg = 0;
  let over = 0;
  let softM = 0;

  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const diag = isCellDiagonal(W, a, b);
    const stepDist = cellMeters * (diag ? SQRT2 : 1.0);
    dist += stepDist;

    // Forward walking cost along path
    const stepOutTime = calculateEdgeTime(terrain, params, a, b, diag, baseEdgeParams);
    tForward += stepOutTime;

    // Retracing reverse walk cost (b -> a)
    const stepBackTime = calculateEdgeTime(terrain, params, b, a, diag, baseEdgeParams);
    tRetrace += stepBackTime;

    const slopeDeg = Math.atan(Math.abs(z[b] - z[a]) / stepDist) * (180 / Math.PI);
    if (slopeDeg > maxDeg) maxDeg = slopeDeg;
    if (slopeDeg > params.comfort) over++;

    const avgSoft = (softF[a] + softF[b]) * 0.5;
    if (avgSoft > 0.5) {
      softM += stepDist;
    }
  }

  // Science targets within 120m (4 cells) of the route
  const hitTargets = terrain.targets.filter(t =>
    path.some(c => {
      const cx = c % W;
      const cy = Math.floor(c / W);
      return Math.hypot(cx - t.x, cy - t.y) <= 4.0;
    })
  );

  const sciScore = hitTargets.reduce((sum, t) => sum + t.val, 0);

  let tOut = tForward;
  let tBack = options?.overrideBackTimeH !== undefined ? options.overrideBackTimeH : tRetrace;
  if (options?.isReturnTrip) {
    tOut = 0;
    tBack = tForward;
  }
  const margin = usableTime - (tOut + tBack);

  return {
    dist,
    tOut,
    tBack,
    maxDeg,
    over,
    softM,
    hit: hitTargets,
    sci: sciScore,
    margin,
    path
  };
}

export function evaluateStatus(marginHours: number, usableHours: number): RouteStatus {
  if (marginHours < 0) return 'nogo';
  // TIGHT if margin < max(12 min = 0.2h, 12% of usable time)
  const tightThreshold = Math.max(0.2, 0.12 * usableHours);
  if (marginHours < tightThreshold) return 'tight';
  return 'go';
}

export function pathsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Picks a sensible selected route: keeps current selection unless it became NO-GO
 * while another route is viable (prefers GO, then TIGHT).
 */
export function pickSensibleRoute(
  routes: RouteCard[],
  preferredId: 'fast' | 'safe' | 'sci'
): { selectedId: 'fast' | 'safe' | 'sci'; switchNotice: string | null } {
  if (routes.length === 0) {
    return { selectedId: preferredId, switchNotice: null };
  }
  const current = routes.find(r => r.id === preferredId);
  if (current && current.status !== 'nogo') {
    return { selectedId: preferredId, switchNotice: null };
  }

  // Prefer GO routes (safest -> science -> fastest), then TIGHT routes
  const goPriority: ('safe' | 'sci' | 'fast')[] = ['safe', 'sci', 'fast'];
  for (const id of goPriority) {
    const cand = routes.find(r => r.id === id && r.status === 'go');
    if (cand) {
      const prevName = current ? current.name : preferredId;
      return {
        selectedId: cand.id,
        switchNotice: current
          ? `Switched from ${prevName} to ${cand.name} because ${prevName} exceeded the consumables budget.`
          : `Selected ${cand.name} route.`
      };
    }
  }

  for (const id of goPriority) {
    const cand = routes.find(r => r.id === id && r.status === 'tight');
    if (cand) {
      const prevName = current ? current.name : preferredId;
      return {
        selectedId: cand.id,
        switchNotice: current
          ? `Switched from ${prevName} to ${cand.name} (TIGHT) because ${prevName} exceeded the consumables budget.`
          : `Selected ${cand.name} route.`
      };
    }
  }

  return { selectedId: current ? current.id : routes[0].id, switchNotice: null };
}

/**
 * Master planner computation: runs Dijkstra from originIndex (habitat or current astronaut cell),
 * evaluates reach zone (centered on habIndex), and generates Fastest, Safest, and Science routes.
 */
export function planEVA(
  terrain: TerrainDataset,
  params: MissionParams,
  habIndex: number,
  tgtIndex: number,
  originIndex: number = habIndex,
  overrideUsable?: number,
  isReturnTrip: boolean = false
): PlannerResults {
  const { W, H, cellMeters } = terrain;
  const N = W * H;

  // Consumables budget
  const lim = Math.min(params.o2, params.pw, params.day);
  const limName: 'Oxygen' | 'Suit power' | 'Daylight' =
    lim === params.o2 ? 'Oxygen' : lim === params.pw ? 'Suit power' : 'Daylight';

  const budget = lim * (1.0 - params.res / 100);
  const usable = overrideUsable !== undefined ? Math.max(0, overrideUsable) : Math.max(0, budget - params.stay);

  // Forward search from originIndex and reverse search back to habIndex under hard slope limit
  const fastEdgeParams: EdgeParams = { cap: params.maxSlope, softPen: 1.0 };
  const outDijkstra = runDijkstra(terrain, params, originIndex, fastEdgeParams, false);
  const backDijkstra = runDijkstra(terrain, params, habIndex, fastEdgeParams, true);

  // Compute Reach Zone: cells reachable from originIndex that can still return to habIndex within usable time
  const reach = new Uint8Array(N);
  let reachableCount = 0;
  let farthestDist = 0;

  const hx = habIndex % W;
  const hy = Math.floor(habIndex / W);

  if (usable > 0) {
    for (let i = 0; i < N; i++) {
      if (outDijkstra.dist[i] + backDijkstra.dist[i] <= usable) {
        reach[i] = 1;
        reachableCount++;
        const ix = i % W;
        const iy = Math.floor(i / W);
        const distFromHab = Math.hypot(ix - hx, iy - hy) * cellMeters;
        if (distFromHab > farthestDist) {
          farthestDist = distFromHab;
        }
      }
    }
  }

  const routes: RouteCard[] = [];
  const notes: { relaxed?: boolean } = {};
  const metricOptions = isReturnTrip
    ? { isReturnTrip: true }
    : originIndex !== habIndex
      ? { overrideBackTimeH: backDijkstra.dist[tgtIndex] }
      : undefined;

  if (outDijkstra.dist[tgtIndex] < Infinity) {
    // 1. FASTEST ROUTE: Minimum time under hard slope limit
    const fastPath = reconstructPath(outDijkstra.link, originIndex, tgtIndex);
    const fastMetrics = computeRouteMetrics(terrain, params, fastPath, usable, metricOptions);
    routes.push({
      id: 'fast',
      name: 'Fastest',
      colorVar: '--route-fast',
      colorHex: '#f4f6f5',
      path: fastPath,
      m: fastMetrics,
      status: evaluateStatus(fastMetrics.margin, usable)
    });

    // 2. SAFEST ROUTE: Minimum time with edges above comfort limit blocked and soft ground penalised
    let safeEdgeParams: EdgeParams = {
      cap: Math.min(params.comfort, params.maxSlope),
      softPen: 1.8
    };
    let safeOut = runDijkstra(terrain, params, originIndex, safeEdgeParams, false);

    // If no path exists under comfort limit, relax to hard slope limit and note warning
    if (safeOut.dist[tgtIndex] === Infinity) {
      safeEdgeParams = { cap: params.maxSlope, softPen: 1.8 };
      safeOut = runDijkstra(terrain, params, originIndex, safeEdgeParams, false);
      notes.relaxed = true;
    }

    const safePath = reconstructPath(safeOut.link, originIndex, tgtIndex);
    const safeMetrics = computeRouteMetrics(terrain, params, safePath, usable, metricOptions);
    routes.push({
      id: 'safe',
      name: 'Safest',
      colorVar: '--route-safe',
      colorHex: '#4dd0e1',
      path: safePath,
      m: safeMetrics,
      status: evaluateStatus(safeMetrics.margin, usable)
    });

    // 3. SCIENCE ROUTE: Safest terrain rules, optionally detouring through science targets within budget
    const safeFromTarget = runDijkstra(terrain, params, tgtIndex, safeEdgeParams, true);

    const candidates: number[][] = [safePath];

    terrain.targets.forEach(t => {
      if (t.i === tgtIndex || t.i === originIndex) return;
      if (safeOut.dist[t.i] === Infinity || safeFromTarget.dist[t.i] === Infinity) return;

      const pathOriginToTarget = reconstructPath(safeOut.link, originIndex, t.i);
      const pathTargetToDest = reconstructReversePath(safeFromTarget.link, t.i).slice(1);
      candidates.push(pathOriginToTarget.concat(pathTargetToDest));
    });

    let bestPath = safePath;
    let bestScore = -Infinity;
    const baseForwardTime = isReturnTrip ? safeMetrics.tBack : safeMetrics.tOut;

    candidates.forEach(candPath => {
      const candMetrics = computeRouteMetrics(terrain, params, candPath, usable, metricOptions);
      if (candMetrics.margin < 0 && candPath !== safePath) return;

      const candForwardTime = isReturnTrip ? candMetrics.tBack : candMetrics.tOut;
      const detourHours = Math.max(0, candForwardTime - baseForwardTime);
      const score = candMetrics.sci - 0.5 * detourHours;

      if (score > bestScore) {
        bestScore = score;
        bestPath = candPath;
      }
    });

    const sciMetrics = computeRouteMetrics(terrain, params, bestPath, usable, metricOptions);
    routes.push({
      id: 'sci',
      name: 'Science',
      colorVar: '--route-sci',
      colorHex: '#c79bff',
      path: bestPath,
      m: sciMetrics,
      status: evaluateStatus(sciMetrics.margin, usable)
    });
  }

  return {
    lim,
    limName,
    budget,
    usable,
    out: outDijkstra,
    back: backDijkstra,
    reach,
    cnt: reachableCount,
    far: farthestDist,
    routes,
    notes
  };
}

/**
 * Verifies destination feasibility, finds the nearest reachable safe cell when not verified,
 * and computes a mathematically exact single-parameter fix when one exists.
 */
export function verifyDestination(
  terrain: TerrainDataset,
  params: MissionParams,
  results: PlannerResults,
  activeRoute: RouteCard | undefined,
  habIndex: number,
  tgtIndex: number,
  originIndex: number = habIndex
): import('../types').DestinationVerification {
  const { W, H, cellMeters } = terrain;
  const N = W * H;
  const tx = tgtIndex % W;
  const ty = Math.floor(tgtIndex / W);

  // Find nearest reachable cell (preferring GO margin, falling back to any reach[i] === 1)
  const findNearestReachable = (): import('../types').NearestReachableSuggestion | null => {
    let bestGoIdx = -1;
    let bestGoDist = Infinity;
    let bestReachIdx = -1;
    let bestReachDist = Infinity;

    for (let i = 0; i < N; i++) {
      const rtTime = results.out.dist[i] + results.back.dist[i];
      if (rtTime > results.usable) continue;
      const ix = i % W;
      const iy = Math.floor(i / W);
      const d = Math.hypot(ix - tx, iy - ty);
      const margin = results.usable - rtTime;
      if (evaluateStatus(margin, results.usable) === 'go' && d < bestGoDist) {
        bestGoDist = d;
        bestGoIdx = i;
      }
      if (d < bestReachDist) {
        bestReachDist = d;
        bestReachIdx = i;
      }
    }

    const chosen = bestGoIdx !== -1 ? bestGoIdx : bestReachIdx;
    if (chosen === -1) return null;
    const cx = chosen % W;
    const cy = Math.floor(chosen / W);
    const marginHours = results.usable - (results.out.dist[chosen] + results.back.dist[chosen]);
    return {
      cellIndex: chosen,
      xMeters: cx * cellMeters,
      yMeters: cy * cellMeters,
      marginHours,
      distanceFromTargetMeters: Math.hypot(cx - tx, cy - ty) * cellMeters
    };
  };

  // Case 1: Unreachable under hard slope limit
  if (!activeRoute || results.routes.length === 0) {
    let singleFixSuggestion: string | null = null;
    // Check if raising maxSlope up to 35° makes tgtIndex reachable
    if (params.maxSlope < 35) {
      const testMax = runDijkstra(terrain, params, originIndex, { cap: 35, softPen: 1.0 }, false);
      if (testMax.dist[tgtIndex] < Infinity) {
        // Binary search minimum integer slope in (params.maxSlope + 1 .. 35)
        let lo = params.maxSlope + 1;
        let hi = 35;
        let minSlope = 35;
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          const testMid = runDijkstra(terrain, params, originIndex, { cap: mid, softPen: 1.0 }, false);
          if (testMid.dist[tgtIndex] < Infinity) {
            minSlope = mid;
            hi = mid - 1;
          } else {
            lo = mid + 1;
          }
        }
        singleFixSuggestion = `Raise hard slope limit to ${minSlope}°`;
      }
    }

    return {
      kind: 'unreachable',
      chipText: 'Unreachable under the hard slope limit',
      marginHours: -Infinity,
      nearestReachable: findNearestReachable(),
      singleFixSuggestion
    };
  }

  const margin = activeRoute.m.margin;
  const status = activeRoute.status;

  // Case 2: Verified (GO)
  if (status === 'go') {
    const mins = Math.round(margin * 60);
    return {
      kind: 'verified',
      chipText: `Verified: inside safe range, margin ${mins} min`,
      marginHours: margin,
      nearestReachable: null,
      singleFixSuggestion: null
    };
  }

  // Case 3 or 4: Tight or Outside budget — compute exact single-parameter fix to achieve GO
  const walkNeed = activeRoute.m.tOut + activeRoute.m.tBack;
  // To be GO, margin >= max(0.2, 0.12 * usable) AND margin >= 0
  // Solve usableNeeded >= walkNeed + 0.2 AND usableNeeded >= walkNeed / 0.88
  const usableNeededForGo = Math.max(walkNeed + 0.2, walkNeed / 0.88) + 0.002;
  const usableNeededForZeroMargin = walkNeed + 0.002;

  const computeSingleFix = (targetUsable: number): string | null => {
    // 1. Reduce time at target (stay)
    const maxStay = results.budget - targetUsable;
    if (maxStay >= 0 && maxStay < params.stay) {
      const reduceMin = Math.ceil((params.stay - maxStay) * 60);
      if (reduceMin >= 1 && params.stay - reduceMin / 60 >= 0) {
        return `Reduce time at target by ${reduceMin} min`;
      }
    }

    // 2. Raise limiting consumable (only valid if other 2 consumables >= needed)
    const budgetNeeded = targetUsable + params.stay;
    const reserveFactor = 1.0 - params.res / 100;
    if (reserveFactor > 0) {
      const limNeeded = budgetNeeded / reserveFactor;
      const roundedUp = Math.ceil(limNeeded * 10) / 10;
      if (results.limName === 'Oxygen' && roundedUp <= 8.0 && params.pw >= roundedUp && params.day >= roundedUp) {
        return `Raise oxygen to ${roundedUp.toFixed(1)} h`;
      }
      if (results.limName === 'Suit power' && roundedUp <= 8.0 && params.o2 >= roundedUp && params.day >= roundedUp) {
        return `Raise suit power to ${roundedUp.toFixed(1)} h`;
      }
      if (results.limName === 'Daylight' && roundedUp <= 10.0 && params.o2 >= roundedUp && params.pw >= roundedUp) {
        return `Raise daylight left to ${roundedUp.toFixed(1)} h`;
      }
    }

    // 3. Lower reserve %
    if (results.lim > 0) {
      const maxRes = (1 - budgetNeeded / results.lim) * 100;
      const flooredRes = Math.floor(maxRes);
      if (flooredRes >= 0 && flooredRes < params.res) {
        return `Lower reserve to ${flooredRes}%`;
      }
    }

    // 4. Increase flat walking pace (time scales inversely with pace, up to 4.0 km/h)
    if (targetUsable > 0 && walkNeed > 0) {
      const paceNeeded = params.pace * (walkNeed / targetUsable);
      const roundedPace = Math.ceil(paceNeeded * 10) / 10;
      if (roundedPace <= 4.0 && roundedPace > params.pace) {
        return `Increase flat pace to ${roundedPace.toFixed(1)} km/h`;
      }
    }

    return null;
  };

  const singleFixSuggestion =
    computeSingleFix(usableNeededForGo) ||
    (status === 'nogo' ? computeSingleFix(usableNeededForZeroMargin) : null);

  if (status === 'tight') {
    return {
      kind: 'tight',
      chipText: `Tight: margin under 12% of budget`,
      marginHours: margin,
      nearestReachable: findNearestReachable(),
      singleFixSuggestion
    };
  }

  const overMin = Math.round(-margin * 60);
  return {
    kind: 'outside',
    chipText: `Outside budget by ${overMin} min`,
    marginHours: margin,
    nearestReachable: findNearestReachable(),
    singleFixSuggestion
  };
}

