import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { AoiBoundary, GeoJsonFeatureCollection } from "../lib/api";
import { markerCount, seededSequence } from "../lib/simulation";
import {
  generateCityFabric,
  sampleParkTrees,
  type FabricKind,
} from "../lib/cityFabric";

/**
 * Virtual City: a schematic 3D rendering of the *actual* ingested OSM geometry.
 * No satellite imagery and no photoreal texturing — the point is to see the
 * street and building structure and how an intervention changes it.
 *
 * Buildings are extruded shells. Where OSM has no height the extrusion is
 * illustrative (3.2 m per storey), flagged in the database as height_source.
 * Trees, waste piles, cars, potholes and the proposed building are schematic
 * shapes, not surveyed objects.
 */

const ILLUSTRATIVE_STOREY_M = 3.2;
const ILLUSTRATIVE_FALLBACK_M = 10;

const TREE_POOL = 150;
const GARBAGE_POOL = 40;
const CAR_POOL = 60;
const POTHOLE_POOL = 40;

const HOLO_CYAN = "#39D5FF";
const HOLO_TEAL = "#35D6B4";
const HOLO_VIOLET = "#8B7CFF";
const RESIDENTIAL = "#7FA8FF";
const CLOSED_RED = "#F87171";
const GARBAGE_AMBER = "#F59E0B";
const PROPOSED = "#FB923C";

/** Muted palette for the synthetic fabric, so surveyed buildings stay readable. */
const FABRIC_COLORS: Record<FabricKind, string> = {
  house: "#5C6B85",
  shop: "#7B7159",
  apartment: "#6E7F97",
  industry: "#5A6070",
};

export interface TwinSimLayer {
  table: string;
  data: GeoJsonFeatureCollection;
}

interface TwinSimProps {
  aoi: AoiBoundary | null;
  layers: TwinSimLayer[];
  center: [number, number];
  trees: number;
  garbageSites: number;
  cars: number;
  potholes: number;
  buildingFloors: number;
  buildingFootprintM2: number;
  closedClass: string;
  closurePercent: number;
  showFabric: boolean;
}

type LonLat = [number, number];

interface TreeModel {
  trunk: Cesium.Entity;
  canopy: Cesium.Entity;
}

function ringToDegrees(ring: unknown[]): number[] {
  const flat: number[] = [];
  ring.forEach((point) => {
    if (Array.isArray(point) && point.length >= 2) {
      flat.push(Number(point[0]), Number(point[1]));
    }
  });
  return flat;
}

function polygonRings(geometry: { type: string; coordinates: unknown } | null): number[][] {
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

/** All line strings in a geometry, as arrays of [lon, lat]. */
function lineStrings(geometry: { type: string; coordinates: unknown } | null): LonLat[][] {
  if (!geometry || !geometry.coordinates) return [];
  const clean = (line: unknown[]): LonLat[] =>
    line
      .filter((point): point is number[] => Array.isArray(point) && point.length >= 2)
      .map((point) => [Number(point[0]), Number(point[1])] as LonLat);

  if (geometry.type === "LineString") return [clean(geometry.coordinates as unknown[])];
  if (geometry.type === "MultiLineString") {
    return (geometry.coordinates as unknown[][]).map(clean);
  }
  return [];
}

function buildingHeight(properties: Record<string, unknown>): number {
  const height = Number(properties.height_m);
  if (Number.isFinite(height) && height > 0) return height;
  const levels = Number(properties.levels);
  if (Number.isFinite(levels) && levels > 0) return levels * ILLUSTRATIVE_STOREY_M;
  return ILLUSTRATIVE_FALLBACK_M;
}

/** Residential / generic OSM footprints are drawn in a second colour. */
function isResidential(properties: Record<string, unknown>): boolean {
  const tag = String(properties.building ?? "").toLowerCase();
  return ["yes", "house", "residential", "apartments", "detached", "terrace"].includes(tag);
}

/**
 * Deterministic positions sampled along the road network, so schematic objects
 * sit on streets and never jump between renders.
 */
function sampleRoadPositions(
  layers: TwinSimLayer[],
  count: number,
  seed: number,
  jitterDeg: number,
): LonLat[] {
  const roads = layers.find((layer) => layer.table === "roads");
  if (!roads || count <= 0) return [];

  const random = seededSequence(seed);
  const positions: LonLat[] = [];
  for (const feature of roads.data.features) {
    for (const line of lineStrings(feature.geometry)) {
      for (const [lon, lat] of line) {
        if (positions.length >= count) return positions;
        if (random() < 0.5) {
          positions.push([
            lon + (random() - 0.5) * jitterDeg,
            lat + (random() - 0.5) * jitterDeg,
          ]);
        }
      }
    }
  }
  return positions;
}

function TwinSim({
  aoi,
  layers,
  center,
  trees,
  garbageSites,
  cars,
  potholes,
  buildingFloors,
  buildingFootprintM2,
  closedClass,
  closurePercent,
  showFabric,
}: TwinSimProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const roadsByClassRef = useRef<Map<string, Cesium.Entity[]>>(new Map());
  const treeModelsRef = useRef<TreeModel[]>([]);
  const garbageModelsRef = useRef<Cesium.Entity[]>([]);
  const carEntitiesRef = useRef<Cesium.Entity[]>([]);
  const potholeEntitiesRef = useRef<Cesium.Entity[]>([]);
  const fabricEntitiesRef = useRef<Cesium.Entity[]>([]);
  const showFabricRef = useRef(showFabric);
  const proposedRef = useRef<Cesium.Entity | null>(null);
  const riskRingRef = useRef<Cesium.Entity | null>(null);
  const homeViewRef = useRef<{ destination: Cesium.Cartesian3; heading: number; pitch: number } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [counts, setCounts] = useState({ buildings: 0, residential: 0, roads: 0 });
  const [fabricCounts, setFabricCounts] = useState<Record<FabricKind, number> | null>(null);

  // Viewer: no imagery at all — a dark void with the geometry floating in it.
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const viewer = new Cesium.Viewer(containerRef.current, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      skyBox: false,
      skyAtmosphere: false,
    });

    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#05070F");
    if (viewer.scene.globe) {
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0B1020");
      viewer.scene.globe.show = true;
    }
    viewer.scene.fog.enabled = false;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 120;
    // Keep the mouse dumb and predictable: left-drag orbits, wheel zooms.
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
    viewerRef.current = viewer;
    setStatus("ready");

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // Static geometry: buildings, roads, green space, AOI, and schematic pools.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready") return;

    viewer.entities.removeAll();
    roadsByClassRef.current = new Map();
    treeModelsRef.current = [];
    garbageModelsRef.current = [];
    carEntitiesRef.current = [];
    potholeEntitiesRef.current = [];
    proposedRef.current = null;
    riskRingRef.current = null;

    let buildingCount = 0;
    let residentialCount = 0;
    let roadCount = 0;

    // Study-area extent, computed before anything needs it.
    const bounds = (() => {
      let west = Infinity;
      let east = -Infinity;
      let south = Infinity;
      let north = -Infinity;
      if (aoi) {
        polygonRings(aoi.geometry).forEach((ring) => {
          for (let i = 0; i < ring.length; i += 2) {
            west = Math.min(west, ring[i]);
            east = Math.max(east, ring[i]);
            south = Math.min(south, ring[i + 1]);
            north = Math.max(north, ring[i + 1]);
          }
        });
      }
      if (!Number.isFinite(west) || !Number.isFinite(south)) {
        return {
          west: center[1] - 0.01,
          east: center[1] + 0.01,
          south: center[0] - 0.01,
          north: center[0] + 0.01,
        };
      }
      return { west, south, east, north };
    })();

    if (aoi) {
      const outline = polygonRings(aoi.geometry)[0];
      if (outline) {
        viewer.entities.add({
          name: "AOI boundary",
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(outline),
            width: 2,
            material: Cesium.Color.WHITE.withAlpha(0.55),
            clampToGround: true,
          },
        });
      }
    }

    layers.forEach(({ table, data }) => {
      if (table === "green_spaces") {
        data.features.forEach((feature) => {
          polygonRings(feature.geometry).forEach((ring) => {
            if (ring.length < 6) return;
            viewer.entities.add({
              name: "Mapped green space",
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(
                  Cesium.Cartesian3.fromDegreesArray(ring),
                ),
                material: Cesium.Color.fromCssColorString(HOLO_TEAL).withAlpha(0.3),
                classificationType: Cesium.ClassificationType.TERRAIN,
              },
            });
          });
        });
        return;
      }

      if (table === "buildings") {
        data.features.forEach((feature) => {
          const properties = feature.properties ?? {};
          const height = buildingHeight(properties);
          const residential = isResidential(properties);
          const tint = residential ? RESIDENTIAL : HOLO_VIOLET;
          polygonRings(feature.geometry).forEach((ring) => {
            if (ring.length < 6) return;
            buildingCount += 1;
            if (residential) residentialCount += 1;
            viewer.entities.add({
              name: String(feature.properties?.name ?? "Building"),
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(
                  Cesium.Cartesian3.fromDegreesArray(ring),
                ),
                height: 0,
                extrudedHeight: height,
                material: Cesium.Color.fromCssColorString(tint).withAlpha(0.35),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString(tint).withAlpha(0.85),
              },
            });
          });
        });
        return;
      }

      if (table === "roads") {
        data.features.forEach((feature) => {
          const properties = feature.properties ?? {};
          const highway = String(properties.highway ?? "unclassified");
          lineStrings(feature.geometry).forEach((line) => {
            if (line.length < 2) return;
            roadCount += 1;
            const entity = viewer.entities.add({
              name: String(properties.name ?? highway),
              polyline: {
                positions: line.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
                width: 1.8,
                material: Cesium.Color.fromCssColorString(HOLO_CYAN).withAlpha(0.8),
                clampToGround: true,
              },
            });
            const bucket = roadsByClassRef.current.get(highway) ?? [];
            bucket.push(entity);
            roadsByClassRef.current.set(highway, bucket);
          });
        });
      }
    });

    // --- Synthetic city fabric: fills the land OSM has not mapped ---
    const fabric = generateCityFabric(layers, bounds, 20261114);
    fabric.blocks.forEach((block) => {
      const position = Cesium.Cartesian3.fromDegrees(
        block.lon,
        block.lat,
        block.height / 2,
      );
      fabricEntitiesRef.current.push(
        viewer.entities.add({
          name: `Synthetic ${block.kind} (not surveyed)`,
          position,
          orientation: Cesium.Transforms.headingPitchRollQuaternion(
            position,
            new Cesium.HeadingPitchRoll(block.rotation, 0, 0),
          ),
          show: showFabricRef.current,
          box: {
            dimensions: new Cesium.Cartesian3(block.width, block.depth, block.height),
            material: Cesium.Color.fromCssColorString(FABRIC_COLORS[block.kind]).withAlpha(0.6),
          },
        }),
      );
    });
    setFabricCounts(fabric.counts);

    // Parks get trees, so mapped green space reads as a park.
    sampleParkTrees(layers, 160).forEach(([lon, lat]) => {
      viewer.entities.add({
        name: "Park tree (schematic)",
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 3),
        ellipsoid: {
          radii: new Cesium.Cartesian3(1.9, 1.9, 2.4),
          material: Cesium.Color.fromCssColorString("#2E9E86").withAlpha(0.85),
        },
      });
    });

    // --- Schematic pools, created once and shown/hidden by the interventions ---

    // Trees: trunk + canopy, so they read as trees rather than dots.
    sampleRoadPositions(layers, TREE_POOL, 20261113, 0.00035).forEach(([lon, lat]) => {
      const trunk = viewer.entities.add({
        name: "Tree trunk",
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 1.1),
        show: false,
        cylinder: {
          length: 2.2,
          topRadius: 0.13,
          bottomRadius: 0.2,
          material: Cesium.Color.fromCssColorString("#8B6B4A"),
        },
      });
      const canopy = viewer.entities.add({
        name: "Tree canopy",
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 3.4),
        show: false,
        ellipsoid: {
          radii: new Cesium.Cartesian3(2.3, 2.3, 2.8),
          material: Cesium.Color.fromCssColorString(HOLO_TEAL).withAlpha(0.92),
        },
      });
      treeModelsRef.current.push({ trunk, canopy });
    });

    // Waste: a low amber pile beside a dark bin, not a dot.
    sampleRoadPositions(layers, GARBAGE_POOL, 771, 0.0006).forEach(([lon, lat]) => {
      garbageModelsRef.current.push(
        viewer.entities.add({
          name: "Waste pile",
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0.6),
          show: false,
          cylinder: {
            length: 1.2,
            topRadius: 0.6,
            bottomRadius: 3.2,
            material: Cesium.Color.fromCssColorString(GARBAGE_AMBER).withAlpha(0.95),
          },
        }),
      );
      garbageModelsRef.current.push(
        viewer.entities.add({
          name: "Waste bin",
          position: Cesium.Cartesian3.fromDegrees(lon + 0.00008, lat, 0.6),
          show: false,
          box: {
            dimensions: new Cesium.Cartesian3(1.4, 1.4, 1.2),
            material: Cesium.Color.fromCssColorString("#5B6478"),
          },
        }),
      );
    });

    sampleRoadPositions(layers, CAR_POOL, 4451, 0.0002).forEach(([lon, lat]) => {
      carEntitiesRef.current.push(
        viewer.entities.add({
          name: "Car",
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0.9),
          show: false,
          box: {
            dimensions: new Cesium.Cartesian3(4.2, 1.8, 1.5),
            material: Cesium.Color.fromCssColorString("#B8C4DA").withAlpha(0.9),
          },
        }),
      );
    });

    sampleRoadPositions(layers, POTHOLE_POOL, 9001, 0.00015).forEach(([lon, lat]) => {
      potholeEntitiesRef.current.push(
        viewer.entities.add({
          name: "Pothole",
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0.08),
          show: false,
          ellipse: {
            semiMajorAxis: 1.1,
            semiMinorAxis: 0.7,
            material: Cesium.Color.fromCssColorString("#11151F"),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#3B4252"),
          },
        }),
      );
    });

    setCounts({ buildings: buildingCount, residential: residentialCount, roads: roadCount });

    // Frame the AOI from its own extent: lookAt pins the bounding sphere centre.
    const rectangle = Cesium.Rectangle.fromDegrees(
      bounds.west,
      bounds.south,
      bounds.east,
      bounds.north,
    );
    const sphere = Cesium.BoundingSphere.fromRectangle3D(rectangle);
    const pitch = Cesium.Math.toRadians(-50);
    viewer.camera.lookAt(
      sphere.center,
      new Cesium.HeadingPitchRange(0, pitch, sphere.radius * 2.7),
    );
    const home = {
      destination: viewer.camera.positionWC.clone(),
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
    };
    homeViewRef.current = home;
    // Releasing the lookAt frame reinterprets the camera's stored position, so
    // the captured world-space pose has to be applied again afterwards.
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    viewer.camera.setView({
      destination: home.destination,
      orientation: { heading: home.heading, pitch: home.pitch, roll: 0 },
    });
  }, [aoi, layers, center, status]);

  // Live intervention updates: cheap property changes only.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready") return;

    const visibleTrees = markerCount(trees, TREE_POOL);
    treeModelsRef.current.forEach((model, index) => {
      const show = index < visibleTrees;
      model.trunk.show = show;
      model.canopy.show = show;
    });

    // Two entities per waste site (pile + bin).
    const visibleGarbage = markerCount(garbageSites, GARBAGE_POOL) * 2;
    garbageModelsRef.current.forEach((entity, index) => {
      entity.show = index < visibleGarbage;
    });

    const visibleCars = markerCount(cars, CAR_POOL);
    carEntitiesRef.current.forEach((entity, index) => {
      entity.show = index < visibleCars;
    });

    const visiblePotholes = markerCount(potholes, POTHOLE_POOL);
    potholeEntitiesRef.current.forEach((entity, index) => {
      entity.show = index < visiblePotholes;
    });

    roadsByClassRef.current.forEach((entities, highway) => {
      const isClosedClass = highway === closedClass;
      entities.forEach((entity, index) => {
        // Deterministic: the first N% of segments in the class are closed.
        const closed = isClosedClass && index % 100 < closurePercent;
        if (!entity.polyline) return;
        entity.polyline.width = new Cesium.ConstantProperty(closed ? 3 : 1.8);
        entity.polyline.material = new Cesium.ColorMaterialProperty(
          Cesium.Color.fromCssColorString(closed ? CLOSED_RED : HOLO_CYAN).withAlpha(
            closed ? 1 : 0.8,
          ),
        );
      });
    });
  }, [trees, garbageSites, cars, potholes, closedClass, closurePercent, status, counts.roads]);

  // Synthetic fabric visibility.
  useEffect(() => {
    showFabricRef.current = showFabric;
    fabricEntitiesRef.current.forEach((entity) => {
      entity.show = showFabric;
    });
  }, [showFabric]);

  // Proposed building: created once, resized live.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready") return;

    const active = buildingFloors > 0 && buildingFootprintM2 > 0;
    if (!active) {
      if (proposedRef.current) proposedRef.current.show = false;
      if (riskRingRef.current) riskRingRef.current.show = false;
      return;
    }

    const side = Math.sqrt(buildingFootprintM2);
    const height = buildingFloors * ILLUSTRATIVE_STOREY_M;
    const lon = center[1];
    const lat = center[0];

    if (!proposedRef.current) {
      proposedRef.current = viewer.entities.add({
        name: "Proposed building",
        position: Cesium.Cartesian3.fromDegrees(lon, lat, height / 2),
        box: {
          dimensions: new Cesium.Cartesian3(side, side, height),
          material: Cesium.Color.fromCssColorString(PROPOSED).withAlpha(0.85),
        },
      });
      riskRingRef.current = viewer.entities.add({
        name: "60 m assessment radius",
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0.2),
        ellipse: {
          semiMajorAxis: 60,
          semiMinorAxis: 60,
          fill: false,
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(PROPOSED).withAlpha(0.7),
        },
      });
    }

    const proposed = proposedRef.current;
    proposed.show = true;
    proposed.position = new Cesium.ConstantPositionProperty(
      Cesium.Cartesian3.fromDegrees(lon, lat, height / 2),
    );
    proposed.box!.dimensions = new Cesium.ConstantProperty(
      new Cesium.Cartesian3(side, side, height),
    );
    if (riskRingRef.current) riskRingRef.current.show = true;
  }, [buildingFloors, buildingFootprintM2, center, status]);

  const resetView = () => {
    const viewer = viewerRef.current;
    const home = homeViewRef.current;
    if (!viewer || !home || !home.destination) return;
    viewer.camera.setView({
      destination: home.destination,
      orientation: { heading: home.heading, pitch: home.pitch, roll: 0 },
    });
  };

  const topView = () => {
    const viewer = viewerRef.current;
    const home = homeViewRef.current;
    if (!viewer || !home) return;
    viewer.camera.setView({
      destination: home.destination,
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-89), roll: 0 },
    });
  };

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {status === "loading" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-3 bg-background/80 text-sm text-muted-foreground">
          <span className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Building the virtual city…
        </div>
      )}

      {/* Simple camera controls — no graphics mouse needed. */}
      <div className="absolute bottom-3 right-3 z-[600] flex flex-col gap-1">
        <button
          type="button"
          onClick={() => viewerRef.current?.camera.zoomIn(300)}
          className="w-8 h-8 rounded-lg border border-border bg-background/90 text-sm hover:bg-secondary"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => viewerRef.current?.camera.zoomOut(300)}
          className="w-8 h-8 rounded-lg border border-border bg-background/90 text-sm hover:bg-secondary"
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => viewerRef.current?.camera.rotateRight(Cesium.Math.toRadians(25))}
          className="w-8 h-8 rounded-lg border border-border bg-background/90 text-xs hover:bg-secondary"
          title="Rotate right"
        >
          ↻
        </button>
        <button
          type="button"
          onClick={() => viewerRef.current?.camera.rotateLeft(Cesium.Math.toRadians(25))}
          className="w-8 h-8 rounded-lg border border-border bg-background/90 text-xs hover:bg-secondary"
          title="Rotate left"
        >
          ↺
        </button>
        <button
          type="button"
          onClick={topView}
          className="w-8 h-8 rounded-lg border border-border bg-background/90 text-[10px] hover:bg-secondary"
          title="Top-down view"
        >
          ⌖
        </button>
        <button
          type="button"
          onClick={resetView}
          className="w-8 h-8 rounded-lg border border-border bg-background/90 text-[10px] hover:bg-secondary"
          title="Reset view"
        >
          ⌂
        </button>
      </div>

      <p className="pointer-events-none absolute bottom-3 left-3 z-[600] text-[10px] text-muted-foreground">
        {counts.buildings} surveyed footprints ({counts.residential} residential/generic) ·{" "}
        {counts.roads} road segments
        {fabricCounts
          ? ` · ${Object.values(fabricCounts).reduce((a, b) => a + b, 0)} synthetic blocks`
          : ""}
        {" "}· drag to look, wheel to zoom
      </p>
    </div>
  );
}

export default TwinSim;
