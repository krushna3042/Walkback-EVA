/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { RouteCard, TerrainDataset } from '../types';

interface ElevationProfileProps {
  route: RouteCard | undefined;
  terrain: TerrainDataset;
  comfortSlope: number;
  maxSlope: number;
}

export const ElevationProfile: React.FC<ElevationProfileProps> = ({
  route,
  terrain,
  comfortSlope,
  maxSlope
}) => {
  if (!route || route.path.length < 2) {
    return null;
  }

  const { W, cellMeters, z } = terrain;
  const path = route.path;

  // Compute cumulative distance and elevation profile
  let cumulativeDist = 0;
  const profile: { dist: number; elev: number; slope: number }[] = [
    { dist: 0, elev: z[path[0]], slope: 0 }
  ];

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const isDiag = (a % W !== b % W) && (Math.floor(a / W) !== Math.floor(b / W));
    const stepDist = cellMeters * (isDiag ? Math.SQRT2 : 1.0);
    cumulativeDist += stepDist;
    const slopeDeg = Math.atan(Math.abs(z[b] - z[a]) / stepDist) * (180 / Math.PI);
    profile.push({
      dist: cumulativeDist,
      elev: z[b],
      slope: slopeDeg
    });
  }

  const totalDist = cumulativeDist;
  const elevs = profile.map(p => p.elev);
  const minElev = Math.min(...elevs);
  const maxElev = Math.max(...elevs);
  const elevSpan = Math.max(10, maxElev - minElev);

  const svgWidth = 400;
  const svgHeight = 110;
  const padLeft = 35;
  const padRight = 15;
  const padTop = 15;
  const padBottom = 22;

  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const scaleX = (d: number) => padLeft + (d / totalDist) * plotW;
  const scaleY = (e: number) => padTop + plotH - ((e - minElev) / elevSpan) * plotH;

  // Build SVG path points
  const points = profile.map(p => `${scaleX(p.dist).toFixed(1)},${scaleY(p.elev).toFixed(1)}`).join(' ');
  const areaPoints = `${scaleX(0)},${scaleY(minElev)} ${points} ${scaleX(totalDist)},${scaleY(minElev)}`;

  return (
    <div className="flex flex-col gap-1.5 p-2 rounded bg-[var(--panel-2)] border border-[var(--line)]">
      <div className="flex items-center justify-between text-xs text-[var(--fg-dim)] font-mono">
        <span className="font-semibold uppercase tracking-wider text-[var(--fg)]">
          Traverse Elevation Profile
        </span>
        <span>
          Net relief: {Math.round(maxElev - minElev)} m
        </span>
      </div>

      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-24 block overflow-visible"
        >
          {/* Y-axis gridlines */}
          <line
            x1={padLeft}
            y1={scaleY(minElev)}
            x2={svgWidth - padRight}
            y2={scaleY(minElev)}
            stroke="var(--line)"
            strokeDasharray="2,2"
          />
          <line
            x1={padLeft}
            y1={scaleY(maxElev)}
            x2={svgWidth - padRight}
            y2={scaleY(maxElev)}
            stroke="var(--line)"
            strokeDasharray="2,2"
          />

          {/* Area fill */}
          <polygon
            points={areaPoints}
            fill="var(--accent)"
            opacity={0.15}
          />

          {/* Line profile */}
          <polyline
            points={points}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Y-axis labels */}
          <text
            x={padLeft - 4}
            y={scaleY(maxElev) + 4}
            textAnchor="end"
            fontSize="9"
            fill="var(--fg-dim)"
            fontFamily="var(--font-data)"
          >
            {Math.round(maxElev)}m
          </text>
          <text
            x={padLeft - 4}
            y={scaleY(minElev)}
            textAnchor="end"
            fontSize="9"
            fill="var(--fg-dim)"
            fontFamily="var(--font-data)"
          >
            {Math.round(minElev)}m
          </text>

          {/* X-axis labels */}
          <text
            x={padLeft}
            y={svgHeight - 4}
            textAnchor="start"
            fontSize="9"
            fill="var(--fg-dim)"
            fontFamily="var(--font-data)"
          >
            HAB (0 km)
          </text>
          <text
            x={svgWidth - padRight}
            y={svgHeight - 4}
            textAnchor="end"
            fontSize="9"
            fill="var(--fg-dim)"
            fontFamily="var(--font-data)"
          >
            {(totalDist / 1000).toFixed(2)} km
          </text>
        </svg>
      </div>

      <div className="flex items-center justify-between text-[11px] text-[var(--fg-dim)] font-mono">
        <span>Habitat: {Math.round(profile[0].elev)}m</span>
        <span>Target: {Math.round(profile[profile.length - 1].elev)}m</span>
      </div>
    </div>
  );
};
