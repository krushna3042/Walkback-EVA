/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  DirectionLeg,
  DirectionMode,
  formatDuration,
  RouteDirections
} from '../engine/directions';
import { MissionParams, PlannerResults, RouteCard } from '../types';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CheckCircle2,
  Compass,
  Copy,
  FlaskConical,
  Footprints,
  OctagonAlert,
  Printer,
  Volume2,
  VolumeX,
  XCircle,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

interface DirectionsPanelProps {
  directions: RouteDirections | null;
  route: RouteCard | undefined;
  params: MissionParams;
  results: PlannerResults;
  directionMode: DirectionMode;
  setDirectionMode: (mode: DirectionMode) => void;
  walkActive: boolean;
  onToggleWalk: () => void;
  walkStepIndex: number;
  onChangeWalkStep: (nextStep: number) => void;
  sliderMaxStep?: number;
  sliderValue?: number;
  evaTrackPath?: number[];
  walkedLegs?: DirectionLeg[];
  isEvaActive?: boolean;
  readAloudEnabled: boolean;
  onToggleReadAloud: () => void;
  latestAlertText?: string | null;
}

export const DirectionsPanel: React.FC<DirectionsPanelProps> = ({
  directions,
  route,
  params,
  results,
  directionMode,
  setDirectionMode,
  walkActive,
  onToggleWalk,
  walkStepIndex,
  onChangeWalkStep,
  sliderMaxStep,
  sliderValue,
  evaTrackPath = [],
  walkedLegs = [],
  isEvaActive = false,
  readAloudEnabled,
  onToggleReadAloud,
  latestAlertText = null
}) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const listRef = useRef<HTMLOListElement | null>(null);
  const lastSpokenRef = useRef<string>('');
  const lastAlertRef = useRef<string | null>(latestAlertText);

  // Detect Web Speech API support safely in browser
  const speechSupported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined';

  // Clamp walk step index whenever path length changes
  const maxStep = directions ? Math.max(0, directions.walkPoints.length - 1) : 0;
  const clampedStep = Math.min(Math.max(0, walkStepIndex), maxStep);
  const currentWalkPoint = directions
    ? directions.walkPoints[isEvaActive ? 0 : clampedStep]
    : undefined;

  const effectiveMaxStep = sliderMaxStep !== undefined ? sliderMaxStep : maxStep;
  const effectiveStep = sliderValue !== undefined
    ? Math.min(Math.max(0, sliderValue), effectiveMaxStep)
    : clampedStep;

  const currentLegNum = currentWalkPoint ? currentWalkPoint.legNum : 1;
  const currentLeg: DirectionLeg | undefined = directions
    ? directions.legs.find(l => l.num === currentLegNum) || directions.legs[0]
    : undefined;

  // Read aloud current leg ONLY when user turned readAloudEnabled on
  useEffect(() => {
    if (!speechSupported) return;
    if (!readAloudEnabled) {
      window.speechSynthesis.cancel();
      lastSpokenRef.current = '';
      return;
    }

    const textToSpeak = currentLeg ? currentLeg.sentence : directions?.summaryText;
    if (textToSpeak && textToSpeak !== lastSpokenRef.current) {
      lastSpokenRef.current = textToSpeak;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.rate = 0.98;
      window.speechSynthesis.speak(utterance);
    }
  }, [speechSupported, readAloudEnabled, currentLeg?.sentence, directions?.summaryText]);

  // Read aloud ONLY genuinely new alerts while readAloudEnabled is on (ignore stale prior alerts)
  useEffect(() => {
    if (!readAloudEnabled) {
      lastAlertRef.current = latestAlertText;
      return;
    }
    if (!speechSupported || !latestAlertText || latestAlertText === lastAlertRef.current) {
      lastAlertRef.current = latestAlertText;
      return;
    }
    lastAlertRef.current = latestAlertText;
    const utterance = new SpeechSynthesisUtterance(`Alert: ${latestAlertText}`);
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  }, [speechSupported, readAloudEnabled, latestAlertText]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (speechSupported) {
        window.speechSynthesis.cancel();
      }
    };
  }, [speechSupported]);

  const handleSelectLeg = (leg: DirectionLeg) => {
    if (isEvaActive) {
      if (leg.startPathIdx <= 0 || evaTrackPath.length === 0) {
        return;
      }
      const alignedIdx = effectiveStep + leg.startPathIdx;
      let targetIdx = -1;
      if (alignedIdx < evaTrackPath.length && evaTrackPath[alignedIdx] === leg.startCell) {
        targetIdx = alignedIdx;
      } else {
        targetIdx = evaTrackPath.indexOf(leg.startCell, effectiveStep + 1);
      }
      if (targetIdx <= effectiveStep) {
        return;
      }
      if (!walkActive) {
        onToggleWalk();
      }
      onChangeWalkStep(targetIdx);
      return;
    }

    if (!walkActive) {
      onToggleWalk();
    }
    onChangeWalkStep(leg.startPathIdx);
  };

  const handleCopyDirections = () => {
    if (!directions || !route) return;

    const lines: string[] = [
      `WALKBACK ASTRONAUT DIRECTIONS — ${directions.routeName.toUpperCase()} ROUTE (${directions.mode.toUpperCase()})`,
      `Status: ${route.status.toUpperCase()} | Limiting Resource: ${directions.limName} | Usable Budget: ${formatDuration(results.usable)}`,
      `Total Distance: ${(directions.totalDistM / 1000).toFixed(2)} km | Outbound: ${formatDuration(route.m.tOut)} | Return: ${formatDuration(route.m.tBack)}`,
      directions.summaryText,
      ''
    ];

    if (!directions.isTargetSafe && directions.mode === 'outbound' && directions.turnaroundPathIdx === 0) {
      lines.push(
        `>> TURN AROUND HERE (At habitat, 0 m): Budget exhausted before departure.`
      );
      lines.push('');
    }

    directions.legs.forEach(leg => {
      lines.push(leg.sentence);
      if (leg.overComfort) {
        lines.push(
          `   [HAZARD] Steep slope: ${leg.strenuousSteps} step(s) up to ${leg.maxSlopeDeg.toFixed(1)}° (exceeds ${params.comfort}° comfort limit).`
        );
      }
      if (leg.crossesSoft) {
        lines.push(
          `   [HAZARD] Soft ground: ${Math.round(leg.softDistM)} m over low-thermal-inertia soil (up to 45% pace slowdown).`
        );
      }
      leg.scienceCallouts.forEach(sc => {
        lines.push(
          `   [SCIENCE] ${sc.target.id} — ${sc.target.name} (${Math.round(sc.distanceM)} m off route, priority ${(sc.target.val * 100).toFixed(0)}%).`
        );
      });
      if (!directions.isTargetSafe && leg.containsTurnaround && !(directions.mode === 'outbound' && directions.turnaroundPathIdx === 0)) {
        lines.push(
          `   >> TURN AROUND HERE (Point of No Return): ${Math.round(directions.turnaroundDistFromHabM)} m from habitat (${formatDuration(directions.turnaroundOutTimeH)} out, ${formatDuration(directions.turnaroundBackTimeH)} back).`
        );
      }
    });

    if (directions.isTargetSafe && directions.mode === 'outbound') {
      lines.push('');
      lines.push(
        `>> TURN AROUND AT TARGET: ${directions.summaryText}.`
      );
    }

    lines.push('');
    lines.push('Note: Sample terrain, not real Mars data. Directions are derived from elevation grid and assumed pace.');

    if (!navigator.clipboard?.writeText) {
      setCopyState('failed');
      setTimeout(() => setCopyState('idle'), 2500);
      return;
    }

    navigator.clipboard.writeText(lines.join('\n')).then(
      () => {
        setCopyState('copied');
        setTimeout(() => setCopyState('idle'), 2000);
      },
      () => {
        setCopyState('failed');
        setTimeout(() => setCopyState('idle'), 2500);
      }
    );
  };

  const handlePrint = () => {
    window.print();
  };

  const renderStatusPill = (status: 'go' | 'tight' | 'nogo') => {
    const cfg = {
      go: {
        label: 'GO',
        cls: 'bg-[var(--go)]/15 text-[var(--go)] border-[var(--go)]/40',
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-[var(--go)]" />
      },
      tight: {
        label: 'TIGHT',
        cls: 'bg-[var(--warn)]/15 text-[var(--warn)] border-[var(--warn)]/40',
        icon: <AlertTriangle className="w-3.5 h-3.5 text-[var(--warn)]" />
      },
      nogo: {
        label: 'NO-GO',
        cls: 'bg-[var(--stop)]/15 text-[var(--stop)] border-[var(--stop)]/40',
        icon: <XCircle className="w-3.5 h-3.5 text-[var(--stop)]" />
      }
    }[status];

    return (
      <span className={`inline-flex items-center gap-1 font-mono text-[11px] font-bold px-2 py-0.5 rounded border ${cfg.cls}`}>
        {cfg.icon}
        <span>{cfg.label}</span>
      </span>
    );
  };

  return (
    <section
      className="print-directions-panel bg-[var(--panel)] border border-[var(--line)] rounded-md p-3.5 flex flex-col gap-3 min-w-0"
      aria-label="Astronaut directions"
    >
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--line)]">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-[var(--accent)]" />
          <h2 className="text-xs font-semibold tracking-wider text-[var(--fg)] uppercase m-0">
            Astronaut directions
          </h2>
          {directions && route && (
            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[var(--panel-2)] border border-[var(--line)] text-[var(--fg-dim)]">
              {directions.routeName} · {directions.legs.length} {directions.legs.length === 1 ? 'leg' : 'legs'}
            </span>
          )}
        </div>

        {directions && route && (
          <div className="no-print flex flex-wrap items-center gap-1.5">
            {/* Outbound / Return Toggle */}
            <div className="inline-flex rounded border border-[var(--line)] overflow-hidden" role="group" aria-label="Direction leg mode">
              <button
                type="button"
                onClick={() => {
                  setDirectionMode('outbound');
                  onChangeWalkStep(0);
                }}
                aria-pressed={directionMode === 'outbound'}
                className={`px-2.5 py-1 text-xs font-semibold tracking-wide transition-colors cursor-pointer ${
                  directionMode === 'outbound'
                    ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                    : 'bg-transparent text-[var(--fg-dim)] hover:text-[var(--fg)] hover:bg-[var(--panel-2)]'
                }`}
              >
                Outbound
              </button>
              <button
                type="button"
                onClick={() => {
                  setDirectionMode('return');
                  onChangeWalkStep(0);
                }}
                aria-pressed={directionMode === 'return'}
                className={`px-2.5 py-1 text-xs font-semibold tracking-wide transition-colors border-l border-[var(--line)] cursor-pointer ${
                  directionMode === 'return'
                    ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                    : 'bg-transparent text-[var(--fg-dim)] hover:text-[var(--fg)] hover:bg-[var(--panel-2)]'
                }`}
              >
                Return
              </button>
            </div>

            {/* Walk it toggle */}
            <button
              type="button"
              onClick={onToggleWalk}
              aria-pressed={walkActive}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-semibold transition-colors cursor-pointer ${
                walkActive
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]'
                  : 'bg-[var(--panel-2)] text-[var(--fg)] border-[var(--line)] hover:border-[var(--accent)]'
              }`}
            >
              <Footprints className="w-3.5 h-3.5" />
              <span>Walk it</span>
            </button>

            {/* Optional Read Aloud toggle (hidden if speechSynthesis is unavailable) */}
            {speechSupported && (
              <button
                type="button"
                onClick={onToggleReadAloud}
                aria-pressed={readAloudEnabled}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-medium transition-colors cursor-pointer ${
                  readAloudEnabled
                    ? 'bg-[var(--info)]/20 text-[var(--info)] border-[var(--info)]'
                    : 'bg-[var(--panel-2)] text-[var(--fg-dim)] border-[var(--line)] hover:text-[var(--fg)] hover:border-[var(--accent)]'
                }`}
                title="Toggle read aloud for current leg and new alerts"
              >
                {readAloudEnabled ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                <span>{readAloudEnabled ? 'Audio on' : 'Read aloud'}</span>
              </button>
            )}

            {/* Copy Directions */}
            <button
              type="button"
              onClick={handleCopyDirections}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--line)] bg-[var(--panel-2)] text-xs font-medium text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--accent)] transition-colors cursor-pointer"
              title="Copy step-by-step directions as plain text"
            >
              {copyState === 'copied' ? (
                <Check className="w-3.5 h-3.5 text-[var(--go)]" />
              ) : copyState === 'failed' ? (
                <AlertTriangle className="w-3.5 h-3.5 text-[var(--stop)]" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span className={copyState === 'failed' ? 'text-[var(--stop)]' : ''}>
                {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy directions'}
              </span>
            </button>

            {/* Print */}
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--line)] bg-[var(--panel-2)] text-xs font-medium text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--accent)] transition-colors cursor-pointer"
              title="Print directions"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
          </div>
        )}
      </div>

      {!directions || !route ? (
        <p className="text-xs text-[var(--fg-dim)] italic m-0 py-2">
          Place the target on reachable terrain to generate step-by-step astronaut directions.
        </p>
      ) : (
        <>
          {/* Print-only header context */}
          <div className="hidden print:block text-xs border-b border-black pb-2 mb-1 font-mono">
            <strong>WALKBACK ASTRONAUT DIRECTIONS — {directions.routeName.toUpperCase()} ({directionMode.toUpperCase()})</strong>
            <div>
              Status: {route.status.toUpperCase()} | Limiting Resource: {directions.limName} | Usable Budget: {formatDuration(results.usable)}
            </div>
          </div>

          {/* Turnaround / Safe Range Cue Banner */}
          <div
            className={`p-2.5 rounded border flex flex-wrap items-center justify-between gap-2 text-xs ${
              directions.isTargetSafe
                ? 'border-[var(--go)]/50 bg-[var(--go)]/10 text-[var(--fg)]'
                : 'border-[var(--stop)]/60 bg-[var(--stop)]/10 text-[var(--fg)]'
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              {directions.isTargetSafe ? (
                <CheckCircle2 className="w-4 h-4 text-[var(--go)] shrink-0" />
              ) : (
                <OctagonAlert className="w-4 h-4 text-[var(--stop)] shrink-0" />
              )}
              <span>{directions.summaryText}.</span>
            </div>

            <div className="flex items-center gap-3 font-mono text-[11px] text-[var(--fg-dim)]">
              <span>
                Out: <b className="text-[var(--fg)]">{formatDuration(route.m.tOut)}</b>
              </span>
              <ArrowLeftRight className="w-3 h-3" />
              <span>
                Back: <b className="text-[var(--fg)]">{formatDuration(route.m.tBack)}</b>
              </span>
              {!directions.isTargetSafe && (
                <span className="text-[var(--warn)] font-semibold">
                  Turn around at {Math.round(directions.turnaroundDistFromHabM)} m
                </span>
              )}
            </div>
          </div>

          {/* Walk-through Mode Interactive Slider & Live Telemetry */}
          {walkActive && currentWalkPoint && (
            <div className="no-print bg-[var(--panel-2)] border border-[var(--accent)]/60 rounded p-3 flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">
                    Walk-through Mode · Leg {currentWalkPoint.legNum}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--fg-dim)]">
                    Step {effectiveStep} / {effectiveMaxStep}
                  </span>
                </div>
                {renderStatusPill(currentWalkPoint.status)}
              </div>

              {/* Manual Slider + Prev/Next Buttons (No auto-animation, respects prefers-reduced-motion) */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChangeWalkStep(Math.max(0, effectiveStep - 1))}
                  disabled={effectiveStep <= 0}
                  className="p-1 rounded border border-[var(--line)] bg-[var(--panel)] text-[var(--fg)] disabled:opacity-40 hover:border-[var(--accent)] cursor-pointer"
                  aria-label="Previous route step"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <input
                  type="range"
                  min={0}
                  max={effectiveMaxStep}
                  step={1}
                  value={effectiveStep}
                  onChange={e => onChangeWalkStep(parseInt(e.target.value, 10))}
                  aria-label="Move astronaut marker along route"
                  className="flex-1 accent-[var(--accent)] cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => onChangeWalkStep(Math.min(effectiveMaxStep, effectiveStep + 1))}
                  disabled={effectiveStep >= effectiveMaxStep}
                  className="p-1 rounded border border-[var(--line)] bg-[var(--panel)] text-[var(--fg)] disabled:opacity-40 hover:border-[var(--accent)] cursor-pointer"
                  aria-label="Next route step"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Live Readout Telemetry */}
              <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 m-0 text-xs" aria-live="polite">
                <div className="bg-[var(--panel)] border border-[var(--line)] rounded p-1.5">
                  <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">
                    {directionMode === 'outbound' ? 'Elapsed' : 'Return Elapsed'}
                  </dt>
                  <dd className="m-0 font-mono font-semibold text-[var(--fg)] tabular-nums">
                    {formatDuration(currentWalkPoint.elapsedH)}
                  </dd>
                </div>

                <div className="bg-[var(--panel)] border border-[var(--line)] rounded p-1.5">
                  <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">
                    Budget Left
                  </dt>
                  <dd
                    className={`m-0 font-mono font-semibold tabular-nums ${
                      currentWalkPoint.budgetLeftH >= 0 ? 'text-[var(--accent)]' : 'text-[var(--stop)]'
                    }`}
                  >
                    {currentWalkPoint.budgetLeftH >= 0
                      ? formatDuration(currentWalkPoint.budgetLeftH)
                      : `-${formatDuration(-currentWalkPoint.budgetLeftH)}`}
                  </dd>
                </div>

                <div className="bg-[var(--panel)] border border-[var(--line)] rounded p-1.5">
                  <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">
                    Current Slope
                  </dt>
                  <dd
                    className={`m-0 font-mono font-semibold tabular-nums ${
                      currentWalkPoint.slopeDeg > params.maxSlope
                        ? 'text-[var(--stop)]'
                        : currentWalkPoint.slopeDeg > params.comfort
                          ? 'text-[var(--warn)]'
                          : 'text-[var(--go)]'
                    }`}
                  >
                    {currentWalkPoint.slopeDeg.toFixed(1)}°
                  </dd>
                </div>

                <div className="bg-[var(--panel)] border border-[var(--line)] rounded p-1.5">
                  <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">
                    Heading
                  </dt>
                  <dd className="m-0 font-mono font-semibold text-[var(--fg)] tabular-nums">
                    {currentWalkPoint.dir8} ({currentWalkPoint.bearingStr}°)
                  </dd>
                </div>

                <div className="bg-[var(--panel)] border border-[var(--line)] rounded p-1.5">
                  <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">
                    To Target
                  </dt>
                  <dd className="m-0 font-mono font-semibold text-[var(--fg)] tabular-nums">
                    {(currentWalkPoint.distToTargetM / 1000).toFixed(2)} km
                  </dd>
                </div>

                <div className="bg-[var(--panel)] border border-[var(--line)] rounded p-1.5">
                  <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">
                    Back to Hab
                  </dt>
                  <dd className="m-0 font-mono font-semibold text-[var(--fg)] tabular-nums">
                    {(currentWalkPoint.distBackToHabM / 1000).toFixed(2)} km
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {/* Step-by-Step Direction Legs List (scroll position preserved via stable ref & keys) */}
          <ol
            ref={listRef}
            className="print-directions-list flex flex-col gap-2 m-0 p-0 list-none max-h-[420px] overflow-y-auto pr-1"
          >
            {/* Completed ("Done") legs walked during active EVA */}
            {isEvaActive && walkedLegs.length > 0 && walkedLegs.map(wLeg => (
              <li
                key={`done-${wLeg.num}`}
                className="p-2 rounded border border-[var(--line)]/60 bg-[var(--panel-2)]/50 opacity-75 flex flex-col gap-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-[var(--go)]/15 text-[var(--go)] border border-[var(--go)]/40 font-bold text-[10px] uppercase">
                      Done
                    </span>
                    <span className="font-semibold text-[var(--fg)]">
                      Leg {wLeg.num} · {wLeg.dir8} ({wLeg.bearingStr}°)
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-[var(--fg-dim)]">
                    {Math.round(wLeg.distM)} m · {formatDuration(wLeg.legTimeH)}
                  </span>
                </div>
                <p className="m-0 text-[11.5px] text-[var(--fg-dim)]">{wLeg.sentence}</p>
              </li>
            ))}

            {/* Zero-length route notice (e.g. destination equals habitat or arrived) */}
            {directions.legs.length === 0 && (
              <li className="p-2.5 rounded border border-[var(--line)] bg-[var(--panel-2)] text-xs font-mono text-[var(--fg)]">
                Destination is at current origin (0 m walk). {directions.summaryText}.
              </li>
            )}

            {/* Turnaround at Habitat edge case (if budget == 0) */}
            {!directions.isTargetSafe && directionMode === 'outbound' && directions.turnaroundPathIdx === 0 && (
              <li className="p-2.5 rounded border border-[var(--warn)] bg-[var(--warn)]/15 text-xs flex items-center gap-2 font-mono font-semibold text-[var(--warn)]">
                <OctagonAlert className="w-4 h-4 shrink-0" />
                <span>
                  TURN AROUND HERE (At Habitat): Usable walking budget is insufficient to depart and return safely.
                </span>
              </li>
            )}

            {directions.legs.map(leg => {
              const isCurrent = (walkActive || isEvaActive) && currentLegNum === leg.num;
              const isWalkedInPreview = walkActive && !isEvaActive && leg.num < currentLegNum;
              return (
                <React.Fragment key={`${directionMode}-${leg.num}`}>
                  <li>
                    <button
                      type="button"
                      onClick={() => handleSelectLeg(leg)}
                      className={`w-full text-left p-2.5 rounded border transition-colors cursor-pointer flex flex-col gap-1.5 ${
                        isCurrent
                          ? 'bg-[var(--panel-2)] border-[var(--accent)] ring-1 ring-[var(--accent)]'
                          : isWalkedInPreview
                            ? 'bg-[var(--panel-2)]/60 border-[var(--line)]/60 opacity-75'
                            : 'bg-[var(--panel-2)] border-[var(--line)] hover:border-[var(--line-bright)]'
                      }`}
                    >
                      {/* Leg header badges */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-[var(--panel)] border border-[var(--line)] text-[var(--accent)]">
                            LEG {leg.num}
                          </span>
                          <span className="font-mono text-xs font-semibold text-[var(--fg)]">
                            {leg.dir8} ({leg.bearingStr}°)
                          </span>
                          <span className="font-mono text-xs text-[var(--fg-dim)]">
                            {Math.round(leg.distM)} m · {formatDuration(leg.legTimeH)}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 font-mono text-[10.5px]">
                          {isCurrent && (
                            <span className="px-1.5 py-0.5 rounded bg-[var(--accent)] text-[var(--accent-ink)] font-bold uppercase">
                              Current
                            </span>
                          )}
                          <span
                            className={`px-1.5 py-0.5 rounded border ${
                              leg.overComfort
                                ? 'border-[var(--warn)]/50 text-[var(--warn)] bg-[var(--warn)]/10'
                                : 'border-[var(--line)] text-[var(--fg-dim)]'
                            }`}
                          >
                            Avg {leg.avgSlopeDeg.toFixed(1)}° / Max {leg.maxSlopeDeg.toFixed(1)}°
                          </span>
                          {leg.crossesSoft && (
                            <span className="px-1.5 py-0.5 rounded border border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[var(--warn)]">
                              Soft ground
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Plain-English instruction sentence */}
                      <p className="m-0 text-xs text-[var(--fg)] leading-relaxed">
                        {leg.sentence}
                      </p>

                      {/* Inline Hazard & Science Callouts */}
                      {(leg.overComfort || leg.crossesSoft || leg.scienceCallouts.length > 0) && (
                        <div className="flex flex-col gap-1 mt-0.5 pt-1.5 border-t border-[var(--line)]/60">
                          {leg.overComfort && (
                            <div className="flex items-start gap-1.5 text-[11.5px] text-[var(--warn)]">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>
                                <b>Slope hazard:</b> {leg.strenuousSteps} {leg.strenuousSteps === 1 ? 'step' : 'steps'} up to {leg.maxSlopeDeg.toFixed(1)}° (exceeds {params.comfort}° comfort limit).
                              </span>
                            </div>
                          )}

                          {leg.crossesSoft && (
                            <div className="flex items-start gap-1.5 text-[11.5px] text-[var(--warn)]">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>
                                <b>Soft ground:</b> {Math.round(leg.softDistM)} m over low-thermal-inertia regolith (up to 45% walking slowdown).
                              </span>
                            </div>
                          )}

                          {leg.scienceCallouts.map(sc => (
                            <div
                              key={sc.target.id}
                              className="flex items-start gap-1.5 text-[11.5px] text-[var(--info)]"
                            >
                              <FlaskConical className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>
                                <b>Science target ({sc.target.id}):</b> {sc.target.name} ({Math.round(sc.distanceM)} m from route, priority {(sc.target.val * 100).toFixed(0)}%).
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </button>
                  </li>

                  {/* Turnaround Point of No Return Line */}
                  {!directions.isTargetSafe &&
                    leg.containsTurnaround &&
                    !(directionMode === 'outbound' && directions.turnaroundPathIdx === 0) && (
                      <li className="p-2.5 rounded border-2 border-[var(--warn)] bg-[var(--warn)]/15 text-xs flex items-start gap-2 font-mono text-[var(--fg)]">
                        <OctagonAlert className="w-4 h-4 text-[var(--warn)] shrink-0 mt-0.5" />
                        <div>
                          <b className="text-[var(--warn)] uppercase tracking-wider">
                            Turn around here (Point of No Return)
                          </b>
                          <div className="text-[11px] text-[var(--fg-dim)] mt-0.5">
                            Last point with ≥ 0 min return margin: {Math.round(directions.turnaroundDistFromHabM)} m from habitat ({formatDuration(directions.turnaroundOutTimeH)} out, {formatDuration(directions.turnaroundBackTimeH)} back).
                          </div>
                        </div>
                      </li>
                    )}
                </React.Fragment>
              );
            })}

            {/* Turnaround at Target when reachable */}
            {directions.isTargetSafe && directionMode === 'outbound' && (
              <li className="p-2 rounded border border-[var(--go)]/40 bg-[var(--go)]/10 text-xs flex items-center gap-2 font-mono text-[var(--fg)]">
                <CheckCircle2 className="w-4 h-4 text-[var(--go)] shrink-0" />
                <span>
                  <b>Turn around here (Target reached):</b> {directions.summaryText}.
                </span>
              </li>
            )}
          </ol>
        </>
      )}
    </section>
  );
};
