/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ScienceTarget {
  id: string;
  name: string;
  kind: string;
  val: number; // Priority / science value: 0 - 1
  x: number;
  y: number;
  i: number; // Cell index: y * W + x
  description?: string;
}

export interface GeologyUnit {
  name: string;
  color: [number, number, number];
  desc: string;
}

export interface TerrainDataset {
  id: string;
  name: string;
  isReal: boolean;
  label: string;
  W: number;
  H: number;
  cellMeters: number;
  z: Float32Array;
  slopeDeg: Float32Array;
  ti: Float32Array;
  softF: Float32Array;
  shade: Float32Array;
  unit: Uint8Array;
  zmin: number;
  zmax: number;
  units: GeologyUnit[];
  defaultHab: { x: number; y: number };
  defaultTgt: { x: number; y: number };
  targets: ScienceTarget[];
  citation: string;
}

export interface MissionParams {
  o2: number;       // Oxygen limit (h)
  pw: number;       // Suit power (h)
  day: number;      // Daylight left (h)
  res: number;      // Reserve held back (%)
  stay: number;     // Time at target (hours)
  pace: number;     // Flat walking pace (km/h)
  maxSlope: number; // Hard slope limit (degrees)
  comfort: number;  // Comfort slope limit (degrees)
}

export interface RouteMetrics {
  dist: number;      // Total outbound distance in metres
  tOut: number;      // Outbound travel time in hours
  tBack: number;     // Inbound return travel time in hours
  maxDeg: number;    // Steepest step slope in degrees
  over: number;      // Number of steps steeper than comfort slope limit
  softM: number;     // Distance travelled across soft ground (metres)
  hit: ScienceTarget[]; // Science targets passed within 120m (4 cells)
  sci: number;       // Net science score
  margin: number;    // Usable time - (tOut + tBack) in hours
  path: number[];    // Cell indices from origin to destination
}

export type RouteStatus = 'go' | 'tight' | 'nogo';

export interface RouteCard {
  id: 'fast' | 'safe' | 'sci';
  name: string;
  colorVar: string;
  colorHex: string;
  path: number[];
  m: RouteMetrics;
  status: RouteStatus;
}

export interface DijkstraResult {
  dist: Float64Array;
  link: Int32Array;
}

export interface PlannerResults {
  lim: number;
  limName: 'Oxygen' | 'Suit power' | 'Daylight';
  budget: number;  // Hours after reserve
  usable: number;  // Hours for walking (budget - stay)
  out: DijkstraResult;
  back: DijkstraResult;
  reach: Uint8Array; // 1 if within reach zone, 0 otherwise
  cnt: number;      // Count of reachable cells
  far: number;      // Maximum Euclidean distance from habitat in metres
  routes: RouteCard[];
  notes: {
    relaxed?: boolean; // True if safest route had to relax to hard slope limit
  };
}

export type VerificationKind = 'verified' | 'tight' | 'outside' | 'unreachable';

export interface NearestReachableSuggestion {
  cellIndex: number;
  xMeters: number;
  yMeters: number;
  marginHours: number;
  distanceFromTargetMeters: number;
}

export interface DestinationVerification {
  kind: VerificationKind;
  chipText: string;
  marginHours: number;
  nearestReachable: NearestReachableSuggestion | null;
  singleFixSuggestion: string | null;
}

export type MapLayer = 'slope' | 'elev' | 'thermal' | 'geo';
export type ClickMode = 'target' | 'hab' | 'here';
export type PresetId = 'nominal' | 'extended' | 'contingency' | 'custom';
export type MissionStatus = 'planning' | 'active';
export type DirectionTab = 'outbound' | 'return';

export interface EventLogEntry {
  id: number;
  elapsedH: number;
  event: string;
  details: string;
}

export interface EvaLiveTelemetry {
  elapsedH: number;
  remO2: number;
  remPw: number;
  remDay: number;
  remLimName: 'Oxygen' | 'Suit power' | 'Daylight';
  remUsableBeforeStay: number;
  currentCell: number;
  currentSlopeDeg: number;
  currentHeadingDeg: number;
  currentBearingStr: string;
  currentDir8: string;
  distToDestM: number;
  distBackToHabM: number;
  timeToDestH: number;
  timeBackFromHereToHabH: number;
  timeBackFromDestToHabH: number;
  continueMarginH: number;
  turnaroundMarginH: number;
  status: RouteStatus;
  autoTurnaround: boolean;
  turnaroundBanner: string | null;
  warnings: string[];
}

export interface WalkbackState {
  terrainId: 'sample' | 'jezero';
  habIndex: number;
  tgtIndex: number;
  selectedRouteId: 'fast' | 'safe' | 'sci';
  directionMode: DirectionTab;
  preset: PresetId;
  params: MissionParams;
  activeLayer: MapLayer;
  clickMode: ClickMode;
  overlays: {
    reach: boolean;
    hazards: boolean;
    science: boolean;
    routes: boolean;
  };
  missionStatus: MissionStatus;
  walkActive: boolean;
  walkStepIndex: number;
  astronautCell: number;
  elapsedH: number;
  walkedPath: number[]; // Cells already traversed from habitat during EVA
  autoTurnaroundTriggered: boolean;
  routeSwitchNotice: string | null;
  lastLimName: 'Oxygen' | 'Suit power' | 'Daylight' | null;
  activeWarnFlags: {
    lowBudget: boolean;
    overComfort: boolean;
    overHard: boolean;
  };
  eventLog: EventLogEntry[];
  nextLogId: number;
  readAloudEnabled: boolean;
  theme: 'dark' | 'light';
}
