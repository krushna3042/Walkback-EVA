/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DestinationVerification, MissionParams, PlannerResults, TerrainDataset } from '../types';
import { pathsEqual } from '../engine/dijkstra';
import { ElevationProfile } from './ElevationProfile';
import { AlertTriangle, CheckCircle2, XCircle, Info, Copy, Check, ArrowRight } from 'lucide-react';

interface ResultsPanelProps {
  results: PlannerResults;
  params: MissionParams;
  terrain: TerrainDataset;
  selectedRouteId: 'fast' | 'safe' | 'sci';
  setSelectedRouteId: (id: 'fast' | 'safe' | 'sci') => void;
  habIndex: number;
  tgtIndex: number;
  verification: DestinationVerification;
  onUseNearestReachable: (cellIndex: number) => void;
  routeSwitchNotice: string | null;
  isEvaActive?: boolean;
  isReturning?: boolean;
}

export const ResultsPanel: React.FC<ResultsPanelProps> = ({
  results,
  params,
  terrain,
  selectedRouteId,
  setSelectedRouteId,
  habIndex,
  tgtIndex,
  verification,
  onUseNearestReachable,
  routeSwitchNotice,
  isEvaActive = false,
  isReturning = false
}) => {
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');

  const { W, cellMeters } = terrain;
  const hx = habIndex % W;
  const hy = Math.floor(habIndex / W);
  const tx = tgtIndex % W;
  const ty = Math.floor(tgtIndex / W);
  const straightLineDistanceMeters = Math.hypot(tx - hx, ty - hy) * cellMeters;

  // Format time (hours to string)
  const formatTime = (h: number): string => {
    const sign = h < 0 ? '-' : '';
    const totalMin = Math.round(Math.abs(h) * 60);
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hrs > 0) {
      return `${sign}${hrs} h ${String(mins).padStart(2, '0')} min`;
    }
    return `${sign}${mins} min`;
  };

  const formatKm = (m: number): string => {
    return (m / 1000).toFixed(2) + ' km';
  };

  const activeRoute = results.routes.find(r => r.id === selectedRouteId) || results.routes[0];
  const fastestRoute = results.routes.find(r => r.id === 'fast') || results.routes[0];
  const safestRoute = results.routes.find(r => r.id === 'safe') || results.routes[1];

  // Generate briefing text generated strictly from computed numbers only
  const generateBriefing = (): string[] => {
    if (!activeRoute) return [];
    const m = activeRoute.m;
    const bullets: string[] = [];

    // Bullet 1: Outbound & Inbound times and budget consumption
    if (isReturning) {
      bullets.push(
        `${formatKm(m.dist)} return to habitat in ${formatTime(m.tBack)}, using ${formatTime(m.tBack)} of ${formatTime(results.usable)} remaining budget.`
      );
    } else {
      bullets.push(
        `${formatKm(m.dist)} outbound in ${formatTime(m.tOut)}. ${isEvaActive ? 'Return to habitat' : 'Retracing back'} takes ${formatTime(m.tBack)}, so walking uses ${formatTime(m.tOut + m.tBack)} of ${formatTime(results.usable)} usable.`
      );
    }

    // Bullet 2: Operational margin & target stay
    if (m.margin >= 0) {
      bullets.push(
        isReturning
          ? `Margin upon arrival at habitat: +${formatTime(m.margin)} remaining.`
          : `Margin at habitat: +${formatTime(m.margin)} remaining after ${Math.round(params.stay * 60)} min planned stay at target.`
      );
    } else {
      bullets.push(
        `Over consumables budget by ${formatTime(-m.margin)}. Shorten target stay, select a nearer target, or increase consumable capacity.`
      );
    }

    // Bullet 3: Slope steepness & terrain firmness
    const comfortNote = m.over > 0
      ? `${m.over} steps exceed the ${params.comfort}° comfort limit.`
      : `No steps exceed the ${params.comfort}° comfort limit.`;
    const softNote = m.softM > 0
      ? `${Math.round(m.softM)} m of path traverses soft ground (up to 45% pace reduction).`
      : `Zero soft-ground traversal on this path.`;
    bullets.push(`Steepest step is ${m.maxDeg.toFixed(1)}°. ${comfortNote} ${softNote}`);

    // Bullet 4: Comparative delta against Fastest route
    if (activeRoute.id !== 'fast' && fastestRoute) {
      const distDelta = m.dist - fastestRoute.m.dist;
      const timeDelta = (m.tOut + m.tBack) - (fastestRoute.m.tOut + fastestRoute.m.tBack);
      bullets.push(
        `Comparison vs Fastest: ${Math.abs(Math.round(distDelta))} m ${distDelta >= 0 ? 'longer' : 'shorter'}, ${formatTime(Math.abs(timeDelta))} ${timeDelta >= 0 ? 'more' : 'less'} round-trip, peak slope ${m.maxDeg.toFixed(1)}° vs ${fastestRoute.m.maxDeg.toFixed(1)}°.`
      );
    }

    // Bullet 5: Science target breakdown
    if (activeRoute.id === 'sci') {
      const siteNames = m.hit.map(t => `${t.id} (${t.name})`);
      if (siteNames.length > 0) {
        bullets.push(
          `Passes within 120 m of: ${siteNames.join('; ')}. Science value ${(m.sci * 100).toFixed(0)}%.`
        );
      } else {
        bullets.push('No science targets lie within consumable range along this trajectory.');
      }
      if (safestRoute) {
        const costVsSafe = (m.tOut + m.tBack) - (safestRoute.m.tOut + safestRoute.m.tBack);
        if (Math.abs(costVsSafe) > 0.01) {
          bullets.push(
            `Detour costs ${formatTime(Math.abs(costVsSafe))} ${costVsSafe >= 0 ? 'more' : 'less'} walking time than Safest route.`
          );
        }
      }
    }

    return bullets;
  };

  const briefingBullets = generateBriefing();

  const handleCopyBriefing = () => {
    if (!activeRoute) return;
    const text = [
      `WALKBACK EVA BRIEFING: ${activeRoute.name.toUpperCase()} ROUTE`,
      `Status: ${activeRoute.status.toUpperCase()} | Limiting Consumable: ${results.limName}`,
      `Total Walking Time: ${formatTime(activeRoute.m.tOut + activeRoute.m.tBack)} / Usable: ${formatTime(results.usable)}`,
      `Return Margin: ${activeRoute.m.margin >= 0 ? '+' : ''}${formatTime(activeRoute.m.margin)}`,
      '',
      ...briefingBullets.map(b => `• ${b}`)
    ].join('\n');

    if (!navigator.clipboard?.writeText) {
      setCopyState('failed');
      setTimeout(() => setCopyState('idle'), 2500);
      return;
    }

    navigator.clipboard.writeText(text).then(
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

  const statusPill = (status: 'go' | 'tight' | 'nogo') => {
    const config = {
      go: {
        text: 'GO',
        bg: 'bg-[var(--go)]/15 text-[var(--go)] border-[var(--go)]/40',
        icon: <CheckCircle2 className="w-3 h-3 text-[var(--go)]" />
      },
      tight: {
        text: 'TIGHT',
        bg: 'bg-[var(--warn)]/15 text-[var(--warn)] border-[var(--warn)]/40',
        icon: <AlertTriangle className="w-3 h-3 text-[var(--warn)]" />
      },
      nogo: {
        text: 'NO-GO',
        bg: 'bg-[var(--stop)]/15 text-[var(--stop)] border-[var(--stop)]/40',
        icon: <XCircle className="w-3 h-3 text-[var(--stop)]" />
      }
    }[status];

    return (
      <span className={`inline-flex items-center gap-1 font-mono text-[11px] font-bold px-2 py-0.5 rounded border ${config.bg}`}>
        {config.icon}
        <span>{config.text}</span>
      </span>
    );
  };

  return (
    <aside className="flex flex-col gap-3 min-w-0" aria-label="EVA Plan and Results">
      {/* Round-trip Walking Budget Hero Card */}
      <section className="bg-[var(--panel)] border border-[var(--line)] rounded-md p-3.5 flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wider text-[var(--fg-dim)] uppercase">
          {isEvaActive ? 'Remaining Walking Budget' : 'Round-Trip Walking Budget'}
        </h2>

        <div className="flex items-baseline justify-between gap-2">
          <div className="font-mono text-3xl font-bold tracking-tight text-[var(--fg)] tabular-nums">
            {results.usable > 0 ? formatTime(results.usable) : '0 min'}
          </div>
          <span className="font-mono text-xs px-2 py-0.5 rounded border border-[var(--info)]/40 bg-[var(--info)]/15 text-[var(--info)] uppercase tracking-wider font-semibold">
            {results.limName} Limited
          </span>
        </div>

        <p className="text-xs text-[var(--fg-dim)] leading-relaxed">
          {results.usable > 0 ? (
            <>
              <b>{results.limName}</b> sets the ceiling at <b>{results.lim.toFixed(1)} h</b>. Deducting{' '}
              <b>{params.res}%</b> safety reserve and <b>{Math.round(params.stay * 60)} min</b> at target leaves{' '}
              <b className="text-[var(--accent)]">{formatTime(results.usable)}</b> for walking.
            </>
          ) : (
            <span className="text-[var(--stop)] font-medium">
              Reserve margin and target stay consume 100% of available consumables. Increase consumable limits or shorten stay.
            </span>
          )}
        </p>

        {/* Operational Facts 2x2 Grid */}
        <dl className="grid grid-cols-2 gap-2 mt-1">
          <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2">
            <dt className="text-[10.5px] uppercase font-mono tracking-wider text-[var(--fg-dim)]">
              Reach Zone Area
            </dt>
            <dd className="m-0 font-mono text-sm font-semibold text-[var(--fg)] tabular-nums">
              {results.cnt > 0 ? (results.cnt * cellMeters * cellMeters / 1e6).toFixed(2) + ' km²' : '0 km²'}
            </dd>
          </div>

          <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2">
            <dt className="text-[10.5px] uppercase font-mono tracking-wider text-[var(--fg-dim)]">
              Farthest Point
            </dt>
            <dd className="m-0 font-mono text-sm font-semibold text-[var(--fg)] tabular-nums">
              {results.cnt > 0 ? formatKm(results.far) : '0.00 km'}
            </dd>
          </div>

          <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2">
            <dt className="text-[10.5px] uppercase font-mono tracking-wider text-[var(--fg-dim)]">
              Target Distance
            </dt>
            <dd className="m-0 font-mono text-sm font-semibold text-[var(--fg)] tabular-nums">
              {formatKm(straightLineDistanceMeters)} straight
            </dd>
          </div>

          <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2">
            <dt className="text-[10.5px] uppercase font-mono tracking-wider text-[var(--fg-dim)]">
              Planned Stay
            </dt>
            <dd className="m-0 font-mono text-sm font-semibold text-[var(--fg)] tabular-nums">
              {Math.round(params.stay * 60)} min
            </dd>
          </div>
        </dl>

        {/* Destination Verification Chip & Auto-Fix Suggestions */}
        <div className="mt-1 pt-2 border-t border-[var(--line)]/60 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--fg-dim)]">
              Destination Check
            </span>
            <span
              className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-bold px-2 py-0.5 rounded border ${
                verification.kind === 'verified'
                  ? 'bg-[var(--go)]/15 text-[var(--go)] border-[var(--go)]/40'
                  : verification.kind === 'tight'
                    ? 'bg-[var(--warn)]/15 text-[var(--warn)] border-[var(--warn)]/40'
                    : 'bg-[var(--stop)]/15 text-[var(--stop)] border-[var(--stop)]/40'
              }`}
            >
              {verification.kind === 'verified' ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              ) : verification.kind === 'tight' ? (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <XCircle className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{verification.chipText}</span>
            </span>
          </div>

          {verification.kind !== 'verified' && (
            <div className="p-2 rounded bg-[var(--panel-2)] border border-[var(--line)] text-xs flex flex-col gap-1.5">
              {verification.nearestReachable ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[var(--fg)] font-mono text-[11px]">
                    Nearest reachable point: <b>X {verification.nearestReachable.xMeters.toLocaleString()} m, Y {verification.nearestReachable.yMeters.toLocaleString()} m</b>, margin <b>{Math.round(verification.nearestReachable.marginHours * 60)} min</b>
                  </span>
                  <button
                    type="button"
                    onClick={() => onUseNearestReachable(verification.nearestReachable!.cellIndex)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[var(--accent)] text-[var(--accent-ink)] font-mono text-[11px] font-bold hover:opacity-90 cursor-pointer"
                  >
                    <span>Use this destination</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <span className="text-[11px] font-mono text-[var(--fg-dim)]">
                  No reachable destination under current usable walking budget.
                </span>
              )}

              {verification.singleFixSuggestion && (
                <div className="text-[11px] font-mono text-[var(--warn)]">
                  Single-change fix: <b>{verification.singleFixSuggestion}</b>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Alert banners */}
        {results.routes.length === 0 && (
          <div className="mt-1 p-2.5 rounded border border-[var(--stop)] bg-[var(--stop)]/15 text-[var(--stop)] text-xs font-medium flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Target is unreachable: No connected path exists under the {params.maxSlope}° hard slope limit. Relocate target or adjust terrain limits.
            </span>
          </div>
        )}

        {results.notes.relaxed && (
          <div className="mt-1 p-2.5 rounded border border-[var(--warn)] bg-[var(--warn)]/15 text-[var(--warn)] text-xs font-medium flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              No path stays under {params.comfort}° comfort slope. Safest and Science routes relaxed to the {params.maxSlope}° hard limit.
            </span>
          </div>
        )}
      </section>

      {/* Routes to Target Cards */}
      <section className="bg-[var(--panel)] border border-[var(--line)] rounded-md p-3.5 flex flex-col gap-2.5">
        <div className="flex items-center justify-between pb-1 border-b border-[var(--line)]">
          <h2 className="text-xs font-semibold tracking-wider text-[var(--fg-dim)] uppercase">
            {isEvaActive ? `Live Routes from Current Position (${results.routes.length})` : `Candidate Routes (${results.routes.length})`}
          </h2>
          <span className="text-[11px] font-mono text-[var(--fg-dim)]">
            Click to activate
          </span>
        </div>

        {routeSwitchNotice && (
          <div className="px-2.5 py-1.5 rounded border border-[var(--info)]/50 bg-[var(--info)]/10 text-[var(--info)] text-[11.5px] font-medium">
            {routeSwitchNotice}
          </div>
        )}

        {(() => {
          const fast = results.routes.find(r => r.id === 'fast');
          const safe = results.routes.find(r => r.id === 'safe');
          const sci = results.routes.find(r => r.id === 'sci');
          if (fast && safe && sci) {
            const allSame = pathsEqual(fast.path, safe.path) && pathsEqual(safe.path, sci.path);
            const safeSciSame = pathsEqual(safe.path, sci.path);
            const fastSafeSame = pathsEqual(fast.path, safe.path);
            const msg = allSame
              ? 'Fastest, Safest, and Science use the same path.'
              : safeSciSame
                ? 'Safest and Science use the same path.'
                : fastSafeSame
                  ? 'Fastest and Safest use the same path.'
                  : null;
            if (msg) {
              return (
                <div className="px-2.5 py-1 rounded bg-[var(--panel-2)] border border-[var(--line)] text-[11px] font-mono text-[var(--fg-dim)]">
                  {msg}
                </div>
              );
            }
          }
          return null;
        })()}

        {results.routes.length === 0 ? (
          <p className="text-xs text-[var(--fg-dim)] italic p-2">
            Place the target within the reachable zone to calculate route options.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {results.routes.map(r => {
              const isSelected = r.id === selectedRouteId;
              const m = r.m;
              const routeColor = r.id === 'fast' ? '#f4f6f5' : r.id === 'safe' ? '#38bdf8' : '#c084fc';

              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRouteId(r.id)}
                  aria-pressed={isSelected}
                  className={`w-full text-left p-2.5 rounded border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--panel-2)] border-[var(--accent)] ring-1 ring-[var(--accent)] shadow-sm'
                      : 'bg-[var(--panel-2)] border-[var(--line)] hover:border-[var(--line-bright)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-4 h-2 rounded-xs shadow-xs"
                        style={{ backgroundColor: routeColor }}
                      />
                      <b className="text-sm font-semibold text-[var(--fg)]">{r.name} Route</b>
                    </div>
                    {statusPill(r.status)}
                  </div>

                  <dl className="grid grid-cols-3 gap-2 m-0 text-xs">
                    <div>
                      <dt className="text-[10.5px] uppercase font-mono tracking-wider text-[var(--fg-dim)]">
                        Distance
                      </dt>
                      <dd className="m-0 font-mono font-medium text-[var(--fg)] tabular-nums">
                        {formatKm(m.dist)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10.5px] uppercase font-mono tracking-wider text-[var(--fg-dim)]">
                        Out / Back
                      </dt>
                      <dd className="m-0 font-mono font-medium text-[var(--fg)] tabular-nums">
                        {formatTime(m.tOut)} / {formatTime(m.tBack)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10.5px] uppercase font-mono tracking-wider text-[var(--fg-dim)]">
                        Steepest
                      </dt>
                      <dd className="m-0 font-mono font-medium text-[var(--fg)] tabular-nums">
                        {m.maxDeg.toFixed(0)}°
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10.5px] uppercase font-mono tracking-wider text-[var(--fg-dim)]">
                        Margin
                      </dt>
                      <dd
                        className={`m-0 font-mono font-bold tabular-nums ${
                          m.margin >= 0 ? 'text-[var(--go)]' : 'text-[var(--stop)]'
                        }`}
                      >
                        {m.margin >= 0 ? '+' : ''}{formatTime(m.margin)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10.5px] uppercase font-mono tracking-wider text-[var(--fg-dim)]">
                        Science
                      </dt>
                      <dd className="m-0 font-mono font-medium text-[var(--fg)] tabular-nums">
                        {(m.sci * 100).toFixed(0)}%
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10.5px] uppercase font-mono tracking-wider text-[var(--fg-dim)]">
                        Soft Ground
                      </dt>
                      <dd className="m-0 font-mono font-medium text-[var(--fg)] tabular-nums">
                        {Math.round(m.softM)} m
                      </dd>
                    </div>
                  </dl>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Elevation Profile for Selected Route */}
      {activeRoute && (
        <ElevationProfile
          route={activeRoute}
          terrain={terrain}
          comfortSlope={params.comfort}
          maxSlope={params.maxSlope}
        />
      )}

      {/* Tactical Briefing Panel */}
      <section className="bg-[var(--panel)] border border-[var(--line)] rounded-md p-3.5 flex flex-col gap-2">
        <div className="flex items-center justify-between pb-1 border-b border-[var(--line)]">
          <h2 className="text-xs font-semibold tracking-wider text-[var(--fg-dim)] uppercase">
            {activeRoute ? `${activeRoute.name} Route Briefing` : 'Mission Briefing'}
          </h2>
          {activeRoute && (
            <button
              type="button"
              onClick={handleCopyBriefing}
              className="text-[11px] font-mono text-[var(--fg-dim)] hover:text-[var(--accent)] flex items-center gap-1 cursor-pointer"
              title="Copy tactical briefing to clipboard"
            >
              {copyState === 'copied' ? (
                <Check className="w-3 h-3 text-[var(--go)]" />
              ) : copyState === 'failed' ? (
                <AlertTriangle className="w-3 h-3 text-[var(--stop)]" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              <span className={copyState === 'failed' ? 'text-[var(--stop)]' : ''}>
                {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
              </span>
            </button>
          )}
        </div>

        {briefingBullets.length > 0 ? (
          <ul className="flex flex-col gap-2 pl-4 m-0 text-xs text-[var(--fg)] list-disc leading-relaxed marker:text-[var(--accent)]">
            {briefingBullets.map((bullet, idx) => (
              <li key={idx}>{bullet}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--fg-dim)] italic">
            Select a reachable destination on the map to generate briefing telemetry.
          </p>
        )}
      </section>

      {/* Data Provenance Table */}
      <section className="bg-[var(--panel)] border border-[var(--line)] rounded-md p-3.5 flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wider text-[var(--fg-dim)] uppercase pb-1 border-b border-[var(--line)] flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-[var(--info)]" />
          <span>Where the numbers come from</span>
        </h2>

        <table className="w-full text-xs border-collapse">
          <tbody>
            <tr className="border-b border-[var(--line)]/50">
              <td className="py-1.5 pr-2.5 align-top">
                <span className="font-mono text-[10.5px] uppercase font-bold px-1.5 py-0.5 rounded border border-[var(--info)]/40 bg-[var(--info)]/15 text-[var(--info)]">
                  Derived
                </span>
              </td>
              <td className="py-1.5 text-[var(--fg-dim)] leading-tight">
                Slope per step computed from elevation DTM gradient. Walking travel time computed via anisotropic Tobler cost function calibrated for Martian pressure suit mobility.
              </td>
            </tr>

            <tr className="border-b border-[var(--line)]/50">
              <td className="py-1.5 pr-2.5 align-top">
                <span className="font-mono text-[10.5px] uppercase font-bold px-1.5 py-0.5 rounded border border-[var(--go)]/40 bg-[var(--go)]/15 text-[var(--go)]">
                  Measured
                </span>
              </td>
              <td className="py-1.5 text-[var(--fg-dim)] leading-tight">
                Orbital instruments: THEMIS/TES thermal inertia rasters and CRISM/HiRISE lithological mapping units.
              </td>
            </tr>

            <tr>
              <td className="py-1.5 pr-2.5 align-top">
                <span className="font-mono text-[10.5px] uppercase font-bold px-1.5 py-0.5 rounded border border-[var(--warn)]/40 bg-[var(--warn)]/15 text-[var(--warn)]">
                  Assumed
                </span>
              </td>
              <td className="py-1.5 text-[var(--fg-dim)] leading-tight">
                Astronaut flat walking pace (default 2.5 km/h), soft-ground slip factor (up to 45% slowdown), slope comfort &amp; hard limits, and 20% safety reserve margin.
              </td>
            </tr>
          </tbody>
        </table>

        <p className="text-[11px] text-[var(--fg-dim)] leading-normal mt-1 border-t border-[var(--line)]/50 pt-2 font-mono">
          Return time calculates exact retrace steps: uphill climbs outbound become downhill descents on return, altering metabolic expenditure and transit speed.
        </p>
        <p className="text-[11px] text-[var(--fg-dim)] leading-normal font-mono">
          Directions are derived from the sample elevation grid and assumed pace, and are not for real mission use.
        </p>
      </section>
    </aside>
  );
};
