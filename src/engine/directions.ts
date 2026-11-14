/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MissionParams,
  PlannerResults,
  RouteCard,
  RouteStatus,
  ScienceTarget,
  TerrainDataset
} from '../types';
import { calculateEdgeTime, EdgeParams, evaluateStatus, isCellDiagonal } from './dijkstra';

export type DirectionMode = 'outbound' | 'return';
export type TerrainClass = 'comfort' | 'strenuous' | 'soft';

export interface ScienceCallout {
  target: ScienceTarget;
  distanceM: number;
}

export interface DirectionLeg {
  num: number;
  startPathIdx: number;
  endPathIdx: number;
  startCell: number;
  endCell: number;
  bearingDeg: number;
  bearingStr: string;
  dir8: string;
  terrainClass: TerrainClass;
  distM: number;
  avgSlopeDeg: number;
  maxSlopeDeg: number;
  overComfort: boolean;
  strenuousSteps: number;
  crossesSoft: boolean;
  softDistM: number;
  legTimeH: number;
  elapsedH: number;
  totalWalkElapsedH: number;
  budgetLeftH: number;
  scienceCallouts: ScienceCallout[];
  containsTurnaround: boolean;
  sentence: string;
  isDone?: boolean;
}

export interface WalkPoint {
  pathIdx: number;
  cellIndex: number;
  legNum: number;
  elapsedH: number;
  totalWalkElapsedH: number;
  budgetLeftH: number;
  marginAtPointH: number;
  status: RouteStatus;
  slopeDeg: number;
  headingDeg: number;
  bearingStr: string;
  dir8: string;
  distToTargetM: number;
  distBackToHabM: number;
}

export interface RouteDirections {
  mode: DirectionMode;
  routeId: 'fast' | 'safe' | 'sci';
  routeName: string;
  limName: string;
  activePath: number[];
  legs: DirectionLeg[];
  walkPoints: WalkPoint[];
  totalDistM: number;
  totalTimeH: number;
  turnaroundPathIdx: number; // Index on route.path (hab->tgt) of last cell with margin >= 0
  turnaroundCellIndex: number;
  turnaroundDistFromHabM: number;
  turnaroundOutTimeH: number;
  turnaroundBackTimeH: number;
  isTargetSafe: boolean;
  targetMarginH: number;
  summaryText: string;
}

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function formatBearing(deg: number): { deg: number; str: string; dir8: string } {
  const norm = ((Math.round(deg) % 360) + 360) % 360;
  const str = String(norm).padStart(3, '0');
  const dir8 = COMPASS_8[Math.round(norm / 45) % 8];
  return { deg: norm, str, dir8 };
}

export function headingDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function formatDuration(hours: number): string {
  const sign = hours < 0 ? '-' : '';
  const totalMin = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) {
    return `${sign}${h} h ${String(m).padStart(2, '0')} min`;
  }
  return `${sign}${m} min`;
}

export function formatMinutesOnly(hours: number): string {
  return `${Math.round(Math.abs(hours) * 60)} min`;
}

/**
 * Deterministically derives step-by-step astronaut directions, hazard/science callouts,
 * point-of-no-return turnaround marker, and walk-through telemetry from planner values.
 */
export function buildRouteDirections(
  terrain: TerrainDataset,
  params: MissionParams,
  results: PlannerResults,
  route: RouteCard | undefined,
  mode: DirectionMode,
  elapsedOffsetH: number = 0,
  returnOnly: boolean = false
): RouteDirections | null {
  if (!route || route.path.length === 0) {
    return null;
  }

  // Handle single-cell route (destination equals origin / habitat)
  if (route.path.length === 1) {
    const singleCell = route.path[0];
    const isSafe = route.m.margin >= 0;
    const cellSlope = terrain.slopeDeg[singleCell] ?? 0;
    return {
      mode,
      routeId: route.id,
      routeName: route.name,
      limName: results.limName,
      activePath: [singleCell],
      legs: [],
      walkPoints: [
        {
          pathIdx: 0,
          cellIndex: singleCell,
          legNum: 1,
          elapsedH: elapsedOffsetH,
          totalWalkElapsedH: elapsedOffsetH,
          budgetLeftH: results.usable,
          marginAtPointH: route.m.margin,
          status: evaluateStatus(route.m.margin, results.usable),
          slopeDeg: cellSlope,
          headingDeg: 0,
          bearingStr: '000',
          dir8: 'N',
          distToTargetM: 0,
          distBackToHabM: 0
        }
      ],
      totalDistM: 0,
      totalTimeH: 0,
      turnaroundPathIdx: 0,
      turnaroundCellIndex: singleCell,
      turnaroundDistFromHabM: 0,
      turnaroundOutTimeH: 0,
      turnaroundBackTimeH: 0,
      isTargetSafe: isSafe,
      targetMarginH: route.m.margin,
      summaryText: isSafe
        ? `Target is at current origin, margin ${formatMinutesOnly(route.m.margin)}`
        : `Outside budget by ${formatMinutesOnly(-route.m.margin)}`
    };
  }

  const { W, cellMeters, z, softF } = terrain;
  const baseEdge: EdgeParams = { cap: Infinity, softPen: 1.0 };
  const forwardPath = route.path; // hab -> ... -> tgt
  const m = forwardPath.length - 1;

  // 1. Precompute exact cumulative outbound & retraced-return metrics for every cell along hab -> tgt
  const cumOutTime = new Float64Array(forwardPath.length);
  const cumOutDist = new Float64Array(forwardPath.length);
  const cumBackFromHab = new Float64Array(forwardPath.length);
  const cellMargin = new Float64Array(forwardPath.length);

  cellMargin[0] = results.usable;

  for (let k = 1; k <= m; k++) {
    const a = forwardPath[k - 1];
    const b = forwardPath[k];
    const diag = isCellDiagonal(W, a, b);
    const stepDist = cellMeters * (diag ? Math.SQRT2 : 1.0);
    const outT = calculateEdgeTime(terrain, params, a, b, diag, baseEdge);
    const backT = calculateEdgeTime(terrain, params, b, a, diag, baseEdge);

    cumOutDist[k] = cumOutDist[k - 1] + stepDist;
    cumOutTime[k] = cumOutTime[k - 1] + outT;
    cumBackFromHab[k] = cumBackFromHab[k - 1] + backT;
    if (returnOnly) {
      cellMargin[k] = results.usable - cumOutTime[k];
    } else if (elapsedOffsetH > 0) {
      cellMargin[k] = results.usable - cumOutTime[k] - results.back.dist[forwardPath[k]];
    } else {
      cellMargin[k] = results.usable - cumOutTime[k] - cumBackFromHab[k];
    }
  }

  const totalDistM = cumOutDist[m];

  // Last cell on route where margin >= 0
  let turnaroundRouteIdx = 0;
  for (let k = 0; k <= m; k++) {
    if (cellMargin[k] >= 0) {
      turnaroundRouteIdx = k;
    }
  }

  const turnaroundCellIndex = forwardPath[turnaroundRouteIdx];
  const isTargetSafe = route.m.margin >= 0;

  // 2. Build active path & step-by-step telemetry for Outbound vs Return
  const activePath = (mode === 'outbound' || returnOnly) ? forwardPath : [...forwardPath].reverse();

  interface StepData {
    a: number;
    b: number;
    heading: number;
    distM: number;
    timeH: number;
    slopeDeg: number;
    isSoft: boolean;
    isStrenuous: boolean;
    terrainClass: TerrainClass;
    elapsedAtEndH: number;
    totalWalkElapsedAtEndH: number;
    budgetLeftAtEndH: number;
  }

  const steps: StepData[] = [];
  let returnElapsedAccum = 0;

  for (let s = 0; s < m; s++) {
    const a = activePath[s];
    const b = activePath[s + 1];
    const ax = a % W;
    const ay = Math.floor(a / W);
    const bx = b % W;
    const by = Math.floor(b / W);
    const dx = bx - ax;
    const dy = by - ay;
    const diag = dx !== 0 && dy !== 0;

    // North-up map: north = -dy, east = +dx
    const rawHeading = Math.atan2(dx, -dy) * (180 / Math.PI);
    const heading = ((rawHeading % 360) + 360) % 360;

    const distM = cellMeters * (diag ? Math.SQRT2 : 1.0);
    const timeH = calculateEdgeTime(terrain, params, a, b, diag, baseEdge);
    const slopeDeg = Math.atan(Math.abs(z[b] - z[a]) / distM) * (180 / Math.PI);
    const avgSoft = (softF[a] + softF[b]) * 0.5;
    const isSoft = avgSoft > 0.5;
    const isStrenuous = slopeDeg > params.comfort;
    const terrainClass: TerrainClass = isStrenuous ? 'strenuous' : isSoft ? 'soft' : 'comfort';

    if (mode === 'outbound' && !returnOnly) {
      const elapsedAtEndH = cumOutTime[s + 1];
      steps.push({
        a,
        b,
        heading,
        distM,
        timeH,
        slopeDeg,
        isSoft,
        isStrenuous,
        terrainClass,
        elapsedAtEndH: elapsedAtEndH + elapsedOffsetH,
        totalWalkElapsedAtEndH: elapsedAtEndH + elapsedOffsetH,
        budgetLeftAtEndH: results.usable - elapsedAtEndH
      });
    } else if (returnOnly) {
      returnElapsedAccum += timeH;
      const totalWalkElapsedAtEndH = elapsedOffsetH + returnElapsedAccum;
      steps.push({
        a,
        b,
        heading,
        distM,
        timeH,
        slopeDeg,
        isSoft,
        isStrenuous,
        terrainClass,
        elapsedAtEndH: returnElapsedAccum,
        totalWalkElapsedAtEndH,
        budgetLeftAtEndH: results.usable - returnElapsedAccum
      });
    } else {
      returnElapsedAccum += timeH;
      const totalWalkElapsedAtEndH = route.m.tOut + returnElapsedAccum;
      steps.push({
        a,
        b,
        heading,
        distM,
        timeH,
        slopeDeg,
        isSoft,
        isStrenuous,
        terrainClass,
        elapsedAtEndH: returnElapsedAccum,
        totalWalkElapsedAtEndH,
        budgetLeftAtEndH: results.usable - totalWalkElapsedAtEndH
      });
    }
  }

  // 3. Group steps into legs (new leg if heading changes > 20° or terrain class changes)
  const legBuckets: { startStep: number; endStep: number; anchorHeading: number; terrainClass: TerrainClass }[] = [];
  for (let s = 0; s < steps.length; s++) {
    const st = steps[s];
    const lastBucket = legBuckets[legBuckets.length - 1];
    if (
      !lastBucket ||
      headingDiffDeg(st.heading, lastBucket.anchorHeading) > 20 ||
      st.terrainClass !== lastBucket.terrainClass
    ) {
      legBuckets.push({
        startStep: s,
        endStep: s,
        anchorHeading: st.heading,
        terrainClass: st.terrainClass
      });
    } else {
      lastBucket.endStep = s;
    }
  }

  const limLabel = results.limName.toLowerCase();

  // Map turnaround path index into activePath index
  const turnaroundActivePathIdx =
    mode === 'outbound' ? turnaroundRouteIdx : m - turnaroundRouteIdx;

  // Build DirectionLeg objects
  const legs: DirectionLeg[] = legBuckets.map((bucket, idx) => {
    const num = idx + 1;
    const startPathIdx = bucket.startStep;
    const endPathIdx = bucket.endStep + 1;
    const startCell = activePath[startPathIdx];
    const endCell = activePath[endPathIdx];

    const sx = startCell % W;
    const sy = Math.floor(startCell / W);
    const ex = endCell % W;
    const ey = Math.floor(endCell / W);
    const netDx = ex - sx;
    const netDy = ey - sy;

    const netDeg =
      netDx === 0 && netDy === 0
        ? bucket.anchorHeading
        : Math.atan2(netDx, -netDy) * (180 / Math.PI);
    const bearing = formatBearing(netDeg);

    let distM = 0;
    let legTimeH = 0;
    let weightedSlopeSum = 0;
    let maxSlopeDeg = 0;
    let strenuousSteps = 0;
    let crossesSoft = false;
    let softDistM = 0;

    for (let s = bucket.startStep; s <= bucket.endStep; s++) {
      const st = steps[s];
      distM += st.distM;
      legTimeH += st.timeH;
      weightedSlopeSum += st.slopeDeg * st.distM;
      if (st.slopeDeg > maxSlopeDeg) maxSlopeDeg = st.slopeDeg;
      if (st.isStrenuous) strenuousSteps++;
      if (st.isSoft) {
        crossesSoft = true;
        softDistM += st.distM;
      }
    }

    const avgSlopeDeg = distM > 0 ? weightedSlopeSum / distM : 0;
    const overComfort = maxSlopeDeg > params.comfort;
    const lastStep = steps[bucket.endStep];

    const containsTurnaround =
      !isTargetSafe &&
      turnaroundActivePathIdx >= startPathIdx &&
      turnaroundActivePathIdx <= endPathIdx &&
      (idx === 0 || turnaroundActivePathIdx > startPathIdx);

    // Build plain-English sentence from computed values only
    const slopeClause = overComfort
      ? `Avg slope ${avgSlopeDeg.toFixed(1)}°, steepest ${maxSlopeDeg.toFixed(1)}°, over the ${params.comfort}° comfort limit`
      : `Avg slope ${avgSlopeDeg.toFixed(1)}°, steepest ${maxSlopeDeg.toFixed(1)}°`;
    const softClause = crossesSoft ? ', crosses soft ground' : '';
    const elapsedClause =
      mode === 'outbound'
        ? `Elapsed ${formatDuration(lastStep.elapsedAtEndH)}`
        : `Return elapsed ${formatDuration(lastStep.elapsedAtEndH)} (total walk ${formatDuration(lastStep.totalWalkElapsedAtEndH)})`;
    const budgetClause =
      lastStep.budgetLeftAtEndH >= 0
        ? `${formatDuration(lastStep.budgetLeftAtEndH)} of ${limLabel} budget left`
        : `over ${limLabel} budget by ${formatDuration(-lastStep.budgetLeftAtEndH)}`;

    const sentence = `Leg ${num}: head ${bearing.dir8} (${bearing.str}°) for ${Math.round(distM)} m (${formatDuration(legTimeH)}). ${slopeClause}${softClause}. ${elapsedClause}, ${budgetClause}.`;

    return {
      num,
      startPathIdx,
      endPathIdx,
      startCell,
      endCell,
      bearingDeg: bearing.deg,
      bearingStr: bearing.str,
      dir8: bearing.dir8,
      terrainClass: bucket.terrainClass,
      distM,
      avgSlopeDeg,
      maxSlopeDeg,
      overComfort,
      strenuousSteps,
      crossesSoft,
      softDistM,
      legTimeH,
      elapsedH: lastStep.elapsedAtEndH,
      totalWalkElapsedH: lastStep.totalWalkElapsedAtEndH,
      budgetLeftH: lastStep.budgetLeftAtEndH,
      scienceCallouts: [],
      containsTurnaround,
      sentence
    };
  });

  // 4. Attach Science Target callouts (within 120 m = 4 cells) to the closest leg along activePath
  route.m.hit.forEach(target => {
    let bestPathIdx = 0;
    let minCells = Infinity;
    for (let k = 0; k < activePath.length; k++) {
      const cx = activePath[k] % W;
      const cy = Math.floor(activePath[k] / W);
      const d = Math.hypot(cx - target.x, cy - target.y);
      if (d < minCells) {
        minCells = d;
        bestPathIdx = k;
      }
    }
    const targetLeg =
      legs.find(l => bestPathIdx >= l.startPathIdx && bestPathIdx <= l.endPathIdx) || legs[0];
    if (targetLeg) {
      targetLeg.scienceCallouts.push({
        target,
        distanceM: minCells * cellMeters
      });
    }
  });

  // 5. Build Walk-through telemetry points for every cell index along activePath (0 .. m)
  const walkPoints: WalkPoint[] = [];
  for (let k = 0; k <= m; k++) {
    const cellIndex = activePath[k];
    const stepForTelemetry = k === 0 ? steps[0] : steps[k - 1];
    const legForPoint =
      legs.find(l => (k === 0 ? l.num === 1 : k > l.startPathIdx && k <= l.endPathIdx)) || legs[0];

    const bearing = formatBearing(stepForTelemetry.heading);

    if (mode === 'outbound' && !returnOnly) {
      const elapsedH = cumOutTime[k] + elapsedOffsetH;
      const totalWalkElapsedH = elapsedH;
      const budgetLeftH = results.usable - cumOutTime[k];
      const marginAtPointH = cellMargin[k];
      const status = evaluateStatus(marginAtPointH, results.usable);
      const distBackToHabM = cumOutDist[k];
      const distToTargetM = totalDistM - cumOutDist[k];

      walkPoints.push({
        pathIdx: k,
        cellIndex,
        legNum: legForPoint.num,
        elapsedH,
        totalWalkElapsedH,
        budgetLeftH,
        marginAtPointH,
        status,
        slopeDeg: stepForTelemetry.slopeDeg,
        headingDeg: bearing.deg,
        bearingStr: bearing.str,
        dir8: bearing.dir8,
        distToTargetM,
        distBackToHabM
      });
    } else if (returnOnly) {
      const elapsedH = k === 0 ? 0 : steps[k - 1].elapsedAtEndH;
      const totalWalkElapsedH = elapsedOffsetH + elapsedH;
      const budgetLeftH = results.usable - elapsedH;
      const marginAtPointH = route.m.margin;
      const status = evaluateStatus(marginAtPointH, results.usable);
      const distBackToHabM = totalDistM - cumOutDist[k];
      const distToTargetM = 0;

      walkPoints.push({
        pathIdx: k,
        cellIndex,
        legNum: legForPoint.num,
        elapsedH,
        totalWalkElapsedH,
        budgetLeftH,
        marginAtPointH,
        status,
        slopeDeg: stepForTelemetry.slopeDeg,
        headingDeg: bearing.deg,
        bearingStr: bearing.str,
        dir8: bearing.dir8,
        distToTargetM,
        distBackToHabM
      });
    } else {
      const routeForwardIdx = m - k;
      const elapsedH = k === 0 ? 0 : steps[k - 1].elapsedAtEndH;
      const totalWalkElapsedH = route.m.tOut + elapsedH;
      const budgetLeftH = results.usable - totalWalkElapsedH;
      const marginAtPointH = route.m.margin;
      const status = evaluateStatus(marginAtPointH, results.usable);
      const distBackToHabM = cumOutDist[routeForwardIdx];
      const distToTargetM = totalDistM - cumOutDist[routeForwardIdx];

      walkPoints.push({
        pathIdx: k,
        cellIndex,
        legNum: legForPoint.num,
        elapsedH,
        totalWalkElapsedH,
        budgetLeftH,
        marginAtPointH,
        status,
        slopeDeg: stepForTelemetry.slopeDeg,
        headingDeg: bearing.deg,
        bearingStr: bearing.str,
        dir8: bearing.dir8,
        distToTargetM,
        distBackToHabM
      });
    }
  }

  const totalTimeH = mode === 'outbound' && !returnOnly ? route.m.tOut : route.m.tBack;
  const summaryText = returnOnly
    ? isTargetSafe
      ? `Return path to habitat within budget, margin ${formatMinutesOnly(route.m.margin)}`
      : `Return path exceeds remaining budget by ${formatMinutesOnly(-route.m.margin)}`
    : isTargetSafe
      ? `Target is inside the safe range, margin ${formatMinutesOnly(route.m.margin)}`
      : `Target is outside the budget by ${formatMinutesOnly(-route.m.margin)}`;

  return {
    mode,
    routeId: route.id,
    routeName: route.name,
    limName: results.limName,
    activePath,
    legs,
    walkPoints,
    totalDistM,
    totalTimeH,
    turnaroundPathIdx: turnaroundRouteIdx,
    turnaroundCellIndex,
    turnaroundDistFromHabM: cumOutDist[turnaroundRouteIdx],
    turnaroundOutTimeH: cumOutTime[turnaroundRouteIdx],
    turnaroundBackTimeH: cumBackFromHab[turnaroundRouteIdx],
    isTargetSafe,
    targetMarginH: route.m.margin,
    summaryText
  };
}

/**
 * Builds completed ("Done") leg summaries from the path already walked during an active EVA.
 */
export function buildWalkedLegs(
  terrain: TerrainDataset,
  params: MissionParams,
  walkedPath: number[],
  limName: string,
  initialUsableBudget: number
): DirectionLeg[] {
  if (walkedPath.length < 2) return [];
  const { W, cellMeters, z, softF } = terrain;
  const baseEdge: EdgeParams = { cap: Infinity, softPen: 1.0 };

  interface StepItem {
    a: number;
    b: number;
    heading: number;
    distM: number;
    timeH: number;
    slopeDeg: number;
    isSoft: boolean;
    isStrenuous: boolean;
    terrainClass: TerrainClass;
    elapsedAtEndH: number;
  }

  const steps: StepItem[] = [];
  let elapsedAccum = 0;

  for (let s = 0; s < walkedPath.length - 1; s++) {
    const a = walkedPath[s];
    const b = walkedPath[s + 1];
    if (a === b) continue;
    const dx = (b % W) - (a % W);
    const dy = Math.floor(b / W) - Math.floor(a / W);
    const diag = dx !== 0 && dy !== 0;
    const heading = ((Math.atan2(dx, -dy) * (180 / Math.PI)) % 360 + 360) % 360;
    const distM = cellMeters * (diag ? Math.SQRT2 : 1.0);
    const timeH = calculateEdgeTime(terrain, params, a, b, diag, baseEdge);
    if (!Number.isFinite(timeH)) continue;
    elapsedAccum += timeH;
    const slopeDeg = Math.atan(Math.abs(z[b] - z[a]) / distM) * (180 / Math.PI);
    const isSoft = (softF[a] + softF[b]) * 0.5 > 0.5;
    const isStrenuous = slopeDeg > params.comfort;
    const terrainClass: TerrainClass = isStrenuous ? 'strenuous' : isSoft ? 'soft' : 'comfort';

    steps.push({
      a,
      b,
      heading,
      distM,
      timeH,
      slopeDeg,
      isSoft,
      isStrenuous,
      terrainClass,
      elapsedAtEndH: elapsedAccum
    });
  }

  if (steps.length === 0) return [];

  const buckets: { startStep: number; endStep: number; anchorHeading: number; terrainClass: TerrainClass }[] = [];
  for (let s = 0; s < steps.length; s++) {
    const st = steps[s];
    const last = buckets[buckets.length - 1];
    if (!last || headingDiffDeg(st.heading, last.anchorHeading) > 20 || st.terrainClass !== last.terrainClass) {
      buckets.push({ startStep: s, endStep: s, anchorHeading: st.heading, terrainClass: st.terrainClass });
    } else {
      last.endStep = s;
    }
  }

  const limLabel = limName.toLowerCase();
  return buckets.map((bucket, idx) => {
    const num = idx + 1;
    const startCell = steps[bucket.startStep].a;
    const endCell = steps[bucket.endStep].b;
    const netDx = (endCell % W) - (startCell % W);
    const netDy = Math.floor(endCell / W) - Math.floor(startCell / W);
    const netDeg = netDx === 0 && netDy === 0 ? bucket.anchorHeading : Math.atan2(netDx, -netDy) * (180 / Math.PI);
    const bearing = formatBearing(netDeg);

    let distM = 0;
    let legTimeH = 0;
    let wSlope = 0;
    let maxSlopeDeg = 0;
    let strenuousSteps = 0;
    let crossesSoft = false;
    let softDistM = 0;

    for (let s = bucket.startStep; s <= bucket.endStep; s++) {
      const st = steps[s];
      distM += st.distM;
      legTimeH += st.timeH;
      wSlope += st.slopeDeg * st.distM;
      if (st.slopeDeg > maxSlopeDeg) maxSlopeDeg = st.slopeDeg;
      if (st.isStrenuous) strenuousSteps++;
      if (st.isSoft) {
        crossesSoft = true;
        softDistM += st.distM;
      }
    }

    const avgSlopeDeg = distM > 0 ? wSlope / distM : 0;
    const overComfort = maxSlopeDeg > params.comfort;
    const lastStep = steps[bucket.endStep];
    const budgetLeftH = initialUsableBudget - lastStep.elapsedAtEndH;
    const slopeClause = overComfort
      ? `Avg slope ${avgSlopeDeg.toFixed(1)}°, steepest ${maxSlopeDeg.toFixed(1)}°, over the ${params.comfort}° comfort limit`
      : `Avg slope ${avgSlopeDeg.toFixed(1)}°, steepest ${maxSlopeDeg.toFixed(1)}°`;
    const softClause = crossesSoft ? ', crosses soft ground' : '';
    const budgetClause =
      budgetLeftH >= 0
        ? `${formatDuration(budgetLeftH)} of ${limLabel} budget left`
        : `over ${limLabel} budget by ${formatDuration(-budgetLeftH)}`;

    return {
      num,
      startPathIdx: bucket.startStep,
      endPathIdx: bucket.endStep + 1,
      startCell,
      endCell,
      bearingDeg: bearing.deg,
      bearingStr: bearing.str,
      dir8: bearing.dir8,
      terrainClass: bucket.terrainClass,
      distM,
      avgSlopeDeg,
      maxSlopeDeg,
      overComfort,
      strenuousSteps,
      crossesSoft,
      softDistM,
      legTimeH,
      elapsedH: lastStep.elapsedAtEndH,
      totalWalkElapsedH: lastStep.elapsedAtEndH,
      budgetLeftH,
      scienceCallouts: [],
      containsTurnaround: false,
      isDone: true,
      sentence: `Leg ${num} (Done): headed ${bearing.dir8} (${bearing.str}°) for ${Math.round(distM)} m (${formatDuration(legTimeH)}). ${slopeClause}${softClause}. Elapsed ${formatDuration(lastStep.elapsedAtEndH)}, ${budgetClause}.`
    };
  });
}

