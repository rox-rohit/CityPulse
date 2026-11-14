import { useEffect, useMemo, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { AoiBoundary } from "../lib/api";
import { markerCount, seededSequence } from "../lib/simulation";
import type { CityPlan, PlanBounds, Zone } from "../lib/cityPlan";

/**
 * Virtual City: a planned, generated city rendered in 3D.
 *
 * This is a synthetic study area, not a survey of any real place. It has a
 * street grid, a downtown core, a mid-rise ring, low-rise housing, an
 * industrial estate, parks, a lake and an MITS campus. Interventions change it
 * live and the impact panel is simulated.
 */

const ZONE_COLORS: Record<Zone, string> = {
  core: "#6C7BFF",
  midtown: "#4E7FD1",
  residential: "#C2A184",
  industrial: "#9B6BD6",
  campus: "#2FBF9E",
  park: "#3FA96F",
};

const ZONE_ALPHA: Record<Zone, number> = {
  core: 0.72,
  midtown: 0.6,
  residential: 0.62,
  industrial: 0.66,
  campus: 0.6,
  park: 0.5,
};

const CLOSED_RED = "#F87171";
const AVENUE = "#8FA3C4";
const STREET = "#4C5A72";
const PROPOSED = "#FB923C";

const CAR_POOL = 60;
const POTHOLE_POOL = 40;
const TREE_POOL = 140;
const GARBAGE_POOL = 36;

interface TwinSimProps {
  plan: CityPlan;
  aoi: AoiBoundary | null;
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
type RoadEntity = { entity: Cesium.Entity; kind: string };

/** Deterministic positions sampled along the generated avenues and streets. */
function sampleRoadPositions(
  roads: Array<{ line: LonLat[]; kind: string }>,
  count: number,
  seed: number,
  jitterDeg: number,
): LonLat[] {
  const random = seededSequence(seed);
  const positions: LonLat[] = [];
  roads.forEach((road) => {
    for (let i = 1; i < road.line.length; i += 1) {
      const [lonA, latA] = road.line[i - 1];
      const [lonB, latB] = road.line[i];
      const steps = 22;
      for (let step = 0; step < steps && positions.length < count; step += 1) {
        if (random() < 0.55) continue;
        const t = step / steps;
        positions.push([
          lonA + (lonB - lonA) * t + (random() - 0.5) * jitterDeg,
          latA + (latB - latA) * t + (random() - 0.5) * jitterDeg,
        ]);
      }
    }
  });
  return positions;
}

function TwinSim({
  plan,
  aoi,
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
  const roadEntitiesRef = useRef<RoadEntity[]>([]);
  const buildingEntitiesRef = useRef<Cesium.Entity[]>([]);
  const treeModelsRef = useRef<Cesium.Entity[]>([]);
  const garbageModelsRef = useRef<Cesium.Entity[]>([]);
  const carEntitiesRef = useRef<Cesium.Entity[]>([]);
  const potholeEntitiesRef = useRef<Cesium.Entity[]>([]);
  const proposedRef = useRef<Cesium.Entity | null>(null);
  const riskRingRef = useRef<Cesium.Entity | null>(null);
  const homeViewRef = useRef<{
    destination: Cesium.Cartesian3;
    heading: number;
    pitch: number;
  } | null>(null);
  const showFabricRef = useRef(showFabric);
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  const bounds = useMemo<PlanBounds>(() => {
    if (aoi) {
      let west = Infinity;
      let east = -Infinity;
      let south = Infinity;
      let north = -Infinity;
      const walk = (ring: unknown[]) => {
        const flat = ring as number[][];
        flat.forEach((point) => {
          if (!Array.isArray(point) || point.length < 2) return;
          west = Math.min(west, Number(point[0]));
          east = Math.max(east, Number(point[0]));
          south = Math.min(south, Number(point[1]));
          north = Math.max(north, Number(point[1]));
        });
      };
      const geometry = aoi.geometry as { type: string; coordinates: unknown };
      if (geometry.type === "Polygon") {
        (geometry.coordinates as unknown[][])[0].forEach(walk);
      } else if (geometry.type === "MultiPolygon") {
        (geometry.coordinates as unknown[][][])[0]?.[0]?.length &&
          walk((geometry.coordinates as unknown[][][])[0][0]);
      }
      if (Number.isFinite(west)) return { west, south, east, north };
    }
    return {
      west: center[1] - 0.011,
      east: center[1] + 0.011,
      south: center[0] - 0.01,
      north: center[0] + 0.01,
    };
  }, [aoi, center]);

  // Viewer: no imagery at all — a dark void with the city floating in it.
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
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 60;
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
    viewerRef.current = viewer;
    setStatus("ready");

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // Geometry: ground, streets, districts, buildings, trees, schematic pools.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready") return;

    viewer.entities.removeAll();
    roadEntitiesRef.current = [];
    buildingEntitiesRef.current = [];
    treeModelsRef.current = [];
    garbageModelsRef.current = [];
    carEntitiesRef.current = [];
    potholeEntitiesRef.current = [];
    proposedRef.current = null;
    riskRingRef.current = null;

    // Ground plate for the whole study area.
    const ground = [
      bounds.west, bounds.south,
      bounds.east, bounds.south,
      bounds.east, bounds.north,
      bounds.west, bounds.north,
      bounds.west, bounds.south,
    ];
    viewer.entities.add({
      name: "Ground",
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ground)),
        height: 0,
        material: Cesium.Color.fromCssColorString("#0E1424"),
      },
    });

    // District surfaces: parks, forest, lake, campus and industrial apron.
    plan.areas.forEach((area) => {
      const flat = area.ring.flatMap(([lon, lat]) => [lon, lat]);
      if (flat.length < 6) return;
      const color =
        area.kind === "lake"
          ? "#1D5C8A"
          : area.kind === "forest"
            ? "#1F5B3A"
            : area.kind === "campus"
              ? "#14513F"
              : area.kind === "industrial"
                ? "#3B2C4F"
                : "#1F5A3E";
      viewer.entities.add({
        name: `District: ${area.kind}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)),
          height: 0.4,
          material: Cesium.Color.fromCssColorString(color).withAlpha(
            area.kind === "lake" ? 0.9 : 0.55,
          ),
        },
      });
    });

    // Streets.
    plan.roads.forEach((road) => {
      const positions = road.line.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
      const entity = viewer.entities.add({
        name: road.kind === "primary" ? "Avenue" : "Street",
        polyline: {
          positions,
          width: road.kind === "primary" ? 6 : 2.5,
          material: Cesium.Color.fromCssColorString(road.kind === "primary" ? AVENUE : STREET),
          clampToGround: true,
        },
      });
      roadEntitiesRef.current.push({ entity, kind: road.kind });
    });

    // Buildings, coloured by district.
    plan.buildings.forEach((building) => {
      const position = Cesium.Cartesian3.fromDegrees(
        building.lon,
        building.lat,
        building.height / 2,
      );
      const entity = viewer.entities.add({
        name: building.name ?? `${building.zone} building`,
        position,
        orientation: Cesium.Transforms.headingPitchRollQuaternion(
          position,
          new Cesium.HeadingPitchRoll(building.rotation, 0, 0),
        ),
        show: showFabricRef.current,
        box: {
          dimensions: new Cesium.Cartesian3(building.width, building.depth, building.height),
          material: Cesium.Color.fromCssColorString(ZONE_COLORS[building.zone]).withAlpha(
            ZONE_ALPHA[building.zone],
          ),
        },
      });
      buildingEntitiesRef.current.push(entity);
    });

    // Place labels.
    plan.labels.forEach((label) => {
      viewer.entities.add({
        name: label.text,
        position: Cesium.Cartesian3.fromDegrees(label.lon, label.lat, 40),
        label: {
          text: label.text,
          font: "600 15px Inter, system-ui, sans-serif",
          fillColor: Cesium.Color.WHITE.withAlpha(0.92),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -8),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scale: 0.9,
        },
      });
    });

    // Park, forest and avenue trees.
    plan.trees.forEach((tree) => {
      viewer.entities.add({
        name: "Tree",
        position: Cesium.Cartesian3.fromDegrees(tree.lon, tree.lat, 2.6 * tree.scale),
        ellipsoid: {
          radii: new Cesium.Cartesian3(2.0 * tree.scale, 2.0 * tree.scale, 2.6 * tree.scale),
          material: Cesium.Color.fromCssColorString("#2E9E86").withAlpha(0.9),
        },
      });
    });

    // --- Schematic pools, shown by the interventions ---
    sampleRoadPositions(plan.roads, TREE_POOL, 20261113, 0.00018).forEach(([lon, lat]) => {
      treeModelsRef.current.push(
        viewer.entities.add({
          name: "Planted tree",
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 3.2),
          show: false,
          ellipsoid: {
            radii: new Cesium.Cartesian3(2.2, 2.2, 2.7),
            material: Cesium.Color.fromCssColorString("#35D6B4"),
          },
        }),
      );
    });

    sampleRoadPositions(plan.roads, GARBAGE_POOL, 771, 0.0004).forEach(([lon, lat]) => {
      garbageModelsRef.current.push(
        viewer.entities.add({
          name: "Waste pile",
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0.6),
          show: false,
          cylinder: {
            length: 1.2,
            topRadius: 0.6,
            bottomRadius: 3.2,
            material: Cesium.Color.fromCssColorString("#F59E0B"),
          },
        }),
      );
    });

    sampleRoadPositions(plan.roads, CAR_POOL, 4451, 0.00012).forEach(([lon, lat]) => {
      carEntitiesRef.current.push(
        viewer.entities.add({
          name: "Car",
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0.9),
          show: false,
          box: {
            dimensions: new Cesium.Cartesian3(4.2, 1.8, 1.5),
            material: Cesium.Color.fromCssColorString("#B8C4DA"),
          },
        }),
      );
    });

    sampleRoadPositions(plan.roads, POTHOLE_POOL, 9001, 0.0001).forEach(([lon, lat]) => {
      potholeEntitiesRef.current.push(
        viewer.entities.add({
          name: "Pothole",
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0.25),
          show: false,
          ellipse: {
            semiMajorAxis: 1.1,
            semiMinorAxis: 0.7,
            material: Cesium.Color.fromCssColorString("#11151F"),
          },
        }),
      );
    });

    // Camera: frame the whole study area from the south.
    const rectangle = Cesium.Rectangle.fromDegrees(
      bounds.west,
      bounds.south,
      bounds.east,
      bounds.north,
    );
    const sphere = Cesium.BoundingSphere.fromRectangle3D(rectangle);
    viewer.camera.lookAt(
      sphere.center,
      new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-42), sphere.radius * 2.2),
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
  }, [plan, bounds, status]);

  // Live interventions.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready") return;

    const visibleTrees = markerCount(trees, TREE_POOL);
    treeModelsRef.current.forEach((entity, index) => {
      entity.show = index < visibleTrees;
    });

    const visibleGarbage = markerCount(garbageSites, GARBAGE_POOL);
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

    roadEntitiesRef.current.forEach(({ entity, kind }, index) => {
      const isClosedClass = kind === closedClass;
      const closed = isClosedClass && index % 100 < closurePercent;
      if (!entity.polyline) return;
      const base = kind === "primary" ? AVENUE : STREET;
      entity.polyline.width = new Cesium.ConstantProperty(
        closed ? 6 : kind === "primary" ? 6 : 2.5,
      );
      entity.polyline.material = new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString(closed ? CLOSED_RED : base),
      );
    });
  }, [trees, garbageSites, cars, potholes, closedClass, closurePercent, status, plan]);

  // Building visibility.
  useEffect(() => {
    showFabricRef.current = showFabric;
    buildingEntitiesRef.current.forEach((entity) => {
      entity.show = showFabric;
    });
  }, [showFabric]);

  // Proposed building, resized live.
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
    const height = buildingFloors * 3.2;
    const lon = center[1];
    const lat = center[0];

    if (!proposedRef.current) {
      proposedRef.current = viewer.entities.add({
        name: "Proposed building",
        position: Cesium.Cartesian3.fromDegrees(lon, lat, height / 2),
        box: {
          dimensions: new Cesium.Cartesian3(side, side, height),
          material: Cesium.Color.fromCssColorString(PROPOSED).withAlpha(0.9),
        },
      });
      riskRingRef.current = viewer.entities.add({
        name: "60 m assessment radius",
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0.5),
        ellipse: {
          semiMajorAxis: 60,
          semiMinorAxis: 60,
          fill: false,
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(PROPOSED).withAlpha(0.8),
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
    if (!viewer || !home) return;
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

      <div className="absolute bottom-3 right-3 z-[600] flex flex-col gap-1">
        <button
          type="button"
          onClick={() => viewerRef.current?.camera.zoomIn(250)}
          className="w-8 h-8 rounded-lg border border-border bg-background/90 text-sm hover:bg-secondary"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => viewerRef.current?.camera.zoomOut(250)}
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
        {plan.buildings.length} generated buildings · {plan.roads.length} streets ·{" "}
        {plan.trees.length} trees · drag to look, wheel to zoom
      </p>
    </div>
  );
}

export default TwinSim;
