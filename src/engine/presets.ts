/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MissionParams, PresetId } from '../types';

export interface PresetSpec {
  id: Exclude<PresetId, 'custom'>;
  label: string;
  o2: number;
  pw: number;
  day: number;
  res: number;
  stay: number;
}

/**
 * Fixed preset table: Nominal, Extended, Contingency.
 * Each sets oxygen, suit power, daylight, reserve, and time at target.
 */
export const MISSION_PRESETS: Record<Exclude<PresetId, 'custom'>, PresetSpec> = {
  nominal: {
    id: 'nominal',
    label: 'Nominal',
    o2: 4.0,
    pw: 4.5,
    day: 5.5,
    res: 20,
    stay: 0.25
  },
  extended: {
    id: 'extended',
    label: 'Extended',
    o2: 6.0,
    pw: 6.5,
    day: 7.0,
    res: 15,
    stay: 0.5
  },
  contingency: {
    id: 'contingency',
    label: 'Contingency',
    o2: 2.5,
    pw: 2.2,
    day: 3.0,
    res: 25,
    stay: 0.1
  }
};

export const DEFAULT_TERRAIN_LIMITS = {
  pace: 2.5,
  maxSlope: 25,
  comfort: 15
};

export function createDefaultParams(): MissionParams {
  return {
    o2: MISSION_PRESETS.nominal.o2,
    pw: MISSION_PRESETS.nominal.pw,
    day: MISSION_PRESETS.nominal.day,
    res: MISSION_PRESETS.nominal.res,
    stay: MISSION_PRESETS.nominal.stay,
    pace: DEFAULT_TERRAIN_LIMITS.pace,
    maxSlope: DEFAULT_TERRAIN_LIMITS.maxSlope,
    comfort: DEFAULT_TERRAIN_LIMITS.comfort
  };
}

export function detectPreset(params: MissionParams): PresetId {
  const approx = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  for (const key of ['nominal', 'extended', 'contingency'] as const) {
    const p = MISSION_PRESETS[key];
    if (
      approx(params.o2, p.o2) &&
      approx(params.pw, p.pw) &&
      approx(params.day, p.day) &&
      approx(params.res, p.res) &&
      approx(params.stay, p.stay)
    ) {
      return key;
    }
  }
  return 'custom';
}
