/**
 * Intervention arithmetic for the Virtual City view.
 *
 * Everything here is SIMULATED. The functions apply explicit, published
 * assumptions to real baseline values read from the database (mapped green
 * area, OSM road lengths, the modelled PM2.5 24 h mean, real building
 * footprints). They are not measurements and they are not forecasts.
 *
 * Assumptions, all printed in the UI:
 * - A mature tree provides 25 m² of canopy.
 * - PM2.5 responds to a change in green share by a user-set coefficient
 *   (% per green-share point). No local study establishes this value.
 * - A garbage site is assumed to represent 50 kg/day of uncollected waste.
 * - 1,000 extra vehicles per day add 0.8 µg/m³ of PM2.5 (order-of-magnitude).
 * - Each blocked drain is assumed to put 0.35 ha at surface-flood risk.
 * - A road closure removes that share of the class length from use. No traffic
 *   or emissions model exists, so congestion is NOT computed.
 * - The seismic check is a simplified PGA attenuation plus a logistic fragility
 *   curve. It is illustrative only: it is not a hazard assessment, it ignores
 *   soil, and it says nothing about code compliance.
 */

export const TREE_CANOPY_M2 = 25;
export const GARBAGE_KG_PER_SITE_DAY = 50;
export const DEFAULT_PM25_COEFFICIENT = 0.4;

/** Assumed PM2.5 added per 1,000 extra vehicles per day, µg/m³. */
export const PM25_PER_1000_VEHICLES = 0.8;
/** Assumed area put at surface-flood risk by one blocked drain, hectares. */
export const FLOOD_HA_PER_BLOCKED_DRAIN = 0.35;
/** Assumed average pothole repair area, m². */
export const POTHOLE_AREA_M2 = 1.5;

/** Illustrative earthquake scenario used by the construction check. */
export const SEISMIC_SCENARIO_MAGNITUDE = 6.5;
export const SEISMIC_SCENARIO_DISTANCE_KM = 20;
/** Median PGA (g) at which a single-storey masonry building sees slight damage. */
const FRAGILITY_MEDIAN_G = 0.08;
/** Each extra storey lowers the median PGA by this fraction: taller = more vulnerable. */
const FRAGILITY_PER_STOREY = 0.1;

export interface SimBaseline {
  aoiAreaHa: number;
  greenHa: number;
  greenSharePercent: number;
  roadKm: number;
  roadByClass: Array<{ highway_class: string; segments: number; length_km: number }>;
  pm25Mean24h: number | null;
}

export interface Interventions {
  trees: number;
  garbageSites: number;
  carsAdded: number;
  potholes: number;
  blockedDrains: number;
  closedClass: string;
  closurePercent: number;
  pm25Coefficient: number;
  buildingFloors: number;
  buildingFootprintM2: number;
}

/** Real facts about the build site, measured from the loaded building footprints. */
export interface SimContext {
  nearbyBuildings: number;
  nearbyAverageFloors: number;
}

export interface SeismicResult {
  pgaG: number;
  damageProbability: number;
  nearbyBuildings: number;
  expectedDamaged: number;
  storeys: number;
  scenarioMagnitude: number;
  scenarioDistanceKm: number;
}

export interface SimResult {
  canopyHa: number;
  addedGreenHa: number;
  newGreenHa: number;
  newSharePercent: number;
  deltaShare: number;
  pm25ChangePercent: number | null;
  pm25Projected: number | null;
  /** PM2.5 added by the extra vehicles, µg/m³. */
  trafficPm25: number;
  /** Combined projected PM2.5 after green + traffic changes, µg/m³. */
  pm25Total: number | null;
  /** CPCB category for pm25Total. */
  aqiCategory: string | null;
  closedKm: number;
  closedShare: number;
  garbageLoadKgPerDay: number;
  repairedAreaM2: number;
  floodedHa: number;
  /** 0–100 composite of the simulated penalties and benefits. Weights assumed. */
  cityCondition: number;
  seismic: SeismicResult | null;
  /** Things this model deliberately does not compute. */
  notModelled: string[];
}

const clampNonNegative = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** CPCB PM2.5 bands (µg/m³, 24 h). */
export function pm25Category(value: number): string {
  if (value <= 30) return "Good";
  if (value <= 60) return "Satisfactory";
  if (value <= 90) return "Moderate";
  if (value <= 120) return "Poor";
  if (value <= 250) return "Very poor";
  return "Severe";
}

/**
 * Simplified PGA attenuation. Constants are illustrative, chosen so a
 * Mw 6.5 event at 20 km gives roughly 0.07 g.
 */
export function peakGroundAcceleration(
  magnitude: number = SEISMIC_SCENARIO_MAGNITUDE,
  distanceKm: number = SEISMIC_SCENARIO_DISTANCE_KM,
): number {
  const distance = Math.max(distanceKm, 1);
  return (0.0025 * Math.pow(10, 0.5 * magnitude)) / Math.pow(distance + 10, 1.2);
}

/** Logistic fragility: probability of at least slight damage at a given PGA. */
export function damageProbability(pgaG: number, storeys: number): number {
  if (pgaG <= 0) return 0;
  const median =
    FRAGILITY_MEDIAN_G / (1 + FRAGILITY_PER_STOREY * (Math.max(storeys, 1) - 1));
  const x = (Math.log(pgaG) - Math.log(median)) / 0.6;
  return 1 / (1 + Math.exp(-x));
}

export function simulateInterventions(
  baseline: SimBaseline,
  interventions: Interventions,
  context?: SimContext,
): SimResult {
  const trees = clampNonNegative(interventions.trees);
  const garbageSites = clampNonNegative(interventions.garbageSites);
  const carsAdded = clampNonNegative(interventions.carsAdded);
  const potholes = clampNonNegative(interventions.potholes);
  const blockedDrains = clampNonNegative(interventions.blockedDrains);
  const closurePercent = clamp(clampNonNegative(interventions.closurePercent), 0, 100);
  const coefficient = clampNonNegative(interventions.pm25Coefficient);
  const buildingFloors = clampNonNegative(interventions.buildingFloors);
  const buildingFootprint = clampNonNegative(interventions.buildingFootprintM2);

  // 1. Canopy area from planted trees.
  const canopyHa = (trees * TREE_CANOPY_M2) / 10_000;

  // 2. New green share. The *delta* is derived from the added canopy and then
  //    applied to the baseline share the API reports, so a zero intervention
  //    reproduces that share exactly instead of drifting on rounded hectares.
  const newGreenHa = baseline.greenHa + canopyHa;
  const deltaShare = baseline.aoiAreaHa > 0 ? (canopyHa / baseline.aoiAreaHa) * 100 : 0;
  const newSharePercent = baseline.greenSharePercent + deltaShare;

  // 3. Assumed PM2.5 response from greenery, applied to the modelled 24 h mean.
  const pm25ChangePercent = -deltaShare * coefficient;
  const pm25Projected =
    baseline.pm25Mean24h === null
      ? null
      : Math.max(0, baseline.pm25Mean24h * (1 + pm25ChangePercent / 100));

  // 4. Extra vehicles add a fixed assumed increment on top.
  const trafficPm25 = (carsAdded / 1000) * PM25_PER_1000_VEHICLES;
  const pm25Total =
    baseline.pm25Mean24h === null ? null : Math.max(0, (pm25Projected ?? 0) + trafficPm25);

  // 5. Road closure: network arithmetic only.
  const classRow = baseline.roadByClass.find(
    (row) => row.highway_class === interventions.closedClass,
  );
  const closedKm = classRow ? (classRow.length_km * closurePercent) / 100 : 0;
  const closedShare = baseline.roadKm > 0 ? (closedKm / baseline.roadKm) * 100 : 0;

  // 6. Composite condition index. Weights are assumed, not calibrated.
  const penalties =
    garbageSites * 0.8 +
    potholes * 0.15 +
    blockedDrains * 2 +
    closedShare * 0.3 +
    trafficPm25 * 1.5;
  const benefit = Math.min(8, trees * 0.004);
  const cityCondition = Math.round(clamp(100 - penalties + benefit, 0, 100) * 10) / 10;

  // 7. Seismic check for the proposed building.
  let seismic: SeismicResult | null = null;
  if (buildingFloors > 0 && buildingFootprint > 0) {
    const pgaG = peakGroundAcceleration();
    const probability = damageProbability(pgaG, buildingFloors);
    seismic = {
      pgaG,
      damageProbability: probability,
      nearbyBuildings: context?.nearbyBuildings ?? 0,
      expectedDamaged: probability * (context?.nearbyBuildings ?? 0),
      storeys: buildingFloors,
      scenarioMagnitude: SEISMIC_SCENARIO_MAGNITUDE,
      scenarioDistanceKm: SEISMIC_SCENARIO_DISTANCE_KM,
    };
  }

  return {
    canopyHa,
    addedGreenHa: canopyHa,
    newGreenHa,
    newSharePercent,
    deltaShare,
    pm25ChangePercent: baseline.pm25Mean24h === null ? null : pm25ChangePercent,
    pm25Projected,
    trafficPm25,
    pm25Total,
    aqiCategory: pm25Total === null ? null : pm25Category(pm25Total),
    closedKm,
    closedShare,
    garbageLoadKgPerDay: garbageSites * GARBAGE_KG_PER_SITE_DAY,
    repairedAreaM2: potholes * POTHOLE_AREA_M2,
    floodedHa: blockedDrains * FLOOD_HA_PER_BLOCKED_DRAIN,
    cityCondition,
    seismic,
    notModelled: [
      "Congestion, queueing and diverted emissions from a road closure",
      "Temperature effects of added canopy",
      "Air-quality effect of uncollected waste",
      "Dispersion, wind and chemistry behind any PM2.5 change",
      "Structural response, soil amplification and code compliance of buildings",
    ],
  };
}

/**
 * Deterministic 0..1 sequence, so markers do not jump between renders.
 */
export function seededSequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** How many symbolic markers to draw for a given count. */
export function markerCount(value: number, poolSize: number): number {
  const count = Math.round(clampNonNegative(value));
  return Math.min(count, poolSize);
}
