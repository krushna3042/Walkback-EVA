/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ClickMode, MissionParams, MissionStatus, PresetId, ScienceTarget } from '../types';
import { MISSION_PRESETS } from '../engine/presets';
import {
  BatteryCharging,
  Flame,
  Sun,
  Shield,
  Clock,
  Footprints,
  Mountain,
  Compass,
  RotateCcw,
  Lock
} from 'lucide-react';

interface MissionLimitsPanelProps {
  params: MissionParams;
  preset: PresetId;
  missionStatus: MissionStatus;
  onUpdateParam: (key: keyof MissionParams, val: number) => void;
  onSelectPreset: (presetId: Exclude<PresetId, 'custom'>) => void;
  clickMode: ClickMode;
  setClickMode: (mode: ClickMode) => void;
  targets: ScienceTarget[];
  selectedTargetIndex: number;
  onSelectScienceTarget: (target: ScienceTarget) => void;
  onResetDefaults: () => void;
}

export const MissionLimitsPanel: React.FC<MissionLimitsPanelProps> = ({
  params,
  preset,
  missionStatus,
  onUpdateParam,
  onSelectPreset,
  clickMode,
  setClickMode,
  targets,
  selectedTargetIndex,
  onSelectScienceTarget,
  onResetDefaults
}) => {
  const locked = missionStatus === 'active';

  return (
    <aside className="flex flex-col gap-3 min-w-0" aria-label="Mission Limits and Inputs">
      {/* Suit Consumables & Limits */}
      <section className="bg-[var(--panel)] border border-[var(--line)] rounded-md p-3.5 flex flex-col gap-3">
        <div className="flex items-center justify-between pb-1 border-b border-[var(--line)]">
          <div className="flex items-center gap-1.5">
            <h2 className="text-xs font-semibold tracking-wider text-[var(--fg-dim)] uppercase m-0">
              Suit Consumables (h)
            </h2>
            {locked && (
              <span
                className="inline-flex items-center gap-1 font-mono text-[10px] uppercase px-1.5 py-0.5 rounded border border-[var(--warn)]/60 bg-[var(--warn)]/10 text-[var(--warn)]"
                title="Planning inputs are locked while EVA is active"
              >
                <Lock className="w-2.5 h-2.5" />
                <span>Locked</span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onResetDefaults}
            disabled={locked}
            title={locked ? 'End EVA to reset inputs' : 'Reset to default operational baseline'}
            className="text-[11px] font-mono text-[var(--fg-dim)] hover:text-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        </div>

        {/* Quick Presets + Custom badge */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px] font-mono text-[var(--fg-dim)]">
            <span>Preset profile</span>
            <span
              className={`px-1.5 py-0.5 rounded border text-[10px] uppercase font-semibold ${
                preset === 'custom'
                  ? 'border-[var(--info)]/50 bg-[var(--info)]/10 text-[var(--info)]'
                  : 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
              }`}
            >
              {preset === 'custom' ? 'Custom' : MISSION_PRESETS[preset].label}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-xs font-mono" role="group" aria-label="Mission presets">
            {(['nominal', 'extended', 'contingency'] as const).map(pKey => {
              const pSpec = MISSION_PRESETS[pKey];
              const isSelected = preset === pKey;
              return (
                <button
                  key={pKey}
                  type="button"
                  disabled={locked}
                  aria-pressed={isSelected}
                  onClick={() => onSelectPreset(pKey)}
                  className={`px-2 py-1 rounded border text-center transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    isSelected
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)] font-bold'
                      : pKey === 'contingency'
                        ? 'bg-[var(--panel-2)] border-[var(--line)] hover:border-[var(--warn)] text-[var(--warn)]'
                        : 'bg-[var(--panel-2)] border-[var(--line)] hover:border-[var(--accent)] text-[var(--fg)]'
                  }`}
                >
                  {pSpec.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Oxygen Slider */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="param-o2" className="flex items-center gap-1.5 font-medium">
              <Flame className="w-3.5 h-3.5 text-cyan-400" />
              <span>Oxygen</span>
            </label>
            <output htmlFor="param-o2" className="font-mono tabular-nums text-[var(--accent)] font-semibold">
              {params.o2.toFixed(1)} h
            </output>
          </div>
          <input
            id="param-o2"
            type="range"
            min={1.0}
            max={8.0}
            step={0.1}
            disabled={locked}
            value={params.o2}
            onChange={e => onUpdateParam('o2', parseFloat(e.target.value))}
            className="w-full accent-[var(--accent)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* Suit Power Slider */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="param-pw" className="flex items-center gap-1.5 font-medium">
              <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
              <span>Suit power</span>
            </label>
            <output htmlFor="param-pw" className="font-mono tabular-nums text-[var(--accent)] font-semibold">
              {params.pw.toFixed(1)} h
            </output>
          </div>
          <input
            id="param-pw"
            type="range"
            min={1.0}
            max={8.0}
            step={0.1}
            disabled={locked}
            value={params.pw}
            onChange={e => onUpdateParam('pw', parseFloat(e.target.value))}
            className="w-full accent-[var(--accent)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* Daylight Left Slider */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="param-day" className="flex items-center gap-1.5 font-medium">
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span>Daylight left</span>
            </label>
            <output htmlFor="param-day" className="font-mono tabular-nums text-[var(--accent)] font-semibold">
              {params.day.toFixed(1)} h
            </output>
          </div>
          <input
            id="param-day"
            type="range"
            min={1.0}
            max={10.0}
            step={0.1}
            disabled={locked}
            value={params.day}
            onChange={e => onUpdateParam('day', parseFloat(e.target.value))}
            className="w-full accent-[var(--accent)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* Reserve Slider */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="param-res" className="flex items-center gap-1.5 font-medium">
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
              <span>Reserve held back</span>
            </label>
            <output htmlFor="param-res" className="font-mono tabular-nums text-[var(--accent)] font-semibold">
              {params.res}%
            </output>
          </div>
          <input
            id="param-res"
            type="range"
            min={0}
            max={40}
            step={1}
            disabled={locked}
            value={params.res}
            onChange={e => onUpdateParam('res', parseInt(e.target.value, 10))}
            className="w-full accent-[var(--accent)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* Time at Target Slider */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="param-stay" className="flex items-center gap-1.5 font-medium">
              <Clock className="w-3.5 h-3.5 text-purple-400" />
              <span>Time at target</span>
            </label>
            <output htmlFor="param-stay" className="font-mono tabular-nums text-[var(--accent)] font-semibold">
              {Math.round(params.stay * 60)} min
            </output>
          </div>
          <input
            id="param-stay"
            type="range"
            min={0}
            max={2.0}
            step={0.05}
            disabled={locked}
            value={params.stay}
            onChange={e => onUpdateParam('stay', parseFloat(e.target.value))}
            className="w-full accent-[var(--accent)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        <p className="text-[11.5px] text-[var(--fg-dim)] leading-tight mt-1 border-t border-[var(--line)]/50 pt-2">
          The smallest consumable sets the mission clock. Reserve is held back and never planned against.
        </p>
      </section>

      {/* Terrain & Movement Limits */}
      <section className="bg-[var(--panel)] border border-[var(--line)] rounded-md p-3.5 flex flex-col gap-3">
        <h2 className="text-xs font-semibold tracking-wider text-[var(--fg-dim)] uppercase pb-1 border-b border-[var(--line)]">
          Terrain &amp; Movement Limits
        </h2>

        {/* Flat Walking Pace */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="param-pace" className="flex items-center gap-1.5 font-medium">
              <Footprints className="w-3.5 h-3.5 text-emerald-400" />
              <span>Flat walking pace</span>
            </label>
            <output htmlFor="param-pace" className="font-mono tabular-nums text-[var(--accent)] font-semibold">
              {params.pace.toFixed(1)} km/h
            </output>
          </div>
          <input
            id="param-pace"
            type="range"
            min={1.0}
            max={4.0}
            step={0.1}
            disabled={locked}
            value={params.pace}
            onChange={e => onUpdateParam('pace', parseFloat(e.target.value))}
            className="w-full accent-[var(--accent)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* Hard Slope Limit */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="param-maxSlope" className="flex items-center gap-1.5 font-medium">
              <Mountain className="w-3.5 h-3.5 text-rose-400" />
              <span>Hard slope limit</span>
            </label>
            <output htmlFor="param-maxSlope" className="font-mono tabular-nums text-[var(--stop)] font-semibold">
              {params.maxSlope}°
            </output>
          </div>
          <input
            id="param-maxSlope"
            type="range"
            min={10}
            max={35}
            step={1}
            disabled={locked}
            value={params.maxSlope}
            onChange={e => onUpdateParam('maxSlope', parseInt(e.target.value, 10))}
            className="w-full accent-[var(--stop)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* Comfort Slope Limit */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="param-comfort" className="flex items-center gap-1.5 font-medium">
              <Compass className="w-3.5 h-3.5 text-amber-400" />
              <span>Comfort slope limit</span>
            </label>
            <output htmlFor="param-comfort" className="font-mono tabular-nums text-[var(--warn)] font-semibold">
              {params.comfort}°
            </output>
          </div>
          <input
            id="param-comfort"
            type="range"
            min={5}
            max={25}
            step={1}
            disabled={locked}
            value={params.comfort}
            onChange={e => onUpdateParam('comfort', parseInt(e.target.value, 10))}
            className="w-full accent-[var(--warn)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        <p className="text-[11.5px] text-[var(--fg-dim)] leading-tight mt-1 border-t border-[var(--line)]/50 pt-2">
          Fastest route utilizes ground up to hard slope limit. Safest and Science prioritize paths under the comfort limit.
        </p>
      </section>

      {/* Map Click Mode Selector */}
      <section className="bg-[var(--panel)] border border-[var(--line)] rounded-md p-3 flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wider text-[var(--fg-dim)] uppercase">
          Map Click Sets
        </h2>
        <div className={`grid ${locked ? 'grid-cols-2' : 'grid-cols-2'} rounded border border-[var(--line)] overflow-hidden`} role="group">
          <button
            type="button"
            onClick={() => setClickMode('target')}
            aria-pressed={clickMode === 'target'}
            className={`py-1.5 text-xs font-semibold tracking-wider uppercase transition-colors cursor-pointer ${
              clickMode === 'target'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-bold'
                : 'bg-transparent text-[var(--fg-dim)] hover:bg-[var(--panel-2)] hover:text-[var(--fg)]'
            }`}
          >
            Target
          </button>
          {locked ? (
            <button
              type="button"
              onClick={() => setClickMode('here')}
              aria-pressed={clickMode === 'here'}
              className={`py-1.5 text-xs font-semibold tracking-wider uppercase transition-colors border-l border-[var(--line)] cursor-pointer ${
                clickMode === 'here'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-bold'
                  : 'bg-transparent text-[var(--fg-dim)] hover:bg-[var(--panel-2)] hover:text-[var(--fg)]'
              }`}
            >
              I am here
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setClickMode('hab')}
              aria-pressed={clickMode === 'hab'}
              className={`py-1.5 text-xs font-semibold tracking-wider uppercase transition-colors border-l border-[var(--line)] cursor-pointer ${
                clickMode === 'hab'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-bold'
                  : 'bg-transparent text-[var(--fg-dim)] hover:bg-[var(--panel-2)] hover:text-[var(--fg)]'
              }`}
            >
              Habitat
            </button>
          )}
        </div>
        <p className="text-[11px] text-[var(--fg-dim)] font-mono">
          {clickMode === 'here'
            ? 'Click map or drag Walk it slider to move astronaut position.'
            : `Arrow keys nudge ${clickMode === 'target' ? 'target' : 'habitat'} across map (Shift for ×10).`}
        </p>
      </section>

      {/* Science Targets Catalog */}
      <section className="bg-[var(--panel)] border border-[var(--line)] rounded-md p-3.5 flex flex-col gap-2">
        <div className="flex items-center justify-between pb-1 border-b border-[var(--line)]">
          <h2 className="text-xs font-semibold tracking-wider text-[var(--fg-dim)] uppercase">
            Science Targets
          </h2>
          <span className="text-[11px] font-mono text-[var(--fg-dim)]">
            {targets.length} Sites
          </span>
        </div>

        <ul className="flex flex-col gap-1.5 p-0 m-0 list-none" aria-label="Science target catalog">
          {targets.map(t => {
            const isSelected = t.i === selectedTargetIndex;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onSelectScienceTarget(t)}
                  aria-pressed={isSelected}
                  className={`w-full text-left grid grid-cols-[auto_1fr_auto] gap-2 items-center p-2 rounded border transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--panel-2)] border-[var(--accent)] ring-1 ring-[var(--accent)]'
                      : 'bg-[var(--panel-2)] border-[var(--line)] hover:border-[var(--info)]'
                  }`}
                >
                  <span className="font-mono text-xs font-bold text-[var(--info)] px-1.5 py-0.5 rounded bg-black/30 border border-[var(--info)]/30">
                    {t.id}
                  </span>
                  <div className="min-w-0 leading-tight">
                    <span className="text-xs font-medium block truncate text-[var(--fg)]">
                      {t.name}
                    </span>
                    <small className="text-[11px] text-[var(--fg-dim)] block truncate">
                      {t.kind}
                    </small>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-xs font-bold text-[var(--fg)]">
                      {(t.val * 100).toFixed(0)}%
                    </span>
                    <small className="text-[10px] text-[var(--fg-dim)] block uppercase">
                      PRIORITY
                    </small>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
};
