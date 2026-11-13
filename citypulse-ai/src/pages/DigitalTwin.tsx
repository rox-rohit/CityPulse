import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import type { GeoJsonObject } from "geojson";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, type AoiBoundary, type GeoJsonFeatureCollection, type LayerInfo, type Summary } from "../lib/api";

const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const DEFAULT_CENTER: [number, number] = [26.2205, 78.18];

// Cesium is heavy, so the 3D scene is only downloaded when requested.
const Twin3D = lazy(() => import("../components/Twin3D"));

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
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");

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
              {(["2d", "3d"] as const).map((mode) => (
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
                  {mode}
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
