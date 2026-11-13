import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type EnvironmentOverview,
  type EnvironmentSource,
  type EnvironmentStation,
} from "../lib/api";

/** Distance label: containment is stated explicitly, never just a number. */
function stationDistanceLabel(station: EnvironmentStation): string {
  if (station.inside_aoi === null || station.distance_km_to_aoi_boundary === null) {
    return "Distance to AOI unknown";
  }
  if (station.inside_aoi) {
    return "Inside the AOI (0 km to boundary)";
  }
  return `${station.distance_km_to_aoi_boundary.toFixed(2)} km to nearest AOI boundary`;
}

const LABELS: Record<string, string> = {
  pm2_5: "PM2.5",
  pm10: "PM10",
  nitrogen_dioxide: "NO₂",
  carbon_monoxide: "CO",
  ozone: "O₃",
};

const UNIT_LABEL: Record<string, string> = {
  land_surface_temperature: "Land surface temperature",
  ndvi: "NDVI (vegetation index)",
  pm10_local_monitor: "Local PM10 monitor",
};

function Sparkline({ days }: { days: EnvironmentOverview["temperature"]["days"] }) {
  const values = days.map((day) => day.max).filter((value): value is number => typeof value === "number");
  if (values.length < 2) return null;
  const width = 320;
  const height = 70;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-16" role="img" aria-label="Daily maximum temperature">
      <polyline points={points} fill="none" stroke="#39D5FF" strokeWidth="2" />
      <text x="0" y="10" fill="#9AA9BE" fontSize="9">
        {max.toFixed(1)} °C
      </text>
      <text x="0" y={height - 1} fill="#9AA9BE" fontSize="9">
        {min.toFixed(1)} °C
      </text>
    </svg>
  );
}

const Environment = () => {
  const [overview, setOverview] = useState<EnvironmentOverview | null>(null);
  const [sources, setSources] = useState<EnvironmentSource[]>([]);
  const [stations, setStations] = useState<EnvironmentStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [data, datasetInfo, stationInfo] = await Promise.all([
        api.environmentOverview(14, signal),
        api.environmentSources(signal),
        api.environmentStations(signal),
      ]);
      setOverview(data);
      setSources(datasetInfo);
      setStations(stationInfo);
      setError(null);
    } catch (loadError) {
      if ((loadError as Error).name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Failed to load environmental data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.refreshEnvironment(7);
      await load();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const pollutants = overview?.air_quality.pollutants ?? [];
  const primaryPollutants = useMemo(
    () => pollutants.filter((item) => ["pm2_5", "pm10", "nitrogen_dioxide"].includes(item.variable)),
    [pollutants],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-accent-cyan/80 mb-1">Environment</p>
            <h1 className="text-2xl md:text-3xl font-semibold">Environmental Intelligence</h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
              Air quality and temperature for the AOI centroid, sampled from the Copernicus CAMS and
              ERA5 model grids via Open-Meteo. Green cover is derived from mapped OpenStreetMap
              polygons. Values are labelled modelled or derived — none are local sensor readings.
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="px-4 py-2 rounded-lg bg-primary text-background text-sm font-medium disabled:opacity-60"
          >
            {refreshing ? "Refreshing…" : "Refresh from source"}
          </button>
        </header>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading observations…
          </div>
        ) : (
          <>
            {!overview?.available && (
              <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                No environmental observations are stored yet. POST{" "}
                <code className="text-accent-cyan">
                  /api/environment/refresh
                </code> or run{" "}
                <code className="text-accent-cyan">
                  python environment_ingest.py
                </code>.
              </div>
            )}

            <section className="mb-8">
              <h2 className="text-lg font-medium mb-3">Air quality — modelled (CAMS global)</h2>
              <div className="grid md:grid-cols-3 gap-4">
                {primaryPollutants.map((pollutant) => (
                  <div key={pollutant.variable} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {LABELS[pollutant.variable] ?? pollutant.variable}
                        </p>
                        <p className="text-3xl font-semibold mt-1">
                          {pollutant.latest ?? "—"}
                          <span className="text-sm font-normal text-muted-foreground ml-1">
                            {pollutant.unit}
                          </span>
                        </p>
                      </div>
                      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-accent-violet/20 text-accent-violet">
                        {pollutant.data_type}
                      </span>
                    </div>
                    <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between">
                        <dt>24 h mean</dt>
                        <dd className="text-foreground">
                          {pollutant.mean_24h ?? "—"} {pollutant.unit}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>24 h range</dt>
                        <dd className="text-foreground">
                          {pollutant.min_24h ?? "—"} – {pollutant.max_24h ?? "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Hourly samples</dt>
                        <dd className="text-foreground">{pollutant.samples_24h}</dd>
                      </div>
                      {pollutant.guideline && (
                        <div className="flex justify-between">
                          <dt>WHO 24 h AQG</dt>
                          <dd className={pollutant.exceeds_guideline ? "text-red-400" : "text-accent-teal"}>
                            {pollutant.guideline.value} {pollutant.unit}
                            {pollutant.exceeds_guideline ? " · exceeded" : " · within"}
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between pt-1 border-t border-border">
                        <dt>Latest hour</dt>
                        <dd>{pollutant.latest_time?.replace("T", " ").slice(0, 16) ?? "—"}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                CAMS is a ~40 km gridded model, interpolated to the AOI centroid. Street-level
                concentrations can differ substantially. Fetched{" "}
                {pollutants[0]?.fetched_at?.slice(0, 16).replace("T", " ") ?? "—"}.
              </p>
            </section>

            <section className="mb-8 grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-medium">Temperature</h2>
                  <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-accent-violet/20 text-accent-violet">
                    modelled
                  </span>
                </div>
                <Sparkline days={overview?.temperature.days ?? []} />
                <div className="mt-2 max-h-40 overflow-auto text-xs">
                  <table className="w-full">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="text-left font-medium py-1">Date</th>
                        <th className="text-right font-medium">Min</th>
                        <th className="text-right font-medium">Mean</th>
                        <th className="text-right font-medium">Max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(overview?.temperature.days ?? []).slice(-7).reverse().map((day) => (
                        <tr key={day.date} className="border-t border-border">
                          <td className="py-1">{day.date}</td>
                          <td className="text-right">{day.min ?? "—"}</td>
                          <td className="text-right">{day.mean ?? "—"}</td>
                          <td className="text-right">{day.max ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  2 m air temperature from ERA5/IFS. Not a land-surface or urban-heat-island measurement.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-medium">Green cover</h2>
                  <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-accent-teal/20 text-accent-teal">
                    derived
                  </span>
                </div>
                <p className="text-3xl font-semibold">
                  {overview?.green_cover.mapped_share_of_aoi_percent ?? "—"}
                  <span className="text-sm font-normal text-muted-foreground ml-1">% of AOI</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {overview?.green_cover.mapped_green_area_ha ?? "—"} ha across{" "}
                  {overview?.green_cover.polygons ?? 0} mapped polygons
                </p>
                <ul className="mt-3 space-y-1 text-xs">
                  {(overview?.green_cover.largest_areas ?? []).map((area, index) => (
                    <li
                      key={`${area.name ?? "area"}-${index}`}
                      className="flex justify-between gap-3"
                    >
                      <span className="text-muted-foreground truncate">
                        {area.name ?? "unnamed"} · {area.category}
                      </span>
                      <span>{area.area_ha} ha</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Lower bound: street trees and unmapped vegetation are not counted.
                </p>
              </div>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-medium mb-3">Gwalior monitoring stations</h2>
              {stations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No ground monitoring stations are registered, so ground observations are
                  unavailable.
                </p>
              ) : (
                <>
                  <div className="grid md:grid-cols-2 gap-4">
                    {stations.map((station) => (
                      <div
                        key={station.station_id}
                        className="rounded-lg border border-border bg-card p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="font-medium text-foreground">
                            {station.name}
                            <span className="text-xs text-muted-foreground ml-2">
                              ({station.station_id})
                            </span>
                          </p>
                          <span
                            className={
                              station.inside_aoi
                                ? "text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-accent-teal/20 text-accent-teal"
                                : "text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-secondary text-muted-foreground"
                            }
                          >
                            {station.inside_aoi ? "inside AOI" : "outside AOI"}
                          </span>
                        </div>
                        <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                          <div className="flex justify-between gap-3">
                            <dt>Distance to AOI</dt>
                            <dd className="text-foreground text-right">
                              {stationDistanceLabel(station)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt>Distance to AOI centroid</dt>
                            <dd className="text-foreground">
                              {station.distance_km_from_aoi_centroid?.toFixed(2) ?? "—"} km
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt>Operating agency</dt>
                            <dd className="text-foreground text-right">
                              {station.operating_agency ?? "—"}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt>Coordinates</dt>
                            <dd className="text-foreground">
                              {station.latitude.toFixed(4)}, {station.longitude.toFixed(4)}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Distance is measured to the nearest AOI boundary on the WGS84 ellipsoid
                    (SRID {stations[0]?.aoi_srid ?? 4326}) and is exactly 0 km for a station
                    inside the AOI. The centroid distance is shown only for context. A station
                    reading is a point measurement at that station, not the air quality of a
                    specific address elsewhere in the AOI.
                  </p>
                </>
              )}
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-medium mb-3">Observed pollutant values</h2>
              <div className="grid md:grid-cols-3 gap-4">
                {primaryPollutants.map((pollutant) => (
                  <div key={pollutant.variable} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {LABELS[pollutant.variable] ?? pollutant.variable}
                        </p>
                        <p className="text-3xl font-semibold mt-1">
                          {pollutant.latest ?? "—"}
                          <span className="text-sm font-normal text-muted-foreground ml-1">
                            {pollutant.unit}
                          </span>
                        </p>
                      </div>
                      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-accent-violet/20 text-accent-violet">
                        {pollutant.data_type}
                      </span>
                    </div>
                    <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between">
                        <dt>24 h mean</dt>
                        <dd className="text-foreground">
                          {pollutant.mean_24h ?? "—"} {pollutant.unit}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>24 h range</dt>
                        <dd className="text-foreground">
                          {pollutant.min_24h ?? "—"} – {pollutant.max_24h ?? "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Hourly samples</dt>
                        <dd className="text-foreground">{pollutant.samples_24h}</dd>
                      </div>
                      {pollutant.guideline && (
                        <div className="flex justify-between">
                          <dt>WHO 24 h AQG</dt>
                          <dd className={pollutant.exceeds_guideline ? "text-red-400" : "text-accent-teal"}>
                            {pollutant.guideline.value} {pollutant.unit}
                            {pollutant.exceeds_guideline ? " · exceeded" : " · within"}
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between pt-1 border-t border-border">
                        <dt>Latest hour</dt>
                        <dd>{pollutant.latest_time?.replace("T", " ").slice(0, 16) ?? "—"}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                CAMS is a ~40 km gridded model, interpolated to the AOI centroid. Street-level
                concentrations can differ substantially. Fetched{" "}
                {pollutants[0]?.fetched_at?.slice(0, 16).replace("T", " ") ?? "—"}.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-medium mb-3">Sources</h2>
              <div className="space-y-2 text-xs">
                {sources.map((source) => (
                  <div key={source.id} className="rounded-lg border border-border bg-card px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{source.name}</p>
                      <a
                        href={source.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        documentation ↗
                      </a>
                    </div>
                    <p className="text-muted-foreground mt-1">
                      {source.provider} · {source.data_type} · {source.temporal_resolution} ·{" "}
                      {source.record_count ?? 0} stored rows
                    </p>
                    <p className="text-muted-foreground mt-1">{source.known_limitations}</p>
                    <p className="text-muted-foreground mt-1 text-[11px]">
                      {source.license} · {source.attribution}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default Environment;