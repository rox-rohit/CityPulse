/**
 * Synthetic city fabric for the Virtual City view.
 *
 * The ingested OSM data for the Maharaj Bada AOI contains ~128 building
 * footprints in 4.43 km², so most of the study area is empty. OpenStreetMap
 * simply has no house-level coverage there.
 *
 * This module generates a deterministic, plausible urban fabric around the
 * *real* street network so the twin reads like a city. It is SYNTHETIC: these
 * blocks are not surveyed buildings, they are not in the database, and every
 * consumer must label them as such. Real footprints are always drawn brighter,
 * on top, and are never displaced or hidden by this fabric.
 *
 * The generator is pure and seeded, so the same input always yields the same
 * city — no flicker between renders.
 */

import { seededSequence } from "./simulation";

export type FabricKind = "house" | "shop" | "apartment" | "industry";

export interface FabricBlock {
  lon: number;
  lat: number;
  /** Metres along the street (x of the box). */
  width: number;
  /** Metres away from the street (y of the box). */
  depth: number;
  /** Metres, already including the illustrative storey height. */
  height: number;
  /** Radians, aligned to the street bearing. */
  rotation: number;
  kind: FabricKind;
}

export interface FabricGeoJson {
  type: string;
  coordinates: unknown;
}

export interface FabricFeature {
  geometry: FabricGeoJson | null;
  properties?: Record<string, unknown> | null;
}

export interface FabricLayer {
  table: string;
  data: { features: FabricFeature[] };
}

export interface FabricBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface FabricResult {
  blocks: FabricBlock[];
  counts: Record<FabricKind, number>;
}

const STOREY_M = 3.2;
/** Sampling step along a street, metres. */
const STEP_M = 26;
/** Distance from the centre-line to the building face, metres. */
const SETBACK_M = 11;
const CELL_M = 9;
const MAX_BLOCKS = 1200;
/** Streets that can carry frontage. Footways and steps cannot. */
const FRONTAGE_ROADS = new Set([
  "residential",
  "service",
  "secondary",
  "tertiary",
  "primary",
  "living_street",
  "unclassified",
]);

const KIND_SIZE: Record<FabricKind, { width: [number, number]; depth: [number, number]; floors: [number, number] }> = {
  house: { width: [7, 11], depth: [6, 9], floors: [1, 2] },
  shop: { width: [10, 16], depth: [8, 12], floors: [2, 3] },
  apartment: { width: [16, 26], depth: [11, 16], floors: [4, 7] },
  industry: { width: [24, 40], depth: [16, 26], floors: [1, 2] },
};

function ringToDegrees(ring: unknown[]): number[] {
  const flat: number[] = [];
  ring.forEach((point) => {
    if (Array.isArray(point) && point.length >= 2) {
      flat.push(Number(point[0]), Number(point[1]));
    }
  });
  return flat;
}

export function fabricPolygonRings(geometry: FabricGeoJson | null): number[][] {
  if (!geometry || !geometry.coordinates) return [];
  if (geometry.type === "Polygon") {
    return (geometry.coordinates as unknown[][]).map(ringToDegrees);
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as unknown[][][]).flatMap((polygon) =>
      polygon.map(ringToDegrees),
    );
  }
  return [];
}

export function fabricLineStrings(
  geometry: FabricGeoJson | null,
): Array<Array<[number, number]>> {
  if (!geometry || !geometry.coordinates) return [];
  const clean = (line: unknown[]): Array<[number, number]> =>
    line
      .filter((point): point is number[] => Array.isArray(point) && point.length >= 2)
      .map((point) => [Number(point[0]), Number(point[1])] as [number, number]);

  if (geometry.type === "LineString") return [clean(geometry.coordinates as unknown[])];
  if (geometry.type === "MultiLineString") {
    return (geometry.coordinates as unknown[][]).map(clean);
  }
  return [];
}

const metresPerDegreeLat = 110_540;

function metresPerDegreeLon(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

function cellKey(lon: number, lat: number, lat0: number): string {
  const x = Math.floor((lon * metresPerDegreeLon(lat0)) / CELL_M);
  const y = Math.floor((lat * metresPerDegreeLat) / CELL_M);
  return `${x},${y}`;
}

/** Mark the cells covered by a circle of `radiusM` metres. */
function occupy(
  grid: Set<string>,
  lon: number,
  lat: number,
  radiusM: number,
  lat0: number,
): void {
  const dLon = radiusM / metresPerDegreeLon(lat0);
  const dLat = radiusM / metresPerDegreeLat;
  for (let a = -1; a <= 1; a += 1) {
    for (let b = -1; b <= 1; b += 1) {
      grid.add(cellKey(lon + a * dLon, lat + b * dLat, lat0));
    }
  }
}

function isFree(
  grid: Set<string>,
  lon: number,
  lat: number,
  radiusM: number,
  lat0: number,
): boolean {
  const dLon = radiusM / metresPerDegreeLon(lat0);
  const dLat = radiusM / metresPerDegreeLat;
  for (let a = -1; a <= 1; a += 1) {
    for (let b = -1; b <= 1; b += 1) {
      if (grid.has(cellKey(lon + a * dLon, lat + b * dLat, lat0))) return false;
    }
  }
  return true;
}

/**
 * Build the fabric. Real buildings, green space and street centre-lines are
 * reserved first, so synthetic blocks only occupy genuinely empty land.
 */
export function generateCityFabric(
  layers: FabricLayer[],
  bounds: FabricBounds,
  seed = 20261114,
): FabricResult {
  const lat0 = (bounds.south + bounds.north) / 2;
  const random = seededSequence(seed);
  const grid = new Set<string>();
  const blocks: FabricBlock[] = [];
  const counts: Record<FabricKind, number> = { house: 0, shop: 0, apartment: 0, industry: 0 };

  const buildings = layers.find((layer) => layer.table === "buildings");
  const green = layers.find((layer) => layer.table === "green_spaces");
  const roads = layers.find((layer) => layer.table === "roads");

  // 1. Reserve surveyed buildings.
  buildings?.data.features.forEach((feature) => {
    fabricPolygonRings(feature.geometry).forEach((ring) => {
      for (let i = 0; i < ring.length; i += 2) {
        occupy(grid, ring[i], ring[i + 1], 10, lat0);
      }
    });
  });

  // 2. Reserve green space (trees are added there instead).
  green?.data.features.forEach((feature) => {
    fabricPolygonRings(feature.geometry).forEach((ring) => {
      for (let i = 0; i < ring.length; i += 2) {
        occupy(grid, ring[i], ring[i + 1], 22, lat0);
      }
    });
  });

  // 3. Reserve the street corridor itself.
  const roadsWithGeometry = (roads?.data.features ?? [])
    .flatMap((feature) =>
      fabricLineStrings(feature.geometry).map((line) => ({
        line,
        highway: String(feature.properties?.highway ?? "residential"),
      })),
    )
    .filter((road) => FRONTAGE_ROADS.has(road.highway));

  // Shuffle deterministically: the BLOCK CAP must sample the whole study area,
  // not just whichever streets happen to come first in the GeoJSON.
  for (let i = roadsWithGeometry.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [roadsWithGeometry[i], roadsWithGeometry[j]] = [roadsWithGeometry[j], roadsWithGeometry[i]];
  }

  roadsWithGeometry.forEach(({ line }) => {
    for (let i = 1; i < line.length; i += 1) {
      occupy(grid, line[i][0], line[i][1], 9, lat0);
    }
  });

  // 4. Walk each street and line both sides with blocks.
  roadsWithGeometry.forEach(({ line, highway }) => {
    const isBig = highway === "primary" || highway === "secondary" || highway === "tertiary";
    for (let i = 1; i < line.length; i += 1) {
      const [lonA, latA] = line[i - 1];
      const [lonB, latB] = line[i];
      const dx = (lonB - lonA) * metresPerDegreeLon(lat0);
      const dy = (latB - latA) * metresPerDegreeLat;
      const lengthM = Math.hypot(dx, dy);
      if (lengthM < 18) continue;

      const bearing = Math.atan2(dy, dx);
      const steps = Math.max(1, Math.floor(lengthM / STEP_M));

      for (let step = 0; step <= steps; step += 1) {
        if (blocks.length >= MAX_BLOCKS) break;
        const t = step / (steps + 1);
        const alongLon = lonA + (lonB - lonA) * t;
        const alongLat = latA + (latB - latA) * t;

        for (const side of [1, -1]) {
          if (blocks.length >= MAX_BLOCKS) break;

          // 30% of frontages stay open: courtyards, vacant plots, driveways.
          if (random() < 0.3) continue;

          const offset = (SETBACK_M + random() * 5) * side;
          const offLon =
            alongLon - (Math.sin(bearing) * offset) / metresPerDegreeLon(lat0);
          const offLat = alongLat + (Math.cos(bearing) * offset) / metresPerDegreeLat;

          if (
            offLon < bounds.west ||
            offLon > bounds.east ||
            offLat < bounds.south ||
            offLat > bounds.north
          ) {
            continue;
          }

          if (!isFree(grid, offLon, offLat, 7, lat0)) continue;

          // Kind by street class and the roll of the dice.
          const roll = random();
          let kind: FabricKind = "house";
          if (isBig && roll < 0.45) kind = "shop";
          else if (roll < 0.58) kind = "shop";
          else if (roll < 0.72) kind = "apartment";
          else if (roll < 0.76) kind = "industry";

          const size = KIND_SIZE[kind];
          const pick = (range: [number, number]) => range[0] + random() * (range[1] - range[0]);
          const floors = Math.round(pick(size.floors));

          blocks.push({
            lon: offLon,
            lat: offLat,
            width: pick(size.width),
            depth: pick(size.depth),
            height: floors * STOREY_M,
            rotation: bearing,
            kind,
          });
          counts[kind] += 1;
          occupy(grid, offLon, offLat, 8, lat0);
        }
      }
    }
  });

  return { blocks, counts };
}

/**
 * Tree positions inside mapped green space, so parks read as parks.
 * Deterministic; capped by `limit`.
 */
export function sampleParkTrees(
  layers: FabricLayer[],
  limit = 220,
  seed = 991,
): Array<[number, number]> {
  const random = seededSequence(seed);
  const green = layers.find((layer) => layer.table === "green_spaces");
  if (!green) return [];

  const positions: Array<[number, number]> = [];
  green.data.features.forEach((feature) => {
    fabricPolygonRings(feature.geometry).forEach((ring) => {
      if (ring.length < 6) return;
      let minLon = Infinity;
      let maxLon = -Infinity;
      let minLat = Infinity;
      let maxLat = -Infinity;
      for (let i = 0; i < ring.length; i += 2) {
        minLon = Math.min(minLon, ring[i]);
        maxLon = Math.max(maxLon, ring[i]);
        minLat = Math.min(minLat, ring[i + 1]);
        maxLat = Math.max(maxLat, ring[i + 1]);
      }
      // Rejection-sample inside the bounding box; a few points that fall just
      // outside an irregular park are acceptable at this schematic scale.
      const wanted = Math.min(70, Math.floor((maxLon - minLon) * (maxLat - minLat) * 400_000));
      for (let i = 0; i < wanted && positions.length < limit; i += 1) {
        positions.push([
          minLon + random() * (maxLon - minLon),
          minLat + random() * (maxLat - minLat),
        ]);
      }
    });
  });

  return positions;
}
