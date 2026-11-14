/**
 * Planned city generator for the Virtual City view.
 *
 * The study area is now a GENERATED city, not a copy of any real place. It is
 * laid out on a street grid with zoned districts so it reads like a planned
 * urban area: a tall downtown core, a mid-rise ring, low-rise housing, an
 * industrial estate, parks, a lake and a college campus.
 *
 * Everything here is synthetic and deterministic. Nothing in this module is
 * survey data, and it must never be presented as such.
 */

import { seededSequence } from "./simulation";

export type Zone = "core" | "midtown" | "residential" | "industrial" | "campus" | "park";

export interface PlanBuilding {
  lon: number;
  lat: number;
  /** Metres along the frontage. */
  width: number;
  /** Metres into the block. */
  depth: number;
  height: number;
  rotation: number;
  zone: Zone;
  name?: string;
}

export interface PlanRoad {
  line: Array<[number, number]>;
  kind: "primary" | "secondary";
}

export interface PlanArea {
  ring: Array<[number, number]>;
  kind: "park" | "forest" | "lake" | "campus" | "industrial";
}

export interface PlanTree {
  lon: number;
  lat: number;
  scale: number;
}

export interface CityPlan {
  buildings: PlanBuilding[];
  roads: PlanRoad[];
  areas: PlanArea[];
  trees: PlanTree[];
  labels: Array<{ lon: number; lat: number; text: string }>;
  counts: Record<Zone, number>;
}

export interface PlanBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

const STOREY_M = 3.2;
/** Minor street spacing, metres. */
const CELL_M = 104;
/** Every fourth street is an avenue. */
const AVENUE_EVERY = 4;
const ROAD_W_M = 14;
const SETBACK_M = 7;

const lonPerMetre = (lat: number) => 1 / (111_320 * Math.cos((lat * Math.PI) / 180));
const latPerMetre = 1 / 110_540;

interface Frame {
  centreLon: number;
  centreLat: number;
  width: number;
  height: number;
  toLon: (x: number) => number;
  toLat: (y: number) => number;
}

function frameOf(bounds: PlanBounds): Frame {
  const centreLon = (bounds.west + bounds.east) / 2;
  const centreLat = (bounds.south + bounds.north) / 2;
  const width = (bounds.east - bounds.west) * 111_320 * Math.cos((centreLat * Math.PI) / 180);
  const height = (bounds.north - bounds.south) * 110_540;
  return {
    centreLon,
    centreLat,
    width,
    height,
    toLon: (x) => centreLon + x * lonPerMetre(centreLat),
    toLat: (y) => centreLat + y * latPerMetre,
  };
}

function rectArea(
  frame: Frame,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  kind: PlanArea["kind"],
): PlanArea {
  return {
    kind,
    ring: [
      [frame.toLon(x0), frame.toLat(y0)],
      [frame.toLon(x1), frame.toLat(y0)],
      [frame.toLon(x1), frame.toLat(y1)],
      [frame.toLon(x0), frame.toLat(y1)],
      [frame.toLon(x0), frame.toLat(y0)],
    ],
  };
}

function circleArea(
  frame: Frame,
  cx: number,
  cy: number,
  radius: number,
  kind: PlanArea["kind"],
  points = 28,
): PlanArea {
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    ring.push([
      frame.toLon(cx + Math.cos(angle) * radius),
      frame.toLat(cy + Math.sin(angle) * radius * 0.72),
    ]);
  }
  return { kind, ring };
}

/** District for a block centre, in metres from the city centre. */
function zoneAt(x: number, y: number, halfW: number, halfH: number): Zone {
  const r = Math.hypot(x / halfW, y / halfH);
  const angle = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

  // Industrial estate: south-west quadrant, outside the core.
  if (r > 0.42 && angle > 190 && angle < 265) return "industrial";
  if (r < 0.45) return "core";
  if (r < 0.68) return "midtown";
  return "residential";
}

/**
 * Build the city. `bounds` is the study-area rectangle; the plan fills it with
 * a street grid and zoned blocks.
 */
export function generateCityPlan(bounds: PlanBounds, seed = 20261114): CityPlan {
  const frame = frameOf(bounds);
  const random = seededSequence(seed);
  const halfW = frame.width / 2;
  const halfH = frame.height / 2;

  const buildings: PlanBuilding[] = [];
  const roads: PlanRoad[] = [];
  const areas: PlanArea[] = [];
  const trees: PlanTree[] = [];
  const labels: Array<{ lon: number; lat: number; text: string }> = [];
  const counts: Record<Zone, number> = {
    core: 0,
    midtown: 0,
    residential: 0,
    industrial: 0,
    campus: 0,
    park: 0,
  };

  // --- Street grid ---------------------------------------------------------
  const columns = Math.max(4, Math.round(frame.width / CELL_M));
  const rows = Math.max(4, Math.round(frame.height / CELL_M));
  const cellW = frame.width / columns;
  const cellH = frame.height / rows;

  for (let c = 0; c <= columns; c += 1) {
    const x = -halfW + c * cellW;
    roads.push({
      kind: c % AVENUE_EVERY === 0 ? "primary" : "secondary",
      line: [
        [frame.toLon(x), frame.toLat(-halfH)],
        [frame.toLon(x), frame.toLat(halfH)],
      ],
    });
  }
  for (let r = 0; r <= rows; r += 1) {
    const y = -halfH + r * cellH;
    roads.push({
      kind: r % AVENUE_EVERY === 0 ? "primary" : "secondary",
      line: [
        [frame.toLon(-halfW), frame.toLat(y)],
        [frame.toLon(halfW), frame.toLat(y)],
      ],
    });
  }

  // --- Fixed set pieces ----------------------------------------------------
  const centreParkX = halfW * 0.42;
  const centreParkY = halfH * 0.1;
  areas.push(rectArea(frame, centreParkX - 90, centreParkY - 70, centreParkX + 110, centreParkY + 90, "park"));
  labels.push({ lon: frame.toLon(centreParkX + 10), lat: frame.toLat(centreParkY + 100), text: "Central Park" });

  const lakeX = -halfW * 0.32;
  const lakeY = -halfH * 0.3;
  areas.push(circleArea(frame, lakeX, lakeY, 150, "lake"));
  labels.push({ lon: frame.toLon(lakeX), lat: frame.toLat(lakeY), text: "Lake" });

  const forestX = -halfW * 0.62;
  const forestY = halfH * 0.5;
  areas.push(rectArea(frame, forestX - 170, forestY - 120, forestX + 170, forestY + 130, "forest"));
  labels.push({ lon: frame.toLon(forestX), lat: frame.toLat(forestY), text: "City Forest" });

  // Industrial estate ground tint.
  const indX = -halfW * 0.5;
  const indY = -halfH * 0.55;
  areas.push(rectArea(frame, indX - 230, indY - 190, indX + 170, indY + 200, "industrial"));
  labels.push({ lon: frame.toLon(indX - 30), lat: frame.toLat(indY + 210), text: "Industrial Estate" });

  // College campus: north-east corner, deliberately kept clear of the grid fill.
  const campusX = halfW * 0.5;
  const campusY = halfH * 0.52;
  const campusHalfX = 170;
  const campusHalfY = 150;
  areas.push(
    rectArea(
      frame,
      campusX - campusHalfX,
      campusY - campusHalfY,
      campusX + campusHalfX,
      campusY + campusHalfY,
      "campus",
    ),
  );
  labels.push({ lon: frame.toLon(campusX), lat: frame.toLat(campusY - campusHalfY + 34), text: "MITS Campus" });

  const inCampus = (x: number, y: number) =>
    Math.abs(x - campusX) < campusHalfX + 40 && Math.abs(y - campusY) < campusHalfY + 40;
  const inArea = (x: number, y: number, area: PlanArea) => {
    // Cheap bounding-box test is enough at this scale.
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    area.ring.forEach(([lon, lat]) => {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    });
    const lon = frame.toLon(x);
    const lat = frame.toLat(y);
    return lon > minLon && lon < maxLon && lat > minLat && lat < maxLat;
  };
  const inAnyArea = (x: number, y: number) =>
    areas.some((area) => area.kind !== "industrial" && inArea(x, y, area));

  const pick = (low: number, high: number) => low + random() * (high - low);
  const lotRotation = (side: "n" | "s" | "e" | "w") =>
    side === "e" || side === "w" ? Math.PI / 2 : 0;

  /** One lot on a block edge. */
  const addLot = (
    cx: number,
    cy: number,
    zone: Zone,
    side: "n" | "s" | "e" | "w",
    spanX: number,
    spanY: number,
    scale: number,
  ) => {
    if (random() < 0.18) return; // vacant plot / courtyard

    const isCore = zone === "core";
    const width = (isCore ? pick(28, 44) : pick(10, 26)) * scale;
    const depth = (isCore ? pick(26, 38) : pick(9, 20)) * scale;
    const offset = (random() - 0.5) * (side === "n" || side === "s" ? spanX : spanY) * 0.45;

    let x = cx;
    let y = cy;
    if (side === "n") y = cy + spanY / 2 - depth / 2 - SETBACK_M;
    if (side === "s") y = cy - spanY / 2 + depth / 2 + SETBACK_M;
    if (side === "e") x = cx + spanX / 2 - depth / 2 - SETBACK_M;
    if (side === "w") x = cx - spanX / 2 + depth / 2 + SETBACK_M;

    if (side === "n" || side === "s") x += offset;
    else y += offset;

    const heightFactor = isCore ? pick(0.7, 1.4) : 1;
    const storeys =
      zone === "core"
        ? Math.round(pick(12, 38) * heightFactor)
        : zone === "midtown"
          ? Math.round(pick(5, 14))
          : zone === "industrial"
            ? 1
            : Math.round(pick(1, 3));

    buildings.push({
      lon: frame.toLon(x),
      lat: frame.toLat(y),
      width,
      depth,
      height: zone === "industrial" ? pick(7, 13) : storeys * STOREY_M,
      rotation: lotRotation(side),
      zone,
    });
    counts[zone] += 1;
  };

  // --- Block fill ----------------------------------------------------------
  for (let c = 0; c < columns; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const cx = -halfW + (c + 0.5) * cellW;
      const cy = -halfH + (r + 0.5) * cellH;

      if (inCampus(cx, cy) || inAnyArea(cx, cy)) continue;

      const zone = zoneAt(cx, cy, halfW, halfH);
      const spanX = cellW - ROAD_W_M;
      const spanY = cellH - ROAD_W_M;

      if (zone === "core") {
        // Downtown: a tower plus podium blocks on every frontage.
        const towerStoreys = Math.round(pick(14, 44));
        const towerWidth = pick(26, 40);
        const towerDepth = pick(24, 34);
        buildings.push({
          lon: frame.toLon(cx + (random() - 0.5) * 12),
          lat: frame.toLat(cy + (random() - 0.5) * 12),
          width: towerWidth,
          depth: towerDepth,
          height: towerStoreys * STOREY_M,
          rotation: random() < 0.5 ? 0 : Math.PI / 2,
          zone: "core",
        });
        counts.core += 1;
      }

      (["n", "s", "e", "w"] as const).forEach((side) => {
        addLot(cx, cy, zone, side, spanX, spanY, 1);
      });

      // Industrial blocks get a second shed behind the frontage.
      if (zone === "industrial") {
        buildings.push({
          lon: frame.toLon(cx),
          lat: frame.toLat(cy),
          width: pick(34, 56),
          depth: pick(22, 34),
          height: pick(8, 14),
          rotation: 0,
          zone: "industrial",
        });
        counts.industrial += 1;
      }
    }
  }

  // --- Campus buildings ----------------------------------------------------
  const campusLot = (name: string, dx: number, dy: number, w: number, d: number, h: number) => {
    buildings.push({
      lon: frame.toLon(campusX + dx),
      lat: frame.toLat(campusY + dy),
      width: w,
      depth: d,
      height: h,
      rotation: 0,
      zone: "campus",
      name,
    });
    counts.campus += 1;
  };
  campusLot("MITS Main Building", 0, 30, 78, 42, 22);
  campusLot("MITS Library", -95, 30, 34, 28, 16);
  campusLot("MITS Workshop", 95, 26, 42, 30, 12);
  campusLot("MITS Hostel A", -70, -75, 46, 18, 15);
  campusLot("MITS Hostel B", -14, -75, 46, 18, 15);
  campusLot("MITS Hostel C", 42, -75, 46, 18, 15);
  campusLot("MITS Sports Hall", 96, -76, 40, 26, 13);
  areas.push(rectArea(frame, campusX - 60, campusY - 5, campusX + 60, campusY + 55, "park"));

  // --- Trees: parks, forest, lake shore and avenues ------------------------
  areas.forEach((area) => {
    if (area.kind !== "park" && area.kind !== "forest" && area.kind !== "campus") return;
    const count = area.kind === "forest" ? 110 : area.kind === "park" ? 46 : 18;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    area.ring.forEach(([lon, lat]) => {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    });
    for (let i = 0; i < count; i += 1) {
      trees.push({
        lon: minLon + random() * (maxLon - minLon),
        lat: minLat + random() * (maxLat - minLat),
        scale: pick(0.8, 1.5),
      });
    }
  });

  roads.forEach((road) => {
    if (road.kind !== "primary") return;
    const [a, b] = road.line;
    const steps = 26;
    for (let i = 1; i < steps; i += 1) {
      if (random() < 0.45) continue;
      const t = i / steps;
      trees.push({
        lon: a[0] + (b[0] - a[0]) * t,
        lat: a[1] + (b[1] - a[1]) * t,
        scale: pick(0.6, 1.0),
      });
    }
  });

  return { buildings, roads, areas, trees, labels, counts };
}
