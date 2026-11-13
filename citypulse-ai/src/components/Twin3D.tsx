import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { AoiBoundary, GeoJsonFeatureCollection } from "../lib/api";

/** Storey height used only when a building has no OSM height tag. */
const ILLUSTRATIVE_STOREY_M = 3.2;
const ILLUSTRATIVE_FALLBACK_M = 10;

export interface Twin3DLayer {
  table: string;
  data: GeoJsonFeatureCollection;
}

interface Twin3DProps {
  aoi: AoiBoundary | null;
  layers: Twin3DLayer[];
  center: [number, number];
}

type LonLat = [number, number];

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

function linePositions(geometry: { type: string; coordinates: unknown } | null): Cesium.Cartesian3[][] {
  if (!geometry || !geometry.coordinates) return [];
  const toPositions = (line: unknown[]) =>
    line
      .filter((point): point is number[] => Array.isArray(point) && point.length >= 2)
      .map((point) => Cesium.Cartesian3.fromDegrees(Number(point[0]), Number(point[1])));

  if (geometry.type === "LineString") {
    return [toPositions(geometry.coordinates as unknown[])];
  }
  if (geometry.type === "MultiLineString") {
    return (geometry.coordinates as unknown[][]).map(toPositions);
  }
  return [];
}

function buildingHeight(properties: Record<string, unknown>): { height: number; illustrative: boolean } {
  const height = Number(properties.height_m);
  if (Number.isFinite(height) && height > 0) {
    return { height, illustrative: false };
  }
  const levels = Number(properties.levels);
  if (Number.isFinite(levels) && levels > 0) {
    return { height: levels * ILLUSTRATIVE_STOREY_M, illustrative: true };
  }
  return { height: ILLUSTRATIVE_FALLBACK_M, illustrative: true };
}

function Twin3D({ aoi, layers, center }: Twin3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [taggedHeights, setTaggedHeights] = useState(0);
  const [illustrativeHeights, setIllustrativeHeights] = useState(0);

  // Create the viewer once.
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const viewer = new Cesium.Viewer(containerRef.current, {
      // CORS-enabled imagery: standard OSM tiles cannot be used as WebGL
      // textures because they do not send Access-Control-Allow-Origin.
      baseLayer: new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({
          url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 19,
          credit: "Imagery © Esri, Maxar, Earthstar Geographics",
        }),
      ),
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
    });

    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0B1020");
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.fog.enabled = true;
    viewerRef.current = viewer;
    setStatus("ready");

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // Add ingested geometry and frame the AOI.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready") return;

    viewer.entities.removeAll();
    let tagged = 0;
    let illustrative = 0;

    if (aoi) {
      const rings = polygonRings(aoi.geometry);
      const outline = rings[0];
      if (outline) {
        viewer.entities.add({
          name: "AOI boundary",
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(outline),
            width: 2,
            material: Cesium.Color.WHITE.withAlpha(0.75),
            clampToGround: true,
          },
        });
      }
    }

    layers.forEach(({ table, data }) => {
      data.features.forEach((feature) => {
        const properties = feature.properties ?? {};

        if (table === "buildings") {
          const { height, illustrative: isIllustrative } = buildingHeight(properties);
          if (isIllustrative) illustrative += 1;
          else tagged += 1;
          const base = isIllustrative ? 0.55 : 0.8;
          polygonRings(feature.geometry).forEach((ring) => {
            if (ring.length < 6) return;
            viewer.entities.add({
              name: String(properties.name ?? properties.building ?? "Building"),
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(
                  Cesium.Cartesian3.fromDegreesArray(ring),
                ),
                height: 0,
                extrudedHeight: height,
                material: Cesium.Color.fromHsl(0.68, 0.55, base, 0.9),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString("#0B1020").withAlpha(0.6),
              },
            });
          });
          return;
        }

        if (table === "roads") {
          linePositions(feature.geometry).forEach((positions) => {
            viewer.entities.add({
              name: String(properties.name ?? "Road"),
              polyline: {
                positions,
                width: 2,
                material: Cesium.Color.fromCssColorString("#39D5FF").withAlpha(0.85),
                clampToGround: true,
              },
            });
          });
          return;
        }

        if (table === "facilities" && feature.geometry?.type === "Point") {
          const [lon, lat] = feature.geometry.coordinates as LonLat;
          viewer.entities.add({
            name: String(properties.name ?? properties.amenity ?? "Facility"),
            position: Cesium.Cartesian3.fromDegrees(lon, lat, 6),
            point: {
              pixelSize: 8,
              color: Cesium.Color.fromCssColorString("#35D6B4"),
              outlineColor: Cesium.Color.fromCssColorString("#0B1020"),
              outlineWidth: 2,
              heightReference: Cesium.HeightReference.NONE,
            },
          });
          return;
        }

        if (table === "green_spaces") {
          polygonRings(feature.geometry).forEach((ring) => {
            if (ring.length < 6) return;
            viewer.entities.add({
              name: String(properties.name ?? "Green space"),
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(
                  Cesium.Cartesian3.fromDegreesArray(ring),
                ),
                material: Cesium.Color.fromCssColorString("#35D6B4").withAlpha(0.45),
                classificationType: Cesium.ClassificationType.TERRAIN,
              },
            });
          });
        }
      });
    });

    setTaggedHeights(tagged);
    setIllustrativeHeights(illustrative);

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(center[1], center[0], 1350),
      orientation: {
        heading: Cesium.Math.toRadians(18),
        pitch: Cesium.Math.toRadians(-45),
        roll: 0,
      },
    });
  }, [aoi, layers, center, status]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {status === "loading" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-3 bg-background/80 text-sm text-muted-foreground">
          <span className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Starting 3D viewer…
        </div>
      )}
      <div className="absolute top-3 left-3 z-10 rounded-lg border border-border bg-background/90 px-3 py-2 text-[11px]">
        <p className="text-primary font-medium mb-1">3D buildings</p>
        <p className="text-muted-foreground">
          {taggedHeights} with OSM height · {illustrativeHeights} illustrative
        </p>
        <p className="text-muted-foreground mt-1">
          Illustrative extrusion uses {ILLUSTRATIVE_STOREY_M} m per storey.
        </p>
      </div>
    </div>
  );
}

export default Twin3D;
