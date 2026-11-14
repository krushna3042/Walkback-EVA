/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { EvaLiveTelemetry, EventLogEntry, MissionParams, TerrainDataset } from '../types';
import { formatDuration } from '../engine/directions';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  OctagonAlert,
  RotateCcw,
  Square,
  XCircle
} from 'lucide-react';

interface LiveEvaPanelProps {
  telemetry: EvaLiveTelemetry;
  params: MissionParams;
  terrain: TerrainDataset;
  eventLog: EventLogEntry[];
  onEndEva: () => void;
  onResetAll: () => void;
  onSetClickHere: () => void;
  isClickHereMode: boolean;
}

export const LiveEvaPanel: React.FC<LiveEvaPanelProps> = ({
  telemetry,
  params,
  terrain,
  eventLog,
  onEndEva,
  onResetAll,
  onSetClickHere,
  isClickHereMode
}) => {
  const [logCopyState, setLogCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const { W, cellMeters } = terrain;
  const cx = telemetry.currentCell % W;
  const cy = Math.floor(telemetry.currentCell / W);

  const statusBadge = {
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
  }[telemetry.status];

  const handleCopyLog = () => {
    const text = eventLog
      .map(item => `[${formatDuration(item.elapsedH)}] ${item.event}: ${item.details}`)
      .join('\n');
    if (!navigator.clipboard?.writeText) {
      setLogCopyState('failed');
      setTimeout(() => setLogCopyState('idle'), 2500);
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        setLogCopyState('copied');
        setTimeout(() => setLogCopyState('idle'), 2000);
      },
      () => {
        setLogCopyState('failed');
        setTimeout(() => setLogCopyState('idle'), 2500);
      }
    );
  };

  return (
    <section
      className="no-print bg-[var(--panel)] border-2 border-[var(--accent)] rounded-md p-3.5 flex flex-col gap-3 min-w-0 shadow-sm"
      aria-label="Live EVA Mission Telemetry"
    >
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--line)]">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[var(--accent)]" />
          <h2 className="text-xs font-bold tracking-wider uppercase text-[var(--fg)] m-0">
            Live EVA Mission Active
          </h2>
          <span className={`inline-flex items-center gap-1 font-mono text-[11px] font-bold px-2 py-0.5 rounded border ${statusBadge.cls}`}>
            {statusBadge.icon}
            <span>{statusBadge.label}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onSetClickHere}
            aria-pressed={isClickHereMode}
            className={`px-2.5 py-1 rounded border text-xs font-semibold transition-colors cursor-pointer ${
              isClickHereMode
                ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]'
                : 'bg-[var(--panel-2)] text-[var(--fg)] border-[var(--line)] hover:border-[var(--accent)]'
            }`}
            title="Click anywhere on the map to move the astronaut to that position"
          >
            I am here (map click)
          </button>

          <button
            type="button"
            onClick={onEndEva}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--warn)]/60 bg-[var(--warn)]/10 text-[var(--warn)] text-xs font-semibold hover:bg-[var(--warn)]/20 transition-colors cursor-pointer"
          >
            <Square className="w-3 h-3" />
            <span>End EVA</span>
          </button>

          <button
            type="button"
            onClick={onResetAll}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--line)] bg-[var(--panel-2)] text-[var(--fg-dim)] hover:text-[var(--fg)] text-xs font-medium cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Automatic Turnaround Banner */}
      {telemetry.turnaroundBanner && (
        <div
          role="alert"
          className="p-2.5 rounded border-2 border-[var(--stop)] bg-[var(--stop)]/15 text-[var(--stop)] text-xs font-bold flex items-center gap-2"
        >
          <OctagonAlert className="w-4 h-4 shrink-0" />
          <span>{telemetry.turnaroundBanner}</span>
        </div>
      )}

      {/* Automatic Plain-Text Warning Banners */}
      {telemetry.warnings.length > 0 && (
        <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
          {telemetry.warnings.map((w, i) => (
            <div
              key={i}
              className="px-2.5 py-1.5 rounded border border-[var(--warn)]/60 bg-[var(--warn)]/10 text-[var(--warn)] text-xs font-medium flex items-center gap-2"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Live 10-Metric Telemetry Grid */}
      <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 m-0 text-xs">
        <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2">
          <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">Elapsed</dt>
          <dd className="m-0 font-mono font-bold text-[var(--fg)] tabular-nums">
            {formatDuration(telemetry.elapsedH)}
          </dd>
        </div>

        <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2">
          <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">
            Oxygen Left {telemetry.remLimName === 'Oxygen' ? '(Lim)' : ''}
          </dt>
          <dd className={`m-0 font-mono font-bold tabular-nums ${telemetry.remLimName === 'Oxygen' ? 'text-[var(--accent)]' : 'text-[var(--fg)]'}`}>
            {telemetry.remO2.toFixed(2)} h
          </dd>
        </div>

        <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2">
          <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">
            Power Left {telemetry.remLimName === 'Suit power' ? '(Lim)' : ''}
          </dt>
          <dd className={`m-0 font-mono font-bold tabular-nums ${telemetry.remLimName === 'Suit power' ? 'text-[var(--accent)]' : 'text-[var(--fg)]'}`}>
            {telemetry.remPw.toFixed(2)} h
          </dd>
        </div>

        <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2">
          <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">
            Daylight Left {telemetry.remLimName === 'Daylight' ? '(Lim)' : ''}
          </dt>
          <dd className={`m-0 font-mono font-bold tabular-nums ${telemetry.remLimName === 'Daylight' ? 'text-[var(--accent)]' : 'text-[var(--fg)]'}`}>
            {telemetry.remDay.toFixed(2)} h
          </dd>
        </div>

        <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2">
          <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">Position</dt>
          <dd className="m-0 font-mono font-semibold text-[var(--fg)] tabular-nums">
            {(cx * cellMeters).toLocaleString()}, {(cy * cellMeters).toLocaleString()} m
          </dd>
        </div>

        <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2">
          <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">Slope</dt>
          <dd
            className={`m-0 font-mono font-bold tabular-nums ${
              telemetry.currentSlopeDeg > params.maxSlope
                ? 'text-[var(--stop)]'
                : telemetry.currentSlopeDeg > params.comfort
                  ? 'text-[var(--warn)]'
                  : 'text-[var(--go)]'
            }`}
          >
            {telemetry.currentSlopeDeg.toFixed(1)}°
          </dd>
        </div>

        <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2">
          <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">Heading</dt>
          <dd className="m-0 font-mono font-semibold text-[var(--fg)] tabular-nums">
            {telemetry.currentDir8} ({telemetry.currentBearingStr}°)
          </dd>
        </div>

        <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2">
          <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">To Destination</dt>
          <dd className="m-0 font-mono font-semibold text-[var(--fg)] tabular-nums">
            {(telemetry.distToDestM / 1000).toFixed(2)} km
          </dd>
        </div>

        <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2">
          <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">Back to Hab</dt>
          <dd className="m-0 font-mono font-semibold text-[var(--fg)] tabular-nums">
            {(telemetry.distBackToHabM / 1000).toFixed(2)} km
          </dd>
        </div>

        <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2">
          <dt className="text-[10px] font-mono uppercase text-[var(--fg-dim)]">Mission Margin</dt>
          <dd
            className={`m-0 font-mono font-bold tabular-nums ${
              (telemetry.autoTurnaround ? telemetry.turnaroundMarginH : telemetry.continueMarginH) >= 0
                ? 'text-[var(--go)]'
                : 'text-[var(--stop)]'
            }`}
          >
            {(() => {
              const m = telemetry.autoTurnaround ? telemetry.turnaroundMarginH : telemetry.continueMarginH;
              return `${m >= 0 ? '+' : ''}${formatDuration(m)}`;
            })()}
          </dd>
        </div>
      </dl>

      {/* Event Log */}
      <div className="border-t border-[var(--line)] pt-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-mono uppercase tracking-wider text-[var(--fg-dim)] m-0 font-semibold">
            EVA Event Log ({eventLog.length})
          </h3>
          <button
            type="button"
            onClick={handleCopyLog}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--fg-dim)] hover:text-[var(--accent)] cursor-pointer"
          >
            {logCopyState === 'copied' ? (
              <Check className="w-3 h-3 text-[var(--go)]" />
            ) : logCopyState === 'failed' ? (
              <AlertTriangle className="w-3 h-3 text-[var(--stop)]" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
            <span className={logCopyState === 'failed' ? 'text-[var(--stop)]' : ''}>
              {logCopyState === 'copied' ? 'Copied' : logCopyState === 'failed' ? 'Copy failed' : 'Copy log'}
            </span>
          </button>
        </div>

        <ul className="m-0 p-0 list-none max-h-28 overflow-y-auto flex flex-col gap-1 font-mono text-[11px]">
          {eventLog.map(entry => (
            <li
              key={entry.id}
              className="px-2 py-1 rounded bg-[var(--panel-2)] border border-[var(--line)]/60 flex flex-wrap gap-x-2"
            >
              <span className="text-[var(--accent)] font-semibold">[{formatDuration(entry.elapsedH)}]</span>
              <span className="font-bold text-[var(--fg)]">{entry.event}:</span>
              <span className="text-[var(--fg-dim)]">{entry.details}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};
