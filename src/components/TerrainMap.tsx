/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ClickMode, DestinationVerification, MapLayer, PlannerResults, TerrainDataset } from '../types';
import { Compass } from 'lucide-react';

interface TerrainMapProps {
  terrain: TerrainDataset;
  habIndex: number;
  tgtIndex: number;
  results: PlannerResults;
  activeLayer: MapLayer;
  setActiveLayer: (layer: MapLayer) => void;
  selectedRouteId: 'fast' | 'safe' | 'sci';
  setSelectedRouteId: (id: 'fast' | 'safe' | 'sci') => void;
  clickMode: ClickMode;
  onSetPoint: (index: number) => void;
  onNudgePoint: (dx: number, dy: number) => void;
  overlays: {
    reach: boolean;
    hazards: boolean;
    science: boolean;
    routes: boolean;
  };
  setOverlays: React.Dispatch<React.SetStateAction<{
    reach: boolean;
    hazards: boolean;
    science: boolean;
    routes: boolean;
  }>>;
  maxSlope: number;
  comfort: number;
  theme: 'dark' | 'light';
  turnaroundCellIndex?: number | null;
  isTargetSafe?: boolean;
  walkCellIndex?: number | null;
  walkedPath?: number[];
  verification?: DestinationVerification;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (c: number[], o: number[], a: number) => [
  lerp(c[0], o[0], a),
  lerp(c[1], o[1], a),
  lerp(c[2], o[2], a)
];

const hexStops = (a: string[]) =>
  a.map(h => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16)
  ]);

const ramp = (stops: number[][], t: number) => {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(Math.floor(t), stops.length - 2);
  const f = t - i;
  return [
    lerp(stops[i][0], stops[i + 1][0], f),
    lerp(stops[i][1], stops[i + 1][1], f),
    lerp(stops[i][2], stops[i + 1][2], f)
  ];
};

const ELEV_STOPS = hexStops(['#4a2f26', '#80513a', '#b98253', '#e2c58f', '#f3e6c4']);
const THERM_STOPS = hexStops(['#f3e4b4', '#dd9650', '#9a3f5a', '#2c2358']);
const COL_GO = [74, 143, 109];
const COL_WARN = [207, 162, 63];
const COL_STOP = [196, 71, 61];

// Chaikin corner-cutting algorithm for smooth route curves
function chaikin(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const o: [number, number][] = [pts[0]];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    o.push(
      [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
      [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]
    );
  }
  o.push(pts[pts.length - 1]);
  return o;
}

export const TerrainMap: React.FC<TerrainMapProps> = ({
  terrain,
  habIndex,
  tgtIndex,
  results,
  activeLayer,
  setActiveLayer,
  selectedRouteId,
  setSelectedRouteId,
  clickMode,
  onSetPoint,
  onNudgePoint,
  overlays,
  setOverlays,
  maxSlope,
  comfort,
  theme,
  turnaroundCellIndex = null,
  isTargetSafe = true,
  walkCellIndex = null,
  walkedPath = [],
  verification
}) => {
  const { W, H, cellMeters, z, slopeDeg, ti, unit, units, zmin, zmax, shade, targets } = terrain;
  const N = W * H;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [hoverIndex, setHoverIndex] = useState<number>(tgtIndex);
  const [isHovering, setIsHovering] = useState<boolean>(false);

  // Initialize offscreen canvas once
  useEffect(() => {
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    offscreenCanvasRef.current = off;
  }, [W, H]);

  // Render terrain raster
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const off = offscreenCanvasRef.current;
    if (!canvas || !off) return;

    const octx = off.getContext('2d');
    const ctx = canvas.getContext('2d');
    if (!octx || !ctx) return;

    const img = octx.createImageData(W, H);
    const d = img.data;

    const reachZone = results.reach;
    const hasReach = results.cnt > 0;

    for (let i = 0; i < N; i++) {
      let c: number[];
      const sh = shade[i];

      if (activeLayer === 'elev') {
        c = ramp(ELEV_STOPS, (z[i] - zmin) / (zmax - zmin));
        c = [c[0] * sh, c[1] * sh, c[2] * sh];
      } else if (activeLayer === 'thermal') {
        c = ramp(THERM_STOPS, (ti[i] - 90) / 380);
        const k = 0.85 + 0.15 * sh;
        c = [c[0] * k, c[1] * k, c[2] * k];
      } else if (activeLayer === 'geo') {
        const uIdx = unit[i];
        c = units[uIdx] ? [...units[uIdx].color] : [120, 120, 120];
        const k = 0.78 + 0.22 * sh;
        c = [c[0] * k, c[1] * k, c[2] * k];
      } else {
        // Slope layer
        const dg = slopeDeg[i];
        c = dg > maxSlope ? COL_STOP : dg > comfort ? COL_WARN : COL_GO;
        const k = 0.55 + 0.45 * sh;
        c = [c[0] * k, c[1] * k, c[2] * k];
      }

      // Hazards overlay on non-slope layers
      if (overlays.hazards && activeLayer !== 'slope') {
        const dg = slopeDeg[i];
        if (dg > maxSlope) {
          c = mix(c, COL_STOP, 0.60);
        } else if (dg > comfort) {
          c = mix(c, COL_WARN, 0.35);
        }
      }

      // Reach zone overlay
      if (overlays.reach && hasReach && reachZone[i]) {
        const x = i % W;
        const y = Math.floor(i / W);
        let isEdge = false;
        // Check 4-orthogonal neighbors for edge detection
        if (x === 0 || x === W - 1 || y === 0 || y === H - 1) {
          isEdge = true;
        } else {
          if (!reachZone[i - 1] || !reachZone[i + 1] || !reachZone[i - W] || !reachZone[i + W]) {
            isEdge = true;
          }
        }

        if (isEdge) {
          c = [255, 255, 255]; // Crisp white boundary
        } else {
          c = mix(c, [60, 230, 170], activeLayer === 'slope' ? 0.20 : 0.28);
        }
      } else if (overlays.reach && hasReach && !reachZone[i]) {
        // Outside reach zone: slight dimming for high contrast focus
        c = [c[0] * 0.75, c[1] * 0.75, c[2] * 0.75];
      }

      const o = i * 4;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }

    octx.putImageData(img, 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }, [
    W,
    H,
    N,
    activeLayer,
    overlays.hazards,
    overlays.reach,
    results.reach,
    results.cnt,
    shade,
    z,
    zmin,
    zmax,
    ti,
    unit,
    units,
    slopeDeg,
    maxSlope,
    comfort
  ]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Coordinate conversion helper
  const getCellFromEvent = (e: React.MouseEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const px = clamp((e.clientX - rect.left) / rect.width, 0, 0.9999);
    const py = clamp((e.clientY - rect.top) / rect.height, 0, 0.9999);
    const x = Math.floor(px * W);
    const y = Math.floor(py * H);
    return { x, y, index: y * W + x };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const cell = getCellFromEvent(e);
    if (cell) {
      setHoverIndex(cell.index);
      setIsHovering(true);
    }
  };

  const handlePointerLeave = () => {
    setIsHovering(false);
    setHoverIndex(tgtIndex);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const cell = getCellFromEvent(e);
    if (!cell) return;

    if (clickMode === 'hab' || clickMode === 'here') {
      onSetPoint(cell.index);
    } else {
      // Check if user clicked near an existing science target (within 3 cells)
      const nearbyTarget = targets.find(t => Math.hypot(t.x - cell.x, t.y - cell.y) <= 3.0);
      onSetPoint(nearbyTarget ? nearbyTarget.i : cell.index);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keyMap: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    };
    if (keyMap[e.key]) {
      e.preventDefault();
      const mult = e.shiftKey ? 10 : 3;
      const [dx, dy] = keyMap[e.key];
      onNudgePoint(dx * mult, dy * mult);
    }
  };

  // Coordinates for markers
  const habX = habIndex % W;
  const habY = Math.floor(habIndex / W);
  const tgtX = tgtIndex % W;
  const tgtY = Math.floor(tgtIndex / W);

  const habPctX = ((habX + 0.5) / W) * 100;
  const habPctY = ((habY + 0.5) / H) * 100;
  const tgtPctX = ((tgtX + 0.5) / W) * 100;
  const tgtPctY = ((tgtY + 0.5) / H) * 100;

  // Format hours to string (e.g. 1 h 24 min or 45 min)
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

  // Hover cell telemetry readout
  const displayIdx = isHovering ? hoverIndex : tgtIndex;
  const hx = displayIdx % W;
  const hy = Math.floor(displayIdx / W);
  const outTime = results.out.dist[displayIdx];
  const backTime = results.back.dist[displayIdx];
  const elevRel = Math.round(z[displayIdx] - z[habIndex]);
  const cellSlope = slopeDeg[displayIdx];
  const cellTi = Math.round(ti[displayIdx]);
  const cellUnit = units[unit[displayIdx]]?.name ?? 'Unknown';

  const activeRoute = results.routes.find(r => r.id === selectedRouteId) || results.routes[0];

  let walkStatusText = '';
  if (!isHovering && activeRoute) {
    const rOut = activeRoute.m.tOut;
    const rBack = activeRoute.m.tBack;
    const rMargin = activeRoute.m.margin;
    if (rMargin >= 0) {
      walkStatusText = `Out ${formatTime(rOut)} · Back ${formatTime(rBack)} · Margin +${formatTime(rMargin)}`;
    } else {
      walkStatusText = `Out ${formatTime(rOut)} · Back ${formatTime(rBack)} · Outside budget by ${formatTime(-rMargin)}`;
    }
  } else if (cellSlope > maxSlope) {
    walkStatusText = 'NO-GO SLOPE: Exceeds hard limit';
  } else if (outTime === Infinity || backTime === Infinity) {
    walkStatusText = 'UNREACHABLE: No traversable path under slope limits';
  } else {
    const roundTrip = outTime + backTime;
    const margin = results.usable - roundTrip;
    if (margin >= 0) {
      walkStatusText = `Out ${formatTime(outTime)} · Back ${formatTime(backTime)} · Margin +${formatTime(margin)}`;
    } else {
      walkStatusText = `Out ${formatTime(outTime)} · Back ${formatTime(backTime)} · Outside budget by ${formatTime(-margin)}`;
    }
  }

  // Generate SVG smoothed polylines for routes
  const routePolylines = results.routes.map(route => {
    if (route.path.length < 2) return null;
    const pts: [number, number][] = route.path.map(c => [(c % W) + 0.5, Math.floor(c / W) + 0.5]);
    const smoothed = chaikin(chaikin(pts));
    const pointsStr = smoothed.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
    const isSelected = route.id === selectedRouteId;

    // Use high-contrast color scheme for routes
    let strokeColor = '#f4f6f5';
    if (route.id === 'fast') strokeColor = theme === 'dark' ? '#ffffff' : '#0f172a';
    if (route.id === 'safe') strokeColor = '#38bdf8';
    if (route.id === 'sci') strokeColor = '#c084fc';

    return (
      <g key={route.id} className="cursor-pointer" onClick={() => setSelectedRouteId(route.id)}>
        {/* Route casing for contrast against terrain */}
        <polyline
          points={pointsStr}
          fill="none"
          stroke="rgba(0,0,0,0.85)"
          strokeWidth={isSelected ? 6 : 4}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={isSelected ? 1.0 : 0.65}
        />
        {/* Main route stroke */}
        <polyline
          points={pointsStr}
          fill="none"
          stroke={strokeColor}
          strokeWidth={isSelected ? 3.5 : 2}
          strokeDasharray={isSelected ? undefined : '5,4'}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={isSelected ? 1.0 : 0.85}
        />
      </g>
    );
  });

  return (
    <section className="bg-[var(--panel)] border border-[var(--line)] rounded-md p-3 flex flex-col gap-3 min-w-0">
      {/* Map toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pb-1 border-b border-[var(--line)]">
        {/* Layer selector tabs */}
        <div className="inline-flex rounded border border-[var(--line)] overflow-hidden" role="group" aria-label="Map layers">
          {(['slope', 'elev', 'thermal', 'geo'] as MapLayer[]).map(layerKey => {
            const labels: Record<MapLayer, string> = {
              slope: 'Slope',
              elev: 'Elevation',
              thermal: 'Thermal',
              geo: 'Geology'
            };
            const active = activeLayer === layerKey;
            return (
              <button
                key={layerKey}
                type="button"
                onClick={() => setActiveLayer(layerKey)}
                aria-pressed={active}
                className={`px-3 py-1.5 text-xs font-semibold tracking-wider uppercase transition-colors ${
                  active
                    ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-bold'
                    : 'bg-transparent text-[var(--fg-dim)] hover:text-[var(--fg)] hover:bg-[var(--panel-2)]'
                }`}
              >
                {labels[layerKey]}
              </button>
            );
          })}
        </div>

        {/* Overlay toggles */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--fg-dim)]">
          <label className="inline-flex items-center gap-1.5 cursor-pointer hover:text-[var(--fg)]">
            <input
              type="checkbox"
              checked={overlays.reach}
              onChange={e => setOverlays(o => ({ ...o, reach: e.target.checked }))}
              className="accent-[var(--accent)] rounded"
            />
            <span className="font-medium">Reach zone</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer hover:text-[var(--fg)]">
            <input
              type="checkbox"
              checked={overlays.hazards}
              onChange={e => setOverlays(o => ({ ...o, hazards: e.target.checked }))}
              className="accent-[var(--accent)] rounded"
            />
            <span className="font-medium">Hazards</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer hover:text-[var(--fg)]">
            <input
              type="checkbox"
              checked={overlays.science}
              onChange={e => setOverlays(o => ({ ...o, science: e.target.checked }))}
              className="accent-[var(--accent)] rounded"
            />
            <span className="font-medium">Science</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer hover:text-[var(--fg)]">
            <input
              type="checkbox"
              checked={overlays.routes}
              onChange={e => setOverlays(o => ({ ...o, routes: e.target.checked }))}
              className="accent-[var(--accent)] rounded"
            />
            <span className="font-medium">Routes</span>
          </label>
        </div>
      </div>

      {/* Main Map Canvas and SVG Overlay Container */}
      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label="Martian Terrain Map. Click to place destination target or habitat. Arrow keys nudge current selection."
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className="relative w-full aspect-[170/120] rounded border border-[var(--line)] bg-[#1a1512] overflow-hidden select-none cursor-crosshair focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      >
        {/* Canvas raster */}
        <canvas
          ref={canvasRef}
          width={850}
          height={600}
          className="block w-full h-full object-fill pointer-events-none"
        />

        {/* SVG Route Paths */}
        {overlays.routes && (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none"
            aria-hidden="true"
          >
            {walkedPath.length >= 2 && (
              <polyline
                points={walkedPath.map(c => `${((c % W) + 0.5).toFixed(2)},${(Math.floor(c / W) + 0.5).toFixed(2)}`).join(' ')}
                fill="none"
                stroke="#94a3b8"
                strokeWidth={3}
                strokeDasharray="2,2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.85}
              />
            )}
            {routePolylines}
          </svg>
        )}

        {/* Markers Overlay */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Science Targets */}
          {overlays.science &&
            targets.map(t => {
              const px = ((t.x + 0.5) / W) * 100;
              const py = ((t.y + 0.5) / H) * 100;
              const isTargetSelected = t.i === tgtIndex;
              return (
                <div
                  key={t.id}
                  style={{ left: `${px}%`, top: `${py}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group pointer-events-auto cursor-pointer"
                  onClick={e => {
                    e.stopPropagation();
                    onSetPoint(t.i);
                  }}
                  title={`${t.id}: ${t.name} (${t.kind}) — Priority ${(t.val * 100).toFixed(0)}%`}
                >
                  <span className="absolute bottom-[calc(100%+3px)] font-mono text-[10px] font-semibold text-white bg-black/75 px-1 rounded shadow-md whitespace-nowrap border border-white/20">
                    {t.id}
                  </span>
                  <div
                    className={`w-2.5 h-2.5 rotate-45 border transition-transform shadow ${
                      isTargetSelected
                        ? 'bg-[var(--accent)] border-white scale-125'
                        : 'bg-[var(--info)] border-white/90 group-hover:scale-125'
                    }`}
                  />
                </div>
              );
            })}

          {/* Habitat (Base) Marker */}
          <div
            style={{ left: `${habPctX}%`, top: `${habPctY}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-10"
          >
            <span className="absolute bottom-[calc(100%+4px)] font-mono text-[10.5px] font-bold text-white bg-black/85 px-1.5 py-0.5 rounded shadow tracking-wider border border-[var(--accent)]">
              HAB
            </span>
            <div className="w-3.5 h-3.5 bg-[var(--accent)] border-2 border-white rounded-sm shadow-[0_0_0_1px_rgba(0,0,0,0.8)]" />
          </div>

          {/* Destination Target Marker */}
          <div
            style={{ left: `${tgtPctX}%`, top: `${tgtPctY}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-20 animate-pulse motion-reduce:animate-none"
          >
            <span className="absolute bottom-[calc(100%+4px)] font-mono text-[10.5px] font-bold text-white bg-black/85 px-1.5 py-0.5 rounded shadow tracking-wider border border-white">
              TARGET
            </span>
            <div className="relative w-5 h-5 rounded-full border-2 border-white shadow-[0_0_0_1px_#000] flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_0_1px_#000]" />
              {/* Crosshair reticle bars */}
              <div className="absolute w-7 h-[1px] bg-white/70" />
              <div className="absolute h-7 w-[1px] bg-white/70" />
            </div>
            {turnaroundCellIndex === tgtIndex && isTargetSafe && (
              <span className="absolute top-[calc(100%+4px)] font-mono text-[9.5px] font-bold text-[#f0c25c] bg-black/85 px-1.5 py-0.5 rounded shadow tracking-wider border border-[#f0c25c] whitespace-nowrap">
                TURN AROUND HERE
              </span>
            )}
          </div>

          {/* Dedicated Turn Around Here (Point of No Return) Marker when target is outside budget */}
          {turnaroundCellIndex !== null && turnaroundCellIndex !== tgtIndex && (
            <div
              style={{
                left: `${(((turnaroundCellIndex % W) + 0.5) / W) * 100}%`,
                top: `${((Math.floor(turnaroundCellIndex / W) + 0.5) / H) * 100}%`
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-25"
            >
              <span className="absolute bottom-[calc(100%+4px)] font-mono text-[10px] font-bold text-black bg-[#ecc94b] px-1.5 py-0.5 rounded shadow tracking-wider border border-black whitespace-nowrap">
                TURN AROUND HERE
              </span>
              <div className="w-4 h-4 bg-[#ecc94b] border-2 border-black rotate-45 shadow-[0_0_0_1px_#fff]" />
            </div>
          )}

          {/* Walk-through EVA Marker */}
          {walkCellIndex !== null && (
            <div
              style={{
                left: `${(((walkCellIndex % W) + 0.5) / W) * 100}%`,
                top: `${((Math.floor(walkCellIndex / W) + 0.5) / H) * 100}%`
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-30"
            >
              <span className="absolute bottom-[calc(100%+5px)] font-mono text-[10px] font-bold text-black bg-[#4dd0e1] px-1.5 py-0.5 rounded shadow tracking-wider border border-white whitespace-nowrap">
                EVA
              </span>
              <div className="w-4 h-4 rounded-full bg-[#4dd0e1] border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.85)]" />
            </div>
          )}
        </div>

        {/* Top badges */}
        <div className="absolute left-2 top-2 bg-black/80 backdrop-blur-xs text-[#f0c25c] border border-[#f0c25c]/60 font-mono text-[10.5px] px-2 py-0.5 rounded shadow tracking-wider uppercase pointer-events-none">
          {terrain.label}
        </div>

        <div className="absolute right-2 top-2 bg-black/75 backdrop-blur-xs text-white font-mono text-[11px] px-2 py-0.5 rounded shadow flex items-center gap-1 pointer-events-none border border-white/20">
          <Compass className="w-3.5 h-3.5 text-[var(--accent)]" />
          <span>N ↑</span>
        </div>

        {/* Scale bar: 1 km = 1000m / (W * 30m = 5100m) ~ 19.6% width */}
        <div className="absolute left-2.5 bottom-2.5 flex flex-col items-start gap-0.5 text-white font-mono text-[10.5px] pointer-events-none drop-shadow">
          <div
            className="h-1.5 border-2 border-white border-t-0 shadow"
            style={{ width: `${((1000 / (W * cellMeters)) * 100).toFixed(1)}%`, minWidth: '40px' }}
          />
          <span className="bg-black/60 px-1 rounded">1.0 km</span>
        </div>
      </div>

      {/* Live Hover / Point Telemetry Readout */}
      <div
        className="bg-[var(--panel-2)] border border-[var(--line)] rounded p-2.5 font-mono text-xs leading-relaxed text-[var(--fg)]"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-1 text-[var(--fg-dim)] border-b border-[var(--line)]/50 pb-1 mb-1">
          <span>
            COORD: <b className="text-[var(--fg)]">X {(hx * cellMeters).toLocaleString()} m, Y {(hy * cellMeters).toLocaleString()} m</b>
          </span>
          <span>
            ELEV: <b className="text-[var(--accent)]">{elevRel >= 0 ? `+${elevRel}` : elevRel} m</b> vs HAB
          </span>
          <span>
            SLOPE: <b className={cellSlope > maxSlope ? 'text-[var(--stop)]' : cellSlope > comfort ? 'text-[var(--warn)]' : 'text-[var(--go)]'}>{cellSlope.toFixed(1)}°</b>
          </span>
          <span>
            TI: <b className="text-[var(--fg)]">{cellTi}</b>
          </span>
          <span className="text-[var(--fg)] font-medium">
            [{cellUnit}]
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-xs tracking-wide">
          <span>{walkStatusText}</span>
          {verification && (
            <span
              className={`font-mono text-[11px] font-bold px-2 py-0.5 rounded border ${
                verification.kind === 'verified'
                  ? 'bg-[var(--go)]/15 text-[var(--go)] border-[var(--go)]/40'
                  : verification.kind === 'tight'
                    ? 'bg-[var(--warn)]/15 text-[var(--warn)] border-[var(--warn)]/40'
                    : 'bg-[var(--stop)]/15 text-[var(--stop)] border-[var(--stop)]/40'
              }`}
            >
              {verification.chipText}
            </span>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--fg-dim)]">
        {activeLayer === 'slope' && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-2.5 rounded-xs" style={{ background: 'rgb(74,143,109)' }} />
              <span>≤ {comfort}° (Comfort)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-2.5 rounded-xs" style={{ background: 'rgb(207,162,63)' }} />
              <span>{comfort}°–{maxSlope}° (Strenuous)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-2.5 rounded-xs" style={{ background: 'rgb(196,71,61)' }} />
              <span>&gt; {maxSlope}° (No-go cliff)</span>
            </span>
          </>
        )}

        {activeLayer === 'elev' && (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-16 h-2.5 rounded-xs border border-white/20"
              style={{ background: 'linear-gradient(90deg, #4a2f26, #b98253, #f3e6c4)' }}
            />
            <span>Relief: {Math.round(zmax - zmin)} m (Low to High)</span>
          </span>
        )}

        {activeLayer === 'thermal' && (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-16 h-2.5 rounded-xs border border-white/20"
              style={{ background: 'linear-gradient(90deg, #f3e4b4, #dd9650, #9a3f5a, #2c2358)' }}
            />
            <span>Fine loose dust (soft, slow) → Solid basalt bedrock (firm)</span>
          </span>
        )}

        {activeLayer === 'geo' &&
          units.map((u, idx) => (
            <span key={idx} className="inline-flex items-center gap-1.5" title={u.desc}>
              <span
                className="w-3 h-2.5 rounded-xs border border-black/30"
                style={{ background: `rgb(${u.color.join(',')})` }}
              />
              <span>{u.name}</span>
            </span>
          ))}

        {overlays.reach && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-2.5 rounded-xs border border-white bg-[#3ce6aa]/60" />
            <span>Reach Zone (Round-trip viable)</span>
          </span>
        )}
      </div>
    </section>
  );
};
