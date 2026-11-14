/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  ClickMode,
  DirectionTab,
  EvaLiveTelemetry,
  EventLogEntry,
  MapLayer,
  MissionParams,
  PresetId,
  RouteCard,
  ScienceTarget,
  TerrainDataset,
  WalkbackState
} from './types';
import { createSampleTerrain, createJezeroTerrain } from './engine/terrain';
import {
  calculateEdgeTime,
  evaluateStatus,
  isCellDiagonal,
  planEVA,
  pickSensibleRoute,
  reconstructPath,
  reconstructReversePath,
  runDijkstra,
  verifyDestination
} from './engine/dijkstra';
import {
  buildRouteDirections,
  buildWalkedLegs,
  formatBearing,
  formatDuration,
  RouteDirections
} from './engine/directions';
import { createDefaultParams, MISSION_PRESETS } from './engine/presets';
import { TerrainMap } from './components/TerrainMap';
import { MissionLimitsPanel } from './components/MissionLimitsPanel';
import { LiveEvaPanel } from './components/LiveEvaPanel';
import { ResultsPanel } from './components/ResultsPanel';
import { DirectionsPanel } from './components/DirectionsPanel';
import { Sun, Moon, Rocket, Play, Square, RotateCcw } from 'lucide-react';

interface AppState extends WalkbackState {
  evaTrackPath: number[];
  evaTurnaroundPathIdx: number;
  evaInitialTargetSafe: boolean;
  latestAlertText: string | null;
}

function getLimitingConsumable(o2: number, pw: number, day: number): {
  val: number;
  name: 'Oxygen' | 'Suit power' | 'Daylight';
} {
  const val = Math.min(o2, pw, day);
  const name: 'Oxygen' | 'Suit power' | 'Daylight' =
    val === o2 ? 'Oxygen' : val === pw ? 'Suit power' : 'Daylight';
  return { val, name };
}

function computePathDistanceM(terrain: TerrainDataset, path: number[]): number {
  if (path.length < 2) return 0;
  const { W, cellMeters } = terrain;
  let dist = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const isDiag = a % W !== b % W && Math.floor(a / W) !== Math.floor(b / W);
    dist += cellMeters * (isDiag ? Math.SQRT2 : 1.0);
  }
  return dist;
}

function computeStepSlopeDeg(terrain: TerrainDataset, fromCell: number, toCell: number): number {
  if (fromCell === toCell) return terrain.slopeDeg[toCell] ?? 0;
  const { W, cellMeters, z } = terrain;
  const isDiag = fromCell % W !== toCell % W && Math.floor(fromCell / W) !== Math.floor(toCell / W);
  const dist = cellMeters * (isDiag ? Math.SQRT2 : 1.0);
  return Math.atan(Math.abs(z[toCell] - z[fromCell]) / dist) * (180 / Math.PI);
}

function appendLog(
  state: AppState,
  elapsedH: number,
  event: string,
  details: string
): AppState {
  const entry: EventLogEntry = {
    id: state.nextLogId,
    elapsedH,
    event,
    details
  };
  return {
    ...state,
    eventLog: [...state.eventLog, entry],
    nextLogId: state.nextLogId + 1
  };
}

function createInitialState(sampleTerrain: TerrainDataset): AppState {
  const habIndex = sampleTerrain.defaultHab.y * sampleTerrain.W + sampleTerrain.defaultHab.x;
  const tgtIndex = sampleTerrain.defaultTgt.y * sampleTerrain.W + sampleTerrain.defaultTgt.x;
  const params = createDefaultParams();
  return {
    terrainId: 'sample',
    habIndex,
    tgtIndex,
    selectedRouteId: 'fast',
    directionMode: 'outbound',
    preset: 'nominal',
    params,
    activeLayer: 'slope',
    clickMode: 'target',
    overlays: {
      reach: true,
      hazards: false,
      science: true,
      routes: true
    },
    missionStatus: 'planning',
    walkActive: false,
    walkStepIndex: 0,
    astronautCell: habIndex,
    elapsedH: 0,
    walkedPath: [habIndex],
    autoTurnaroundTriggered: false,
    routeSwitchNotice: null,
    lastLimName: null,
    activeWarnFlags: {
      lowBudget: false,
      overComfort: false,
      overHard: false
    },
    eventLog: [],
    nextLogId: 1,
    readAloudEnabled: false,
    theme: 'dark',
    evaTrackPath: [],
    evaTurnaroundPathIdx: 0,
    evaInitialTargetSafe: true,
    latestAlertText: null
  };
}

export default function App() {
  // Pre-generate deterministic terrain models once
  const sampleTerrain = useMemo(() => createSampleTerrain(), []);
  const jezeroTerrain = useMemo(() => createJezeroTerrain(), []);

  const getTerrain = useCallback(
    (id: 'sample' | 'jezero') => (id === 'sample' ? sampleTerrain : jezeroTerrain),
    [sampleTerrain, jezeroTerrain]
  );

  // Single source of truth state
  const [state, setState] = useState<AppState>(() => createInitialState(sampleTerrain));

  // requestAnimationFrame batching so rapid slider drags stay smooth in one pass per frame
  const latestStateRef = useRef<AppState>(state);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  const dispatchState = useCallback((updater: (prev: AppState) => AppState) => {
    const next = updater(latestStateRef.current);
    latestStateRef.current = next;
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        setState(latestStateRef.current);
      });
    }
  }, []);

  // Sync theme to document root
  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  const activeTerrain = getTerrain(state.terrainId);

  // =========================================================================
  // PURE STATE TRANSITION HELPERS (recompute routes, auto-select, EVA rules)
  // =========================================================================

  const reconcilePlanningState = useCallback(
    (candidate: AppState, autoPickRoute: boolean): AppState => {
      const terrain = getTerrain(candidate.terrainId);
      const res = planEVA(terrain, candidate.params, candidate.habIndex, candidate.tgtIndex);
      if (!autoPickRoute) {
        return { ...candidate, routeSwitchNotice: null };
      }
      const picked = pickSensibleRoute(res.routes, candidate.selectedRouteId);
      return {
        ...candidate,
        selectedRouteId: picked.selectedId,
        routeSwitchNotice: picked.switchNotice
      };
    },
    [getTerrain]
  );

  const evaluateEvaAfterMove = useCallback(
    (moved: AppState, movedSeg?: number[]): AppState => {
      const terrain = getTerrain(moved.terrainId);
      const { val: initLim } = getLimitingConsumable(
        moved.params.o2,
        moved.params.pw,
        moved.params.day
      );
      const initialBudget = initLim * (1.0 - moved.params.res / 100);
      const remUsableBeforeStay = initialBudget - moved.elapsedH;

      let next = { ...moved };
      const alerts: string[] = [];

      // Check remaining budget < 20% of limiting resource
      const lowBudgetNow = remUsableBeforeStay < 0.2 * initLim;
      if (lowBudgetNow && !next.activeWarnFlags.lowBudget) {
        const msg = `Remaining budget below 20% of limiting resource (${formatDuration(Math.max(0, remUsableBeforeStay))} left)`;
        alerts.push(msg);
        next = appendLog(next, next.elapsedH, 'Low Budget Warning', msg);
      }

      // Check every edge of the walked segment for steps exceeding the comfort slope limit
      const lastPrevCell =
        next.walkedPath.length >= 2 ? next.walkedPath[next.walkedPath.length - 2] : next.astronautCell;
      const currentSlope = computeStepSlopeDeg(terrain, lastPrevCell, next.astronautCell);

      let maxSegSlope = currentSlope;
      if (movedSeg && movedSeg.length >= 2) {
        maxSegSlope = 0;
        for (let i = 1; i < movedSeg.length; i++) {
          const edgeSlope = computeStepSlopeDeg(terrain, movedSeg[i - 1], movedSeg[i]);
          if (edgeSlope > maxSegSlope) {
            maxSegSlope = edgeSlope;
          }
        }
      }

      const segOverComfort = maxSegSlope > next.params.comfort;
      const currentOverComfort = currentSlope > next.params.comfort;

      if (segOverComfort && !next.activeWarnFlags.overComfort) {
        const msg = `Slope ${maxSegSlope.toFixed(1)}° exceeds the ${next.params.comfort}° comfort limit`;
        alerts.push(msg);
        next = appendLog(next, next.elapsedH, 'Comfort Slope Exceeded', msg);
      }

      next.activeWarnFlags = {
        lowBudget: lowBudgetNow,
        overComfort: currentOverComfort,
        overHard: false
      };

      // Check Outbound Turnaround condition
      if (!next.autoTurnaroundTriggered && next.directionMode === 'outbound') {
        const outUsable = Math.max(0, remUsableBeforeStay - next.params.stay);
        const outRes = planEVA(
          terrain,
          next.params,
          next.habIndex,
          next.tgtIndex,
          next.astronautCell,
          outUsable,
          false
        );

        const timeToDestH = outRes.out.dist[next.tgtIndex];
        const timeBackFromHereToHabH = outRes.back.dist[next.astronautCell];
        const timeBackFromDestToHabH = outRes.back.dist[next.tgtIndex];
        const continueMarginH =
          remUsableBeforeStay - next.params.stay - timeToDestH - timeBackFromDestToHabH;

        const passedPlannedTurnaround =
          !next.evaInitialTargetSafe &&
          next.evaTrackPath.length > 0 &&
          next.walkStepIndex > next.evaTurnaroundPathIdx;

        const hasMovedOrBudgetGone = next.astronautCell !== next.habIndex || remUsableBeforeStay <= 0;

        if ((continueMarginH <= 0 || passedPlannedTurnaround) && hasMovedOrBudgetGone) {
          // Automatic turnaround! Switch to Return and select best route home
          const returnUsable = Math.max(0, remUsableBeforeStay);
          const homeRes = planEVA(
            terrain,
            next.params,
            next.habIndex,
            next.habIndex,
            next.astronautCell,
            returnUsable,
            true
          );

          const bestHome = pickSensibleRoute(homeRes.routes, 'safe');
          const homeRoute =
            homeRes.routes.find(r => r.id === bestHome.selectedId) || homeRes.routes[0];

          const needMin = Math.round(timeBackFromHereToHabH * 60);
          const haveMin = Math.round(Math.max(0, remUsableBeforeStay) * 60);
          const turnMsg = `Turn around now: the way back needs ${needMin} min and you have ${haveMin} min`;
          alerts.push(turnMsg);

          next = {
            ...next,
            autoTurnaroundTriggered: true,
            directionMode: 'return',
            selectedRouteId: homeRoute ? homeRoute.id : next.selectedRouteId,
            routeSwitchNotice: `Auto-switched to ${homeRoute ? homeRoute.name : 'Return'} route home.`,
            evaTrackPath: homeRoute ? homeRoute.path : [next.astronautCell],
            walkStepIndex: 0
          };
          next = appendLog(next, next.elapsedH, 'Turnaround Triggered', turnMsg);
        } else {
          // Keep current selected route viable when outbound
          const picked = pickSensibleRoute(outRes.routes, next.selectedRouteId);
          if (picked.selectedId !== next.selectedRouteId) {
            next.selectedRouteId = picked.selectedId;
            next.routeSwitchNotice = picked.switchNotice;
          }
        }
      } else if (next.directionMode === 'return') {
        if (next.astronautCell === next.habIndex && next.walkedPath.length > 1) {
          const lastEntry = next.eventLog[next.eventLog.length - 1];
          if (!lastEntry || lastEntry.event !== 'Returned to Habitat') {
            next = appendLog(
              next,
              next.elapsedH,
              'Returned to Habitat',
              `Arrived at habitat with ${formatDuration(Math.max(0, remUsableBeforeStay))} remaining`
            );
          }
        }
      }

      if (alerts.length > 0) {
        next.latestAlertText = alerts.join('. ');
      }

      return next;
    },
    [getTerrain]
  );

  // =========================================================================
  // SINGLE DERIVED RENDER PIPELINE (all panels derived from `state`)
  // =========================================================================

  const derived = useMemo(() => {
    const terrain = getTerrain(state.terrainId);
    const isEvaActive = state.missionStatus === 'active';
    const isEvaReturning = isEvaActive && state.directionMode === 'return';

    const { val: initLim, name: initLimName } = getLimitingConsumable(
      state.params.o2,
      state.params.pw,
      state.params.day
    );
    const initialBudget = initLim * (1.0 - state.params.res / 100);
    const initialUsable = Math.max(0, initialBudget - state.params.stay);

    const remO2 = Math.max(0, state.params.o2 - state.elapsedH);
    const remPw = Math.max(0, state.params.pw - state.elapsedH);
    const remDay = Math.max(0, state.params.day - state.elapsedH);
    const { name: remLimName } = getLimitingConsumable(remO2, remPw, remDay);
    const remUsableBeforeStay = initialBudget - state.elapsedH;

    const originIndex = isEvaActive ? state.astronautCell : state.habIndex;
    const planDestIndex = isEvaReturning ? state.habIndex : state.tgtIndex;
    const overrideUsable = isEvaActive
      ? Math.max(0, isEvaReturning ? remUsableBeforeStay : remUsableBeforeStay - state.params.stay)
      : undefined;

    const results = planEVA(
      terrain,
      state.params,
      state.habIndex,
      planDestIndex,
      originIndex,
      overrideUsable,
      isEvaReturning
    );

    const activeRoute: RouteCard | undefined =
      results.routes.find(r => r.id === state.selectedRouteId) || results.routes[0];

    const verification = verifyDestination(
      terrain,
      state.params,
      results,
      activeRoute,
      state.habIndex,
      planDestIndex,
      originIndex
    );

    const directions: RouteDirections | null = buildRouteDirections(
      terrain,
      state.params,
      results,
      activeRoute,
      state.directionMode,
      isEvaActive ? state.elapsedH : 0,
      isEvaReturning
    );

    const walkedLegs = isEvaActive
      ? buildWalkedLegs(
          terrain,
          state.params,
          state.walkedPath,
          initLimName,
          isEvaReturning ? initialBudget : initialUsable
        )
      : [];

    // Compute live EVA telemetry when mission is active
    let evaTelemetry: EvaLiveTelemetry | null = null;
    if (isEvaActive) {
      const timeToDestH = results.out.dist[state.tgtIndex];
      const timeBackFromHereToHabH = results.back.dist[state.astronautCell];
      const timeBackFromDestToHabH = results.back.dist[state.tgtIndex];

      const continueMarginH =
        remUsableBeforeStay - state.params.stay - timeToDestH - timeBackFromDestToHabH;
      const turnaroundMarginH = remUsableBeforeStay - timeBackFromHereToHabH;

      const backPathCells =
        results.back.dist[state.astronautCell] < Infinity
          ? reconstructReversePath(results.back.link, state.astronautCell)
          : [state.astronautCell];
      const distBackToHabM = computePathDistanceM(terrain, backPathCells);

      const distToDestM =
        !isEvaReturning && activeRoute
          ? activeRoute.m.dist
          : Math.hypot(
              (state.tgtIndex % terrain.W) - (state.astronautCell % terrain.W),
              Math.floor(state.tgtIndex / terrain.W) - Math.floor(state.astronautCell / terrain.W)
            ) * terrain.cellMeters;

      const lastPrevCell =
        state.walkedPath.length >= 2
          ? state.walkedPath[state.walkedPath.length - 2]
          : state.astronautCell;
      const currentSlopeDeg = computeStepSlopeDeg(terrain, lastPrevCell, state.astronautCell);

      let headingDeg = directions?.walkPoints[0]?.headingDeg ?? 0;
      let bearingStr = directions?.walkPoints[0]?.bearingStr ?? '000';
      let dir8 = directions?.walkPoints[0]?.dir8 ?? 'N';
      if (state.walkedPath.length >= 2 && lastPrevCell !== state.astronautCell) {
        const dx = (state.astronautCell % terrain.W) - (lastPrevCell % terrain.W);
        const dy = Math.floor(state.astronautCell / terrain.W) - Math.floor(lastPrevCell / terrain.W);
        const b = formatBearing(Math.atan2(dx, -dy) * (180 / Math.PI));
        headingDeg = b.deg;
        bearingStr = b.str;
        dir8 = b.dir8;
      }

      const evaStatus = isEvaReturning
        ? evaluateStatus(turnaroundMarginH, Math.max(0, remUsableBeforeStay))
        : evaluateStatus(continueMarginH, Math.max(0, remUsableBeforeStay - state.params.stay));

      const warnings: string[] = [];
      if (remUsableBeforeStay < 0.2 * initLim) {
        warnings.push(
          `Remaining budget is under 20% of ${initLimName.toLowerCase()} limit (${formatDuration(Math.max(0, remUsableBeforeStay))} left).`
        );
      }
      if (currentSlopeDeg > state.params.comfort) {
        warnings.push(
          `Current slope (${currentSlopeDeg.toFixed(1)}°) exceeds the ${state.params.comfort}° comfort limit.`
        );
      }

      const turnaroundBanner = state.autoTurnaroundTriggered
        ? `Turn around now: the way back needs ${Math.round(timeBackFromHereToHabH * 60)} min and you have ${Math.round(Math.max(0, remUsableBeforeStay) * 60)} min`
        : null;

      evaTelemetry = {
        elapsedH: state.elapsedH,
        remO2,
        remPw,
        remDay,
        remLimName,
        remUsableBeforeStay,
        currentCell: state.astronautCell,
        currentSlopeDeg,
        currentHeadingDeg: headingDeg,
        currentBearingStr: bearingStr,
        currentDir8: dir8,
        distToDestM,
        distBackToHabM,
        timeToDestH,
        timeBackFromHereToHabH,
        timeBackFromDestToHabH,
        continueMarginH,
        turnaroundMarginH,
        status: evaStatus,
        autoTurnaround: state.autoTurnaroundTriggered,
        turnaroundBanner,
        warnings
      };
    }

    const walkCellIndex = isEvaActive
      ? state.astronautCell
      : state.walkActive && directions && directions.walkPoints.length > 0
        ? directions.walkPoints[Math.min(state.walkStepIndex, directions.walkPoints.length - 1)].cellIndex
        : null;

    return {
      terrain,
      isEvaActive,
      isEvaReturning,
      results,
      activeRoute,
      verification,
      directions,
      walkedLegs,
      evaTelemetry,
      walkCellIndex
    };
  }, [state, getTerrain]);

  // =========================================================================
  // USER ACTION HANDLERS (all route through dispatchState)
  // =========================================================================

  const handleToggleTheme = useCallback(() => {
    dispatchState(prev => ({
      ...prev,
      theme: prev.theme === 'dark' ? 'light' : 'dark'
    }));
  }, [dispatchState]);

  const handleSwitchTerrain = useCallback(
    (nextId: 'sample' | 'jezero') => {
      dispatchState(prev => {
        if (prev.terrainId === nextId || prev.missionStatus === 'active') return prev;
        const t = getTerrain(nextId);
        const habIndex = t.defaultHab.y * t.W + t.defaultHab.x;
        const tgtIndex = t.defaultTgt.y * t.W + t.defaultTgt.x;
        return reconcilePlanningState(
          {
            ...prev,
            terrainId: nextId,
            habIndex,
            tgtIndex,
            astronautCell: habIndex,
            walkedPath: [habIndex],
            walkStepIndex: 0
          },
          true
        );
      });
    },
    [dispatchState, getTerrain, reconcilePlanningState]
  );

  const handleUpdateParam = useCallback(
    (key: keyof MissionParams, val: number) => {
      dispatchState(prev => {
        if (prev.missionStatus === 'active') return prev;
        const nextParams = { ...prev.params, [key]: val };
        // Keep comfort <= maxSlope cleanly when user moves sliders
        if (key === 'comfort' && val > nextParams.maxSlope) {
          nextParams.maxSlope = val;
        } else if (key === 'maxSlope' && val < nextParams.comfort) {
          nextParams.comfort = val;
        }
        return reconcilePlanningState(
          {
            ...prev,
            params: nextParams,
            preset: 'custom'
          },
          true
        );
      });
    },
    [dispatchState, reconcilePlanningState]
  );

  const handleSelectPreset = useCallback(
    (presetId: Exclude<PresetId, 'custom'>) => {
      dispatchState(prev => {
        if (prev.missionStatus === 'active') return prev;
        const spec = MISSION_PRESETS[presetId];
        const nextParams: MissionParams = {
          ...prev.params,
          o2: spec.o2,
          pw: spec.pw,
          day: spec.day,
          res: spec.res,
          stay: spec.stay
        };
        return reconcilePlanningState(
          {
            ...prev,
            preset: presetId,
            params: nextParams
          },
          true
        );
      });
    },
    [dispatchState, reconcilePlanningState]
  );

  const handleResetDefaults = useCallback(() => {
    dispatchState(prev => {
      const t = getTerrain(prev.terrainId);
      const habIndex = t.defaultHab.y * t.W + t.defaultHab.x;
      const tgtIndex = t.defaultTgt.y * t.W + t.defaultTgt.x;
      return reconcilePlanningState(
        {
          ...prev,
          preset: 'nominal',
          params: createDefaultParams(),
          missionStatus: 'planning',
          clickMode: prev.clickMode === 'here' ? 'target' : prev.clickMode,
          walkActive: false,
          walkStepIndex: 0,
          directionMode: 'outbound',
          astronautCell: habIndex,
          habIndex: prev.missionStatus === 'active' ? habIndex : prev.habIndex,
          tgtIndex: prev.missionStatus === 'active' ? tgtIndex : prev.tgtIndex,
          elapsedH: 0,
          walkedPath: [habIndex],
          autoTurnaroundTriggered: false,
          routeSwitchNotice: null,
          lastLimName: null,
          activeWarnFlags: { lowBudget: false, overComfort: false, overHard: false },
          eventLog: [],
          evaTrackPath: [],
          evaTurnaroundPathIdx: 0,
          evaInitialTargetSafe: true,
          latestAlertText: null
        },
        true
      );
    });
  }, [dispatchState, getTerrain, reconcilePlanningState]);

  const handleSetClickMode = useCallback(
    (mode: ClickMode) => {
      dispatchState(prev => ({ ...prev, clickMode: mode }));
    },
    [dispatchState]
  );

  const handleSetPoint = useCallback(
    (index: number) => {
      dispatchState(prev => {
        const terrain = getTerrain(prev.terrainId);
        // Active EVA: "I am here" moves astronaut via shortest traversable path
        if (prev.missionStatus === 'active' && prev.clickMode === 'here') {
          if (index === prev.astronautCell) return prev;
          const dijk = runDijkstra(
            terrain,
            prev.params,
            prev.astronautCell,
            { cap: prev.params.maxSlope, softPen: 1.0 },
            false
          );
          if (dijk.dist[index] === Infinity) {
            const msg = `Cannot move to selected cell: unreachable under ${prev.params.maxSlope}° hard slope limit`;
            return appendLog(
              { ...prev, latestAlertText: msg },
              prev.elapsedH,
              'Move Blocked',
              msg
            );
          }

          const seg = reconstructPath(dijk.link, prev.astronautCell, index);
          const addedH = dijk.dist[index];
          const nextElapsed = prev.elapsedH + addedH;
          const nextWalked = prev.walkedPath.concat(seg.slice(1));

          // Recompute new slider track path from clicked cell to current EVA destination
          const isReturning = prev.directionMode === 'return';
          const { val: initLim } = getLimitingConsumable(
            prev.params.o2,
            prev.params.pw,
            prev.params.day
          );
          const initialBudget = initLim * (1.0 - prev.params.res / 100);
          const remAfter = initialBudget - nextElapsed;
          const planUsable = Math.max(0, isReturning ? remAfter : remAfter - prev.params.stay);
          const destCell = isReturning ? prev.habIndex : prev.tgtIndex;
          const newPlan = planEVA(
            terrain,
            prev.params,
            prev.habIndex,
            destCell,
            index,
            planUsable,
            isReturning
          );
          const newRoute =
            newPlan.routes.find(r => r.id === prev.selectedRouteId) || newPlan.routes[0];

          const movedState = appendLog(
            {
              ...prev,
              astronautCell: index,
              elapsedH: nextElapsed,
              walkedPath: nextWalked,
              evaTrackPath: newRoute ? newRoute.path : [index],
              walkStepIndex: 0
            },
            nextElapsed,
            'Position Updated',
            `Moved ${(computePathDistanceM(terrain, seg)).toFixed(0)} m (+${formatDuration(addedH)})`
          );

          return evaluateEvaAfterMove(movedState, seg);
        }

        // Setting Target or Habitat
        if (prev.clickMode === 'hab' && prev.missionStatus === 'planning') {
          return reconcilePlanningState(
            {
              ...prev,
              habIndex: index,
              astronautCell: index,
              walkedPath: [index]
            },
            true
          );
        }

        // Setting Target (works in planning and active EVA)
        const next: AppState = { ...prev, tgtIndex: index };
        if (prev.missionStatus === 'active') {
          const isReturning = prev.directionMode === 'return';
          const { val: initLim } = getLimitingConsumable(
            prev.params.o2,
            prev.params.pw,
            prev.params.day
          );
          const initialBudget = initLim * (1.0 - prev.params.res / 100);
          const remAfter = initialBudget - prev.elapsedH;
          const planUsable = Math.max(0, isReturning ? remAfter : remAfter - prev.params.stay);
          const destCell = isReturning ? prev.habIndex : index;
          const newPlan = planEVA(
            terrain,
            prev.params,
            prev.habIndex,
            destCell,
            prev.astronautCell,
            planUsable,
            isReturning
          );
          const picked = pickSensibleRoute(newPlan.routes, prev.selectedRouteId);
          const newRoute = newPlan.routes.find(r => r.id === picked.selectedId) || newPlan.routes[0];
          const dirs = buildRouteDirections(
            terrain,
            prev.params,
            newPlan,
            newRoute,
            prev.directionMode,
            prev.elapsedH,
            isReturning
          );
          return appendLog(
            {
              ...next,
              selectedRouteId: picked.selectedId,
              routeSwitchNotice: picked.switchNotice,
              evaTrackPath: newRoute ? newRoute.path : [prev.astronautCell],
              walkStepIndex: 0,
              evaTurnaroundPathIdx: dirs ? dirs.turnaroundPathIdx : 0,
              evaInitialTargetSafe: dirs ? dirs.isTargetSafe : true
            },
            prev.elapsedH,
            'Destination Changed',
            `New target X ${(index % terrain.W) * terrain.cellMeters} m, Y ${Math.floor(index / terrain.W) * terrain.cellMeters} m`
          );
        }

        return reconcilePlanningState(next, true);
      });
    },
    [dispatchState, getTerrain, evaluateEvaAfterMove, reconcilePlanningState]
  );

  const handleNudgePoint = useCallback(
    (dx: number, dy: number) => {
      const { W, H } = getTerrain(latestStateRef.current.terrainId);
      const curr = latestStateRef.current;
      const isHab = curr.clickMode === 'hab' && curr.missionStatus === 'planning';
      const isHere = curr.clickMode === 'here' && curr.missionStatus === 'active';
      const baseIdx = isHab ? curr.habIndex : isHere ? curr.astronautCell : curr.tgtIndex;
      const nx = Math.max(0, Math.min(W - 1, (baseIdx % W) + dx));
      const ny = Math.max(0, Math.min(H - 1, Math.floor(baseIdx / W) + dy));
      handleSetPoint(ny * W + nx);
    },
    [getTerrain, handleSetPoint]
  );

  const handleUseNearestReachable = useCallback(
    (cellIndex: number) => {
      dispatchState(prev => {
        if (prev.missionStatus === 'active') {
          const terrain = getTerrain(prev.terrainId);
          const { val: initLim } = getLimitingConsumable(
            prev.params.o2,
            prev.params.pw,
            prev.params.day
          );
          const initialBudget = initLim * (1.0 - prev.params.res / 100);
          const remAfter = initialBudget - prev.elapsedH;
          const isReturning = prev.directionMode === 'return';
          const planUsable = Math.max(0, isReturning ? remAfter : remAfter - prev.params.stay);
          const newPlan = planEVA(
            terrain,
            prev.params,
            prev.habIndex,
            cellIndex,
            prev.astronautCell,
            planUsable,
            isReturning
          );
          const picked = pickSensibleRoute(newPlan.routes, prev.selectedRouteId);
          const newRoute = newPlan.routes.find(r => r.id === picked.selectedId) || newPlan.routes[0];
          const dirs = buildRouteDirections(
            terrain,
            prev.params,
            newPlan,
            newRoute,
            prev.directionMode,
            prev.elapsedH,
            isReturning
          );
          return appendLog(
            {
              ...prev,
              tgtIndex: cellIndex,
              selectedRouteId: picked.selectedId,
              routeSwitchNotice: picked.switchNotice,
              evaTrackPath: newRoute ? newRoute.path : [prev.astronautCell],
              walkStepIndex: 0,
              evaTurnaroundPathIdx: dirs ? dirs.turnaroundPathIdx : 0,
              evaInitialTargetSafe: dirs ? dirs.isTargetSafe : true
            },
            prev.elapsedH,
            'Destination Relocated',
            'Accepted nearest reachable destination'
          );
        }
        return reconcilePlanningState({ ...prev, tgtIndex: cellIndex }, true);
      });
    },
    [dispatchState, getTerrain, reconcilePlanningState]
  );

  const handleSelectScienceTarget = useCallback(
    (target: ScienceTarget) => {
      dispatchState(prev => {
        if (prev.missionStatus === 'active') {
          const terrain = getTerrain(prev.terrainId);
          const { val: initLim } = getLimitingConsumable(
            prev.params.o2,
            prev.params.pw,
            prev.params.day
          );
          const initialBudget = initLim * (1.0 - prev.params.res / 100);
          const remAfter = initialBudget - prev.elapsedH;
          const newPlan = planEVA(
            terrain,
            prev.params,
            prev.habIndex,
            target.i,
            prev.astronautCell,
            Math.max(0, remAfter - prev.params.stay),
            false
          );
          const picked = pickSensibleRoute(newPlan.routes, 'sci');
          const newRoute = newPlan.routes.find(r => r.id === picked.selectedId) || newPlan.routes[0];
          const dirs = buildRouteDirections(
            terrain,
            prev.params,
            newPlan,
            newRoute,
            'outbound',
            prev.elapsedH,
            false
          );
          return appendLog(
            {
              ...prev,
              tgtIndex: target.i,
              directionMode: 'outbound',
              selectedRouteId: picked.selectedId,
              routeSwitchNotice: picked.switchNotice,
              evaTrackPath: newRoute ? newRoute.path : [prev.astronautCell],
              walkStepIndex: 0,
              evaTurnaroundPathIdx: dirs ? dirs.turnaroundPathIdx : 0,
              evaInitialTargetSafe: dirs ? dirs.isTargetSafe : true
            },
            prev.elapsedH,
            'Science Target Selected',
            `${target.id}: ${target.name}`
          );
        }
        return reconcilePlanningState(
          {
            ...prev,
            tgtIndex: target.i,
            selectedRouteId: 'sci'
          },
          true
        );
      });
    },
    [dispatchState, getTerrain, reconcilePlanningState]
  );

  const handleSelectRouteId = useCallback(
    (id: 'fast' | 'safe' | 'sci') => {
      dispatchState(prev => {
        if (prev.missionStatus === 'active') {
          const terrain = getTerrain(prev.terrainId);
          const isReturning = prev.directionMode === 'return';
          const { val: initLim } = getLimitingConsumable(
            prev.params.o2,
            prev.params.pw,
            prev.params.day
          );
          const initialBudget = initLim * (1.0 - prev.params.res / 100);
          const remAfter = initialBudget - prev.elapsedH;
          const planUsable = Math.max(0, isReturning ? remAfter : remAfter - prev.params.stay);
          const destCell = isReturning ? prev.habIndex : prev.tgtIndex;
          const newPlan = planEVA(
            terrain,
            prev.params,
            prev.habIndex,
            destCell,
            prev.astronautCell,
            planUsable,
            isReturning
          );
          const newRoute = newPlan.routes.find(r => r.id === id) || newPlan.routes[0];
          const dirs = buildRouteDirections(
            terrain,
            prev.params,
            newPlan,
            newRoute,
            prev.directionMode,
            prev.elapsedH,
            isReturning
          );
          return {
            ...prev,
            selectedRouteId: id,
            routeSwitchNotice: null,
            evaTrackPath: newRoute ? newRoute.path : prev.evaTrackPath,
            walkStepIndex: 0,
            evaTurnaroundPathIdx: dirs ? dirs.turnaroundPathIdx : 0,
            evaInitialTargetSafe: dirs ? dirs.isTargetSafe : true
          };
        }
        return {
          ...prev,
          selectedRouteId: id,
          routeSwitchNotice: null
        };
      });
    },
    [dispatchState, getTerrain]
  );

  const handleSetDirectionMode = useCallback(
    (mode: DirectionTab) => {
      dispatchState(prev => {
        if (prev.missionStatus === 'active') {
          const terrain = getTerrain(prev.terrainId);
          const isReturning = mode === 'return';
          const { val: initLim } = getLimitingConsumable(
            prev.params.o2,
            prev.params.pw,
            prev.params.day
          );
          const initialBudget = initLim * (1.0 - prev.params.res / 100);
          const remAfter = initialBudget - prev.elapsedH;
          const planUsable = Math.max(0, isReturning ? remAfter : remAfter - prev.params.stay);
          const destCell = isReturning ? prev.habIndex : prev.tgtIndex;
          const newPlan = planEVA(
            terrain,
            prev.params,
            prev.habIndex,
            destCell,
            prev.astronautCell,
            planUsable,
            isReturning
          );
          const picked = pickSensibleRoute(newPlan.routes, prev.selectedRouteId);
          const newRoute = newPlan.routes.find(r => r.id === picked.selectedId) || newPlan.routes[0];
          const dirs = buildRouteDirections(
            terrain,
            prev.params,
            newPlan,
            newRoute,
            mode,
            prev.elapsedH,
            isReturning
          );
          return appendLog(
            {
              ...prev,
              directionMode: mode,
              selectedRouteId: picked.selectedId,
              evaTrackPath: newRoute ? newRoute.path : [prev.astronautCell],
              walkStepIndex: 0,
              evaTurnaroundPathIdx: dirs ? dirs.turnaroundPathIdx : 0,
              evaInitialTargetSafe: dirs ? dirs.isTargetSafe : true
            },
            prev.elapsedH,
            mode === 'return' ? 'Switched to Return' : 'Switched to Outbound',
            mode === 'return' ? 'Planning route back to habitat' : 'Planning route to destination'
          );
        }
        return { ...prev, directionMode: mode, walkStepIndex: 0 };
      });
    },
    [dispatchState, getTerrain]
  );

  const handleStartEva = useCallback(() => {
    dispatchState(prev => {
      const terrain = getTerrain(prev.terrainId);
      const initPlan = planEVA(terrain, prev.params, prev.habIndex, prev.tgtIndex);
      const picked = pickSensibleRoute(initPlan.routes, prev.selectedRouteId);
      const activeRoute =
        initPlan.routes.find(r => r.id === picked.selectedId) || initPlan.routes[0];
      const dirs = buildRouteDirections(terrain, prev.params, initPlan, activeRoute, 'outbound');

      const started: AppState = {
        ...prev,
        missionStatus: 'active',
        clickMode: 'here',
        walkActive: true,
        directionMode: 'outbound',
        selectedRouteId: picked.selectedId,
        routeSwitchNotice: picked.switchNotice,
        astronautCell: prev.habIndex,
        elapsedH: 0,
        walkedPath: [prev.habIndex],
        walkStepIndex: 0,
        autoTurnaroundTriggered: false,
        lastLimName: initPlan.limName,
        activeWarnFlags: { lowBudget: false, overComfort: false, overHard: false },
        eventLog: [],
        nextLogId: 1,
        evaTrackPath: activeRoute ? activeRoute.path : [prev.habIndex],
        evaTurnaroundPathIdx: dirs ? dirs.turnaroundPathIdx : 0,
        evaInitialTargetSafe: dirs ? dirs.isTargetSafe : true,
        latestAlertText: null
      };

      return appendLog(
        started,
        0,
        'EVA Started',
        `${initPlan.limName}-limited (${initPlan.lim.toFixed(1)} h), usable walking budget ${formatDuration(initPlan.usable)}, route ${activeRoute ? activeRoute.name : 'None'}`
      );
    });
  }, [dispatchState, getTerrain]);

  const handleEndEva = useCallback(() => {
    dispatchState(prev => ({
      ...prev,
      missionStatus: 'planning',
      clickMode: prev.clickMode === 'here' ? 'target' : prev.clickMode,
      walkActive: false,
      walkStepIndex: 0,
      directionMode: 'outbound',
      astronautCell: prev.habIndex,
      elapsedH: 0,
      walkedPath: [prev.habIndex],
      autoTurnaroundTriggered: false,
      routeSwitchNotice: null,
      lastLimName: null,
      activeWarnFlags: { lowBudget: false, overComfort: false, overHard: false },
      evaTrackPath: [],
      latestAlertText: null
    }));
  }, [dispatchState]);

  const handleToggleWalk = useCallback(() => {
    dispatchState(prev => ({
      ...prev,
      walkActive: !prev.walkActive
    }));
  }, [dispatchState]);

  const handleChangeWalkStep = useCallback(
    (nextStep: number) => {
      dispatchState(prev => {
        if (prev.missionStatus !== 'active') {
          return { ...prev, walkStepIndex: Math.max(0, nextStep) };
        }

        const terrain = getTerrain(prev.terrainId);
        const track = prev.evaTrackPath;
        if (track.length === 0) return prev;
        const clamped = Math.max(0, Math.min(nextStep, track.length - 1));
        if (clamped === prev.walkStepIndex) return prev;

        const targetCell = track[clamped];
        if (targetCell === prev.astronautCell) {
          return { ...prev, walkStepIndex: clamped };
        }

        // Compute shortest traversable path cost from current astronautCell to targetCell
        // (monotonically adds elapsed time so consumables NEVER increase even if slider moves back)
        const edgeParams = { cap: prev.params.maxSlope, softPen: 1.0 };
        let seg: number[] = [];
        let addedH = 0;
        if (clamped > prev.walkStepIndex) {
          seg = track.slice(prev.walkStepIndex, clamped + 1);
          let trackH = 0;
          let ok = true;
          for (let i = 1; i < seg.length; i++) {
            const a = seg[i - 1];
            const b = seg[i];
            const cost = calculateEdgeTime(
              terrain,
              prev.params,
              a,
              b,
              isCellDiagonal(terrain.W, a, b),
              edgeParams
            );
            if (!Number.isFinite(cost)) {
              ok = false;
              break;
            }
            trackH += cost;
          }
          if (ok) {
            addedH = trackH;
          } else {
            const dijk = runDijkstra(terrain, prev.params, prev.astronautCell, edgeParams, false);
            if (dijk.dist[targetCell] === Infinity) return prev;
            seg = reconstructPath(dijk.link, prev.astronautCell, targetCell);
            addedH = dijk.dist[targetCell];
          }
        } else {
          const dijk = runDijkstra(terrain, prev.params, prev.astronautCell, edgeParams, false);
          if (dijk.dist[targetCell] === Infinity) return prev;
          seg = reconstructPath(dijk.link, prev.astronautCell, targetCell);
          addedH = dijk.dist[targetCell];
        }

        const moved: AppState = {
          ...prev,
          walkStepIndex: clamped,
          astronautCell: targetCell,
          elapsedH: prev.elapsedH + addedH,
          walkedPath: prev.walkedPath.concat(seg.slice(1))
        };

        return evaluateEvaAfterMove(moved, seg);
      });
    },
    [dispatchState, getTerrain, evaluateEvaAfterMove]
  );

  const handleSetOverlays = useCallback(
    (
      updater:
        | WalkbackState['overlays']
        | ((prev: WalkbackState['overlays']) => WalkbackState['overlays'])
    ) => {
      dispatchState(prev => ({
        ...prev,
        overlays: typeof updater === 'function' ? updater(prev.overlays) : updater
      }));
    },
    [dispatchState]
  );

  const handleSetActiveLayer = useCallback(
    (layer: MapLayer) => {
      dispatchState(prev => ({ ...prev, activeLayer: layer }));
    },
    [dispatchState]
  );

  const handleToggleReadAloud = useCallback(() => {
    dispatchState(prev => ({ ...prev, readAloudEnabled: !prev.readAloudEnabled }));
  }, [dispatchState]);

  const {
    isEvaActive,
    isEvaReturning,
    results,
    activeRoute,
    verification,
    directions,
    walkedLegs,
    evaTelemetry,
    walkCellIndex
  } = derived;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--fg)]">
      {/* Top Mission Control Operations Header */}
      <header className="no-print border-b border-[var(--line)] bg-[var(--panel)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-[var(--accent)] flex items-center justify-center text-[var(--accent-ink)] font-bold shadow-sm">
              <Rocket className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-widest uppercase m-0 leading-none">
                WALKBACK
              </h1>
              <span className="text-xs text-[var(--fg-dim)] tracking-wide">
                EVA Range &amp; Route Planner · Mars Exploration
              </span>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-1.5 ml-2 pl-3 border-l border-[var(--line)] text-xs text-[var(--fg-dim)]">
            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[var(--panel-2)] border border-[var(--line)]">
              NASA Space Apps
            </span>
            <span className="hidden xl:inline">Interplanetary Survival Guide: Martian Map</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          {/* Mission Mode Control: Start EVA / End EVA + Reset */}
          {!isEvaActive ? (
            <button
              type="button"
              onClick={handleStartEva}
              className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded bg-[var(--go)] text-black hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start EVA</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleEndEva}
                className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded border border-[var(--warn)]/70 bg-[var(--warn)]/15 text-[var(--warn)] hover:bg-[var(--warn)]/25 transition-colors cursor-pointer"
              >
                <Square className="w-3 h-3" />
                <span>End EVA</span>
              </button>
              <button
                type="button"
                onClick={handleResetDefaults}
                className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded border border-[var(--line)] bg-[var(--panel-2)] text-[var(--fg-dim)] hover:text-[var(--fg)] cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>
          )}

          {/* Dataset Switcher */}
          <div className="flex items-center rounded border border-[var(--line)] bg-[var(--panel-2)] p-0.5 text-xs">
            <button
              type="button"
              disabled={isEvaActive}
              onClick={() => handleSwitchTerrain('sample')}
              className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                state.terrainId === 'sample'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-bold shadow-xs'
                  : 'text-[var(--fg-dim)] hover:text-[var(--fg)]'
              }`}
              title="Synthetic calibration patch with crater, delta and dunes"
            >
              Sample Patch
            </button>
            <button
              type="button"
              disabled={isEvaActive}
              onClick={() => handleSwitchTerrain('jezero')}
              className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                state.terrainId === 'jezero'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-bold shadow-xs'
                  : 'text-[var(--fg-dim)] hover:text-[var(--fg)]'
              }`}
              title="Jezero Crater Western Fan &amp; Landing Site calibrated model"
            >
              Jezero Crater
            </button>
          </div>

          {/* Sample Terrain Disclaimer Badge */}
          {state.terrainId === 'sample' && (
            <span
              className="hidden lg:inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider px-2 py-1 rounded border border-[var(--warn)]/60 bg-[var(--warn)]/15 text-[var(--warn)] font-medium"
              title="Synthetic calibration patch. Replace with HiRISE DTM and real Mars rasters for flight operations."
            >
              Sample terrain, not real Mars data
            </span>
          )}

          {/* Dark / Light Theme Toggle */}
          <button
            type="button"
            onClick={handleToggleTheme}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded border border-[var(--line)] bg-[var(--panel-2)] hover:border-[var(--accent)] transition-colors cursor-pointer"
            aria-label={`Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {state.theme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Light</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-cyan-600" />
                <span className="hidden sm:inline">Dark</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Core Question Banner */}
      <div className="no-print bg-[var(--panel-2)] border-b border-[var(--line)] px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-bold text-[var(--accent)] uppercase tracking-wider bg-[var(--accent)]/10 px-1.5 py-0.5 rounded border border-[var(--accent)]/20">
            Core Question
          </span>
          <span className="text-[var(--fg)] font-medium">
            &ldquo;From the habitat, where can I go and still get back before my oxygen, suit power or daylight run out?&rdquo;
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[var(--fg-dim)] font-mono">
          <span>
            Active Limiter:{' '}
            <b className="text-[var(--accent)]">
              {evaTelemetry ? evaTelemetry.remLimName : results.limName}
            </b>
          </span>
          <span>
            Mode:{' '}
            <b className="uppercase text-[var(--fg)]">
              {isEvaActive ? 'LIVE EVA' : 'PLANNING'}
            </b>
          </span>
          <span>
            Click Sets: <b className="uppercase text-[var(--fg)]">{state.clickMode}</b>
          </span>
        </div>
      </div>

      {/* Main 3-Column Tactical Layout (Mobile: Map -> Results -> Inputs) */}
      <main className="flex-1 p-3 grid grid-cols-1 lg:grid-cols-[285px_minmax(0,1fr)_360px] gap-3 items-start max-w-[1920px] mx-auto w-full">
        {/* Left Column: Mission Limits & Consumables (Desktop col 1, Mobile order 3) */}
        <div className="no-print order-3 lg:order-1">
          <MissionLimitsPanel
            params={state.params}
            preset={state.preset}
            missionStatus={state.missionStatus}
            onUpdateParam={handleUpdateParam}
            onSelectPreset={handleSelectPreset}
            clickMode={state.clickMode}
            setClickMode={handleSetClickMode}
            targets={activeTerrain.targets}
            selectedTargetIndex={state.tgtIndex}
            onSelectScienceTarget={handleSelectScienceTarget}
            onResetDefaults={handleResetDefaults}
          />
        </div>

        {/* Center Column: Live EVA Panel, Terrain Raster Map & Astronaut Directions (Desktop col 2, Mobile order 1) */}
        <div className="order-1 lg:order-2 flex flex-col gap-3 min-w-0">
          {isEvaActive && evaTelemetry && (
            <LiveEvaPanel
              telemetry={evaTelemetry}
              params={state.params}
              terrain={activeTerrain}
              eventLog={state.eventLog}
              onEndEva={handleEndEva}
              onResetAll={handleResetDefaults}
              onSetClickHere={() => handleSetClickMode('here')}
              isClickHereMode={state.clickMode === 'here'}
            />
          )}

          <div className="no-print">
            <TerrainMap
              terrain={activeTerrain}
              habIndex={state.habIndex}
              tgtIndex={state.tgtIndex}
              results={results}
              activeLayer={state.activeLayer}
              setActiveLayer={handleSetActiveLayer}
              selectedRouteId={state.selectedRouteId}
              setSelectedRouteId={handleSelectRouteId}
              clickMode={state.clickMode}
              onSetPoint={handleSetPoint}
              onNudgePoint={handleNudgePoint}
              overlays={state.overlays}
              setOverlays={handleSetOverlays}
              maxSlope={state.params.maxSlope}
              comfort={state.params.comfort}
              theme={state.theme}
              turnaroundCellIndex={
                isEvaReturning ? null : directions ? directions.turnaroundCellIndex : null
              }
              isTargetSafe={directions ? directions.isTargetSafe : true}
              walkCellIndex={walkCellIndex}
              walkedPath={isEvaActive ? state.walkedPath : []}
              verification={verification}
            />
          </div>

          <DirectionsPanel
            directions={directions}
            route={activeRoute}
            params={state.params}
            results={results}
            directionMode={state.directionMode}
            setDirectionMode={handleSetDirectionMode}
            walkActive={state.walkActive}
            onToggleWalk={handleToggleWalk}
            walkStepIndex={state.walkStepIndex}
            onChangeWalkStep={handleChangeWalkStep}
            sliderMaxStep={
              isEvaActive ? Math.max(0, state.evaTrackPath.length - 1) : undefined
            }
            sliderValue={isEvaActive ? state.walkStepIndex : undefined}
            evaTrackPath={state.evaTrackPath}
            walkedLegs={walkedLegs}
            isEvaActive={isEvaActive}
            readAloudEnabled={state.readAloudEnabled}
            onToggleReadAloud={handleToggleReadAloud}
            latestAlertText={state.latestAlertText}
          />
        </div>

        {/* Right Column: The Answer / Budget, Routes & Provenance (Desktop col 3, Mobile order 2) */}
        <div className="no-print order-2 lg:order-3">
          <ResultsPanel
            results={results}
            params={state.params}
            terrain={activeTerrain}
            selectedRouteId={state.selectedRouteId}
            setSelectedRouteId={handleSelectRouteId}
            habIndex={state.habIndex}
            tgtIndex={state.tgtIndex}
            verification={verification}
            onUseNearestReachable={handleUseNearestReachable}
            routeSwitchNotice={state.routeSwitchNotice}
            isEvaActive={isEvaActive}
            isReturning={isEvaReturning}
          />
        </div>
      </main>

      {/* Telemetric Status Footer */}
      <footer className="no-print border-t border-[var(--line)] bg-[var(--panel)] px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[var(--fg-dim)] font-mono">
        <div className="flex items-center gap-4">
          <span>
            Grid: {activeTerrain.W} × {activeTerrain.H} cells ({activeTerrain.cellMeters} m resolution ·{' '}
            {((activeTerrain.W * activeTerrain.cellMeters) / 1000).toFixed(1)} ×{' '}
            {((activeTerrain.H * activeTerrain.cellMeters) / 1000).toFixed(1)} km)
          </span>
          <span className="hidden sm:inline">
            Pathfinder: 8-neighbor anisotropic Dijkstra (Float64)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>Walkback EVA Planner · NASA Space Apps Challenge</span>
        </div>
      </footer>
    </div>
  );
}
