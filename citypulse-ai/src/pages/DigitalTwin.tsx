import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import type { GeoJsonObject } from "geojson";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, type AoiBoundary, type GeoJsonFeatureCollection, type LayerInfo, type Summary } from "../lib/api";
import {
  DEFAULT_PM25_COEFFICIENT,
  TREE_CANOPY_M2,
  simulateInterventions,
  type Interventions,
  type SimBaseline,
  type SimContext,
} from "../lib/simulation";

const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const DEFAULT_CENTER: [number, number] = [26.2205, 78.18];

// Cesium is heavy, so the 3D and virtual-city scenes are only downloaded when requested.
const Twin3D = lazy(() => import("../components/Twin3D"));
const TwinSim = lazy(() => import("../components/TwinSim"));

const LAYER_STYLE: Record<string, L.PathOptions> = {
  roads: { color: "#39D5FF", weight: 1.7, opacity: 0.85 },
  buildings: { color: "#8B7CFF", weight: 0.5, fillColor: "#8B7CFF", fillOpacity: 0.35 },
  facilities: { color: "#35D6B4", weight: 1 },
  green_spaces: { color: "#35D6B4", weight: 0.8, fillColor: "#35D6B4", fillOpacity: 0.45 },
};

const LAYER_LABEL: Record<string, string> = {
  roads: "Roads",
  buildings: "Buildings",
  facilities: "Facilities",
  green_spaces: "Green spaces",
};

type LoadedLayer = { info: LayerInfo; data: GeoJsonFeatureCollection };
type Selection = { layer: string; properties: Record<string, unknown> } | null;

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

function MapView({
  center,
  zoom,
  resetKey,
}: {
  center: [number, number];
  zoom: number;
  resetKey: number;
}) {
  const map = useMap();
  useEffect(() => {
    // The container can be resized by the layout after mount, which leaves
    // Leaflet with a stale size and an off-centre view; resync on each reset.
    const apply = () => {
      map.invalidateSize();
      map.setView(center, zoom, { animate: false });
    };
    apply();
    const timer = window.setTimeout(apply, 300);
    return () => window.clearTimeout(timer);
  }, [center, zoom, resetKey, map]);
  return null;
}

function DigitalTwin() {
  const [layers, setLayers] = useState<LoadedLayer[]>([]);
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [aoi, setAoi] = useState<AoiBoundary | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [viewMode, setViewMode] = useState<"2d" | "3d" | "sim">("2d");

  // Virtual City interventions and the real baseline they are applied to.
  const [baseline, setBaseline] = useState<SimBaseline | null>(null);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [interventions, setInterventions] = useState<Interventions>({
    trees: 0,
    garbageSites: 0,
    carsAdded: 0,
    potholes: 0,
    blockedDrains: 0,
    closedClass: "secondary",
    closurePercent: 0,
    pm25Coefficient: DEFAULT_PM25_COEFFICIENT,
    buildingFloors: 0,
    buildingFootprintM2: 400,
  });
  const [showFabric, setShowFabric] = useState(true);
  const baselineRequested = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setStatus("loading");
    setError(null);
    setWarnings([]);
    try {
      const [layerIndex, aoiFeature, summaryData] = await Promise.all([
        api.layers(signal),
        api.aoi(signal),
        api.summary(signal),
      ]);
      setAoi(aoiFeature);
      setSummary(summaryData);

      const settled = await Promise.allSettled(
        layerIndex.map((info) => api.layerGeoJson(info.id, signal)),
      );
      const loaded: LoadedLayer[] = [];
      const problems: string[] = [];
      settled.forEach((result, index) => {
        const info = layerIndex[index];
        if (result.status === "fulfilled") {
          loaded.push({ info, data: result.value });
        } else {
          problems.push(`${info.name}: ${result.reason instanceof Error ? result.reason.message : "failed to load"}`);
        }
      });

      setLayers(loaded);
      setVisible(
        loaded.reduce<Record<string, boolean>>((acc, layer) => {
          acc[layer.info.table_name] = true;
          return acc;
        }, {}),
      );
      setWarnings(problems);
      setStatus("ready");
    } catch (loadError) {
      if ((loadError as Error).name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Failed to load geographic data");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Baseline for the simulation, fetched only when the virtual city is opened.
  useEffect(() => {
    if (viewMode !== "sim" || baselineRequested.current) return;
    baselineRequested.current = true;
    const controller = new AbortController();

    (async () => {
      try {
        const [green, network, environment] = await Promise.all([
          api.greenCover(controller.signal),
          api.network(controller.signal),
          api.environmentOverview(14, controller.signal),
        ]);
        const pm25 = environment.air_quality.pollutants.find((item) => item.variable === "pm2_5");
        setBaseline({
          aoiAreaHa: green.aoi_area_ha,
          greenHa: green.mapped_green_area_ha,
          greenSharePercent: green.mapped_share_of_aoi_percent ?? 0,
          roadKm: network.total_length_km,
          roadByClass: network.by_class,
          pm25Mean24h: pm25?.mean_24h ?? null,
        });
        setBaselineError(null);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        baselineRequested.current = false;
        setBaselineError(
          error instanceof Error ? error.message : "Failed to load the simulation baseline",
        );
      }
    })();

    return () => controller.abort();
  }, [viewMode]);

  // Real neighbours of the build site, measured from the loaded footprints.
  const buildContext = useMemo<SimContext>(() => {
    const buildings =
      layers.find((layer) => layer.info.table_name === "buildings")?.data.features ?? [];
    // Same centre the map camera uses, derived directly so this memo does not
    // depend on a later declaration.
    const [minLon, minLat, maxLon, maxLat] = summary?.aoi?.bbox ?? [78.17, 26.21, 78.19, 26.23];
    const lat0 = (minLat + maxLat) / 2;
    const lon0 = (minLon + maxLon) / 2;
    let count = 0;
    let floorsSum = 0;

    buildings.forEach((feature) => {
      const geometry = feature.geometry as { type?: string; coordinates?: unknown } | null;
      const firstRing =
        geometry?.type === "Polygon"
          ? (geometry.coordinates as unknown[][])[0]
          : geometry?.type === "MultiPolygon"
            ? (geometry.coordinates as unknown[][][])[0]?.[0]
            : null;
      if (!Array.isArray(firstRing) || firstRing.length < 3) return;

      const sum = firstRing.reduce(
        (acc, point) => {
          const pair = point as number[];
          return [acc[0] + Number(pair[0]), acc[1] + Number(pair[1])];
        },
        [0, 0],
      );
      const lon = sum[0] / firstRing.length;
      const lat = sum[1] / firstRing.length;
      const dx = (lon - lon0) * 111_320 * Math.cos((lat0 * Math.PI) / 180);
      const dy = (lat - lat0) * 110_540;
      if (Math.hypot(dx, dy) > 60) return;

      const properties = feature.properties ?? {};
      const levels = Number(properties.levels);
      const height = Number(properties.height_m);
      count += 1;
      floorsSum += Number.isFinite(levels) && levels > 0
        ? levels
        : Number.isFinite(height) && height > 0
          ? height / 3.2
          : 1;
    });

    return {
      nearbyBuildings: count,
      nearbyAverageFloors: count > 0 ? floorsSum / count : 0,
    };
  }, [layers, summary]);

  const simResult = useMemo(
    () => (baseline ? simulateInterventions(baseline, interventions, buildContext) : null),
    [baseline, interventions, buildContext],
  );

  const view = useMemo(() => {
    if (!summary?.aoi) {
      return { center: DEFAULT_CENTER, zoom: 14 };
    }
    const [minLon, minLat, maxLon, maxLat] = summary.aoi.bbox;
    return {
      center: [(minLat + maxLat) / 2, (minLon + maxLon) / 2] as [number, number],
      zoom: 14,
    };
  }, [summary]);

  const totals = useMemo(
    () =>
      layers.reduce<Record<string, number>>((acc, layer) => {
        acc[layer.info.table_name] = layer.data.features.length;
        return acc;
      }, {}),
    [layers],
  );

  const toggle = (tableName: string) =>
    setVisible((current) => ({ ...current, [tableName]: !current[tableName] }));

  const styleFor = (tableName: string): L.PathOptions => LAYER_STYLE[tableName] ?? { color: "#39D5FF" };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <header className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-accent-cyan/80 mb-1">Digital Twin</p>
            <h1 className="text-2xl md:text-3xl font-semibold">
              {summary?.aoi ? summary.aoi.name : "Maharaj Bada study area"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {summary?.aoi
                ? `${summary.aoi.city}, ${summary.aoi.state} · ${summary.aoi.area_km2} km² · geometry from OpenStreetMap`
                : "Loading ingested geometry from PostGIS"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex rounded-lg border border-border overflow-hidden mr-2">
              {(["2d", "3d", "sim"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 uppercase tracking-wide ${
                    viewMode === mode
                      ? "bg-primary text-background font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode === "sim" ? "Virtual city" : mode}
                </button>
              ))}
            </div>
            {(["roads", "buildings", "facilities", "green_spaces"] as const).map((key) => (
              <span
                key={key}
                className="px-3 py-1.5 rounded-lg bg-secondary border border-border"
                title={`${LAYER_LABEL[key]} ingested inside the AOI`}
              >
                <span className="text-muted-foreground">{LAYER_LABEL[key]}: </span>
                <span className="font-medium text-foreground">{totals[key] ?? "—"}</span>
              </span>
            ))}
          </div>
        </header>

        {warnings.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Some layers could not be loaded: {warnings.join("; ")}
          </div>
        )}

        <div className="relative rounded-xl overflow-hidden border border-border h-[calc(100vh-14rem)] min-h-[26rem] bg-secondary">
          {status === "error" && (
            <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-3 p-6 text-center bg-background/95">
              <h2 className="text-lg font-medium text-red-400">Geographic data unavailable</h2>
              <p className="text-sm text-muted-foreground max-w-lg">{error}</p>
              <p className="text-xs text-muted-foreground max-w-lg">
                Start the backend with <code className="text-accent-cyan">uvicorn app:app --port 8000</code>{" "}
                and make sure the ingestion pipeline has run.
              </p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-2 px-4 py-2 rounded-lg bg-primary text-background text-sm font-medium hover:opacity-90"
              >
                Retry
              </button>
            </div>
          )}

          {status === "loading" && (
            <div className="absolute inset-0 z-[500] flex items-center justify-center gap-3 bg-background/80 text-sm text-muted-foreground">
              <span className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              Loading layers from PostGIS…
            </div>
          )}

          {viewMode === "3d" ? (
            <Suspense
              fallback={
                <div className="absolute inset-0 flex items-center justify-center gap-3 text-sm text-muted-foreground">
                  <span className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  Loading 3D engine…
                </div>
              }
            >
              <Twin3D
                aoi={aoi}
                center={view.center}
                layers={layers.map((layer) => ({ table: layer.info.table_name, data: layer.data }))}
              />
            </Suspense>
          ) : viewMode === "sim" ? (
            <Suspense
              fallback={
                <div className="absolute inset-0 flex items-center justify-center gap-3 text-sm text-muted-foreground">
                  <span className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  Building the virtual city…
                </div>
              }
            >
              <TwinSim
                aoi={aoi}
                center={view.center}
                layers={layers.map((layer) => ({ table: layer.info.table_name, data: layer.data }))}
                trees={interventions.trees}
                garbageSites={interventions.garbageSites}
                cars={interventions.carsAdded}
                potholes={interventions.potholes}
                buildingFloors={interventions.buildingFloors}
                buildingFootprintM2={interventions.buildingFootprintM2}
                closedClass={interventions.closedClass}
                closurePercent={interventions.closurePercent}
                showFabric={showFabric}
              />
            </Suspense>
          ) : (
          <MapContainer
            center={view.center}
            zoom={view.zoom}
            scrollWheelZoom
            style={{ height: "100%", width: "100%", background: "#0B1020" }}
          >
            <TileLayer url={OSM_TILES} attribution={OSM_ATTRIBUTION} maxZoom={19} />
            <MapView center={view.center} zoom={view.zoom} resetKey={resetKey} />

            {aoi && (
              <GeoJSON
                data={aoi as unknown as GeoJsonObject}
                style={{ color: "#F4F7FC", weight: 1.5, dashArray: "6 6", fill: false, opacity: 0.7 }}
                interactive={false}
              />
            )}

            {layers.map(({ info, data }) => {
              if (!visible[info.table_name]) return null;
              const isPoint = info.table_name === "facilities";
              return (
                <GeoJSON
                  key={`${info.id}-${data.features.length}`}
                  data={data as unknown as GeoJsonObject}
                  style={() => styleFor(info.table_name)}
                  pointToLayer={(_feature, latlng) =>
                    L.circleMarker(latlng, {
                      radius: 5,
                      color: "#0B1020",
                      weight: 1,
                      fillColor: "#35D6B4",
                      fillOpacity: 0.95,
                    })
                  }
                  onEachFeature={(feature, layer) => {
                    const properties = (feature.properties ?? {}) as Record<string, unknown>;
                    const title = String(
                      properties.name ?? properties.highway ?? properties.amenity ?? properties.building ?? LAYER_LABEL[info.table_name] ?? "Feature",
                    );
                    layer.bindTooltip(title, { direction: "top", opacity: 0.9 });
                    layer.on("click", () => setSelection({ layer: info.table_name, properties }));
                    if (!isPoint) {
                      layer.on("mouseover", () => (layer as L.Path).setStyle({ weight: 3 }));
                      layer.on("mouseout", () => (layer as L.Path).setStyle(styleFor(info.table_name)));
                    }
                  }}
                />
              );
            })}
          </MapContainer>
          )}

          {/* Layer control */}
          {viewMode === "2d" && (
          <div className="absolute top-3 right-3 z-[600] w-52 rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-2 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Layers</p>
              <button
                type="button"
                onClick={() => setResetKey((key) => key + 1)}
                className="text-[11px] text-primary hover:underline"
              >
                Reset view
              </button>
            </div>
            <ul className="space-y-1.5">
              {layers.map(({ info }) => (
                <li key={info.id}>
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={Boolean(visible[info.table_name])}
                      onChange={() => toggle(info.table_name)}
                      className="accent-[#39D5FF]"
                    />
                    <span
                      className="w-2.5 h-2.5 rounded-sm"
                      style={{ background: (styleFor(info.table_name).color as string) ?? "#39D5FF" }}
                    />
                    <span className="flex-1">{LAYER_LABEL[info.table_name] ?? info.name}</span>
                    <span className="text-muted-foreground">{totals[info.table_name] ?? 0}</span>
                  </label>
                </li>
              ))}
            </ul>
            {layers.length === 0 && status === "ready" && (
              <p className="text-xs text-muted-foreground">No layers ingested yet.</p>
            )}
          </div>
          )}

          {/* Feature inspector */}
          {selection && viewMode === "2d" && (
            <div className="absolute bottom-3 left-3 z-[600] w-72 max-h-64 overflow-auto rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-2 shadow-lg">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {LAYER_LABEL[selection.layer] ?? selection.layer}
                </p>
                <button
                  type="button"
                  onClick={() => setSelection(null)}
                  className="text-muted-foreground hover:text-foreground text-xs"
                  aria-label="Close feature details"
                >
                  ✕
                </button>
              </div>
              <dl className="space-y-1 text-xs">
                {Object.entries(selection.properties)
                  .filter(([key]) => key !== "osm_id")
                  .slice(0, 12)
                  .map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <dt className="text-muted-foreground w-28 shrink-0">{key}</dt>
                      <dd className="text-foreground break-words">{formatValue(value)}</dd>
                    </div>
                  ))}
                {"osm_id" in selection.properties && (
                  <div className="flex gap-2 pt-1 border-t border-border mt-1">
                    <dt className="text-muted-foreground w-28 shrink-0">OSM id</dt>
                    <dd className="text-foreground">{formatValue(selection.properties.osm_id)}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          {/* Virtual City: simulated impact readout */}
          {viewMode === "sim" && (
            <div className="absolute top-3 left-3 z-[600] w-64 max-h-[calc(100%-1.5rem)] overflow-auto rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-2 shadow-lg">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Simulated impact
                </p>
                <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                  simulated
                </span>
              </div>

              {baselineError && <p className="text-xs text-red-400">{baselineError}</p>}
              {!baseline && !baselineError && (
                <p className="text-xs text-muted-foreground">Loading baseline values…</p>
              )}

              {baseline && simResult && (
                <>
                  <dl className="space-y-1.5 text-xs">
                    <div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Canopy added</dt>
                        <dd className="text-foreground">+{simResult.canopyHa.toFixed(2)} ha</dd>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {interventions.trees.toLocaleString()} trees × {TREE_CANOPY_M2} m²
                      </p>
                    </div>
                    <div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Green share of AOI</dt>
                        <dd className="text-foreground">
                          {baseline.greenSharePercent.toFixed(2)}% →{" "}
                          {simResult.newSharePercent.toFixed(2)}%
                        </dd>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        baseline {baseline.greenHa.toFixed(1)} ha of {baseline.aoiAreaHa.toFixed(0)} ha
                      </p>
                    </div>
                    <div className="border-t border-border pt-1.5">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">PM2.5 (modelled baseline)</dt>
                        <dd className="text-foreground">
                          {simResult.pm25Projected !== null
                            ? `${simResult.pm25Projected.toFixed(1)} µg/m³`
                            : "unavailable"}
                        </dd>
                      </div>
                      <p className="text-[10px] text-amber-300">
                        {simResult.pm25ChangePercent !== null
                          ? `${simResult.pm25ChangePercent.toFixed(2)}% — assumed coefficient ${interventions.pm25Coefficient.toFixed(2)}`
                          : "no modelled baseline stored"}
                      </p>
                    </div>
                    <div className="border-t border-border pt-1.5">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Road closed</dt>
                        <dd className="text-foreground">{simResult.closedKm.toFixed(2)} km</dd>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {simResult.closedShare.toFixed(1)}% of the {baseline.roadKm.toFixed(0)} km
                        network · {interventions.closedClass}
                      </p>
                    </div>
                    <div className="border-t border-border pt-1.5">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Waste load</dt>
                        <dd className="text-foreground">
                          {simResult.garbageLoadKgPerDay.toLocaleString()} kg/day
                        </dd>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {interventions.garbageSites} sites × 50 kg/day, assumed
                      </p>
                    </div>
                    <div className="border-t border-border pt-1.5">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Projected PM2.5</dt>
                        <dd className="text-foreground">
                          {simResult.pm25Total !== null
                            ? `${simResult.pm25Total.toFixed(1)} µg/m³`
                            : "unavailable"}
                        </dd>
                      </div>
                      <p className="text-[10px] text-amber-300">
                        {simResult.aqiCategory
                          ? `CPCB band: ${simResult.aqiCategory}`
                          : "no modelled baseline stored"}
                        {interventions.carsAdded > 0
                          ? ` · +${simResult.trafficPm25.toFixed(2)} µg/m³ from ${interventions.carsAdded.toLocaleString()} vehicles/day`
                          : ""}
                      </p>
                    </div>
                    <div className="border-t border-border pt-1.5">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Potholes / flooded</dt>
                        <dd className="text-foreground">
                          {simResult.repairedAreaM2.toFixed(0)} m² / {simResult.floodedHa.toFixed(2)} ha
                        </dd>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {interventions.potholes} potholes · {interventions.blockedDrains} drains
                        blocked (assumed)
                      </p>
                    </div>
                    <div className="border-t border-border pt-1.5">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">City condition</dt>
                        <dd className="text-foreground">{simResult.cityCondition.toFixed(1)}/100</dd>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        assumed weights: waste, potholes, drains, closures, traffic
                      </p>
                    </div>
                    {simResult.seismic && (
                      <div className="border-t border-border pt-1.5">
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Seismic check</dt>
                          <dd className="text-foreground">
                            {(simResult.seismic.damageProbability * 100).toFixed(0)}% per building
                          </dd>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Mw {simResult.seismic.scenarioMagnitude} at {simResult.seismic.scenarioDistanceKm} km · PGA{" "}
                          {simResult.seismic.pgaG.toFixed(3)} g · {simResult.seismic.nearbyBuildings}{" "}
                          neighbours within 60 m · ~{simResult.seismic.expectedDamaged.toFixed(1)}{" "}
                          expected past slight damage
                        </p>
                        <p className="text-[10px] text-amber-300">
                          simplified fragility, not a hazard assessment
                        </p>
                      </div>
                    )}
                  </dl>

                  <div className="mt-2 border-t border-border pt-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                      Not modelled
                    </p>
                    <ul className="list-disc list-inside text-[10px] text-muted-foreground space-y-0.5">
                      {simResult.notModelled.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Virtual City: intervention controls */}
          {viewMode === "sim" && (
            <div className="absolute top-3 right-3 z-[600] w-60 max-h-[calc(100%-1.5rem)] overflow-auto rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-2 shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Interventions
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setInterventions({
                      trees: 0,
                      garbageSites: 0,
                      carsAdded: 0,
                      potholes: 0,
                      blockedDrains: 0,
                      closedClass: baseline?.roadByClass[0]?.highway_class ?? "secondary",
                      closurePercent: 0,
                      pm25Coefficient: DEFAULT_PM25_COEFFICIENT,
                      buildingFloors: 0,
                      buildingFootprintM2: 400,
                    })
                  }
                  className="text-[11px] text-primary hover:underline"
                >
                  Reset
                </button>
              </div>

              <label className="block text-xs space-y-1 mb-2">
                <div className="flex justify-between">
                  <span>Trees planted</span>
                  <span className="text-foreground">{interventions.trees.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={5000}
                  step={50}
                  value={interventions.trees}
                  onChange={(event) =>
                    setInterventions((current) => ({
                      ...current,
                      trees: Number(event.target.value),
                    }))
                  }
                  className="w-full accent-[#35D6B4]"
                />
                <span className="text-[10px] text-muted-foreground">
                  {interventions.trees > 0
                    ? `≈ ${Math.ceil(interventions.trees / 150)} trees per model`
                    : "no trees placed"}
                </span>
              </label>

              <label className="block text-xs space-y-1 mb-2">
                <div className="flex justify-between">
                  <span>Garbage sites</span>
                  <span className="text-foreground">{interventions.garbageSites}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={60}
                  step={1}
                  value={interventions.garbageSites}
                  onChange={(event) =>
                    setInterventions((current) => ({
                      ...current,
                      garbageSites: Number(event.target.value),
                    }))
                  }
                  className="w-full accent-[#F59E0B]"
                />
                <span className="text-[10px] text-muted-foreground">
                  Markers along streets · load is an assumption
                </span>
              </label>

              <label className="block text-xs space-y-1 mb-2">
                <div className="flex justify-between">
                  <span>Extra vehicles / day</span>
                  <span className="text-foreground">{interventions.carsAdded.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={20000}
                  step={250}
                  value={interventions.carsAdded}
                  onChange={(event) =>
                    setInterventions((current) => ({
                      ...current,
                      carsAdded: Number(event.target.value),
                    }))
                  }
                  className="w-full accent-[#B8C4DA]"
                />
                <span className="text-[10px] text-muted-foreground">
                  Assumed +0.8 µg/m³ PM2.5 per 1,000 vehicles
                </span>
              </label>

              <label className="block text-xs space-y-1 mb-2">
                <div className="flex justify-between">
                  <span>Potholes repaired</span>
                  <span className="text-foreground">{interventions.potholes}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={interventions.potholes}
                  onChange={(event) =>
                    setInterventions((current) => ({
                      ...current,
                      potholes: Number(event.target.value),
                    }))
                  }
                  className="w-full accent-[#11151F]"
                />
                <span className="text-[10px] text-muted-foreground">
                  {interventions.potholes * 1.5} m² of patching
                </span>
              </label>

              <label className="block text-xs space-y-1 mb-2">
                <div className="flex justify-between">
                  <span>Drains blocked</span>
                  <span className="text-foreground">{interventions.blockedDrains}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={1}
                  value={interventions.blockedDrains}
                  onChange={(event) =>
                    setInterventions((current) => ({
                      ...current,
                      blockedDrains: Number(event.target.value),
                    }))
                  }
                  className="w-full accent-[#8B6B4A]"
                />
                <span className="text-[10px] text-muted-foreground">
                  {interventions.blockedDrains * 0.35} ha at flood risk (assumed)
                </span>
              </label>

              <div className="border-t border-border pt-2 mb-2">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                  Proposed building
                </p>
                <label className="block text-xs space-y-1 mb-1">
                  <div className="flex justify-between">
                    <span>Storeys</span>
                    <span className="text-foreground">{interventions.buildingFloors}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    step={1}
                    value={interventions.buildingFloors}
                    onChange={(event) =>
                      setInterventions((current) => ({
                        ...current,
                        buildingFloors: Number(event.target.value),
                      }))
                    }
                    className="w-full accent-[#FB923C]"
                  />
                </label>
                <label className="block text-xs space-y-1">
                  <div className="flex justify-between">
                    <span>Footprint</span>
                    <span className="text-foreground">
                      {interventions.buildingFootprintM2} m²
                    </span>
                  </div>
                  <input
                    type="range"
                    min={100}
                    max={2000}
                    step={50}
                    value={interventions.buildingFootprintM2}
                    onChange={(event) =>
                      setInterventions((current) => ({
                        ...current,
                        buildingFootprintM2: Number(event.target.value),
                      }))
                    }
                    className="w-full accent-[#FB923C]"
                  />
                </label>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {interventions.buildingFloors > 0
                    ? `${buildContext.nearbyBuildings} existing buildings within 60 m`
                    : "0 storeys = no building proposed"}
                </p>
              </div>

              <label className="block text-xs space-y-1 mb-2">
                <span className="text-muted-foreground">Road class to close</span>
                <select
                  value={interventions.closedClass}
                  onChange={(event) =>
                    setInterventions((current) => ({
                      ...current,
                      closedClass: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg bg-secondary border border-border px-2 py-1.5"
                >
                  {(baseline?.roadByClass ?? [{ highway_class: "secondary", segments: 0, length_km: 0 }]).map(
                    (row) => (
                      <option key={row.highway_class} value={row.highway_class}>
                        {row.highway_class} ({row.length_km.toFixed(1)} km)
                      </option>
                    ),
                  )}
                </select>
              </label>

              <label className="block text-xs space-y-1">
                <div className="flex justify-between">
                  <span>Share of class closed</span>
                  <span className="text-foreground">{interventions.closurePercent}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={interventions.closurePercent}
                  onChange={(event) =>
                    setInterventions((current) => ({
                      ...current,
                      closurePercent: Number(event.target.value),
                    }))
                  }
                  className="w-full accent-[#F87171]"
                />
              </label>

              <label className="mt-2 flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={showFabric}
                  onChange={(event) => setShowFabric(event.target.checked)}
                  className="accent-[#6E7F97]"
                />
                <span>Synthetic city fill</span>
              </label>
              <p className="text-[10px] text-muted-foreground mt-1">
                Dimmer blocks are generated houses, shops, apartments and sheds — not surveyed.
              </p>

              <div className="mt-2 border-t border-border pt-1.5 text-[10px] text-muted-foreground space-y-1">
                <p className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#35D6B4]" /> tree
                  <span className="w-2 h-2 rounded-full bg-[#F59E0B] ml-1" /> waste site
                  <span className="w-2 h-2 rounded-sm bg-[#F87171] ml-1" /> closed road
                </p>
                <p>
                  Geometry is the ingested OSM data. This is a schematic city, not satellite
                  imagery, and the numbers are simulated.
                </p>
              </div>
            </div>
          )}
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          Boundaries clipped to the {summary?.aoi?.name ?? "Maharaj Bada"} AOI. Source:{" "}
          {summary?.attribution ?? "© OpenStreetMap contributors (ODbL)"}. OSM coverage is
          incomplete: unmapped buildings, facilities and street trees are not shown.
        </p>
      </div>
    </div>
  );
}

export default DigitalTwin;
