import { useEffect, useMemo, useState } from "react";
import { api, type GeoJsonFeatureCollection } from "../lib/api";

interface NetworkAnalytics {
  segments: number;
  total_length_km: number;
  named_segments: number;
  by_class: Array<{ highway_class: string; segments: number; length_km: number }>;
  note: string;
}

interface RoadSegment {
  osm_id: string;
  name: string | null;
  highway: string | null;
  length_m: number | null;
  lanes: string | null;
  maxspeed: string | null;
  surface: string | null;
  ref: string | null;
}

const Traffic = () => {
  const [analytics, setAnalytics] = useState<NetworkAnalytics | null>(null);
  const [roads, setRoads] = useState<GeoJsonFeatureCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RoadSegment | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const [network, roadData] = await Promise.all([
          api.network(controller.signal),
          api.layerGeoJson("roads", controller.signal),
        ]);
        setAnalytics(network);
        setRoads(roadData);
        setError(null);
      } catch (loadError) {
        if ((loadError as Error).name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load road network");
      } finally {
        setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  const segments = useMemo<RoadSegment[]>(() => {
    if (!roads) return [];
    return roads.features.map((feature) => ({
      osm_id: String(feature.properties.osm_id ?? ""),
      name: (feature.properties.name as string | null) ?? null,
      highway: (feature.properties.highway as string | null) ?? null,
      length_m: (feature.properties.length_m as number | null) ?? null,
      lanes: (feature.properties.lanes as string | null) ?? null,
      maxspeed: (feature.properties.maxspeed as string | null) ?? null,
      surface: (feature.properties.surface as string | null) ?? null,
      ref: (feature.properties.ref as string | null) ?? null,
    }));
  }, [roads]);

  const longest = useMemo(
    () =>
      [...segments]
        .filter((segment) => segment.length_m !== null)
        .sort((a, b) => (b.length_m ?? 0) - (a.length_m ?? 0))
        .slice(0, 10),
    [segments],
  );

  const attributeCoverage = useMemo(() => {
    const total = segments.length || 1;
    const share = (key: keyof RoadSegment) =>
      Math.round((segments.filter((segment) => segment[key]).length / total) * 100);
    return {
      name: share("name"),
      lanes: share("lanes"),
      maxspeed: share("maxspeed"),
      surface: share("surface"),
    };
  }, [segments]);

  const maxClassLength = Math.max(1, ...(analytics?.by_class.map((row) => row.length_km) ?? [1]));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-widest text-accent-cyan/80 mb-1">Network</p>
          <h1 className="text-2xl md:text-3xl font-semibold">Traffic &amp; Road Network</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
            Road-network statistics computed from the ingested OpenStreetMap geometry for the
            Maharaj Bada AOI. This page reports network composition and mapped attributes — it does
            not contain traffic volumes, speeds or congestion measurements.
          </p>
        </header>

        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          <strong className="font-semibold">No live traffic data.</strong> OSM road geometry is
          static. Daily vehicle counts, average speeds and congestion classes that appear on many
          urban dashboards are not available from this dataset, so none are shown here.
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            Could not load road analytics: {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading network statistics…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Road segments", value: analytics?.segments ?? 0 },
                { label: "Total length (km)", value: (analytics?.total_length_km ?? 0).toFixed(1) },
                { label: "Named segments", value: analytics?.named_segments ?? 0 },
                { label: "Highway classes", value: analytics?.by_class.length ?? 0 },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-border bg-card px-4 py-3">
                  <p className="text-2xl font-semibold text-primary">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                </div>
              ))}
            </div>

            <section className="mb-8">
              <h2 className="text-lg font-medium mb-3">Network composition by highway class</h2>
              <div className="space-y-2">
                {(analytics?.by_class ?? []).map((row) => (
                  <div
                    key={row.highway_class}
                    className="rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="font-medium capitalize">{row.highway_class}</span>
                      <span className="text-muted-foreground text-xs">
                        {row.segments} segments · {row.length_km.toFixed(2)} km
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent-cyan"
                        style={{ width: `${(row.length_km / maxClassLength) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-medium mb-3">Longest mapped road segments</h2>
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-muted-foreground text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Name</th>
                      <th className="text-left px-4 py-2 font-medium">Class</th>
                      <th className="text-right px-4 py-2 font-medium">Length</th>
                      <th className="text-right px-4 py-2 font-medium">Lanes</th>
                      <th className="text-right px-4 py-2 font-medium">Max speed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {longest.map((segment) => (
                      <tr
                        key={segment.osm_id}
                        onClick={() => setSelected(segment)}
                        className="border-t border-border hover:bg-card cursor-pointer"
                      >
                        <td className="px-4 py-2">{segment.name ?? `OSM ${segment.osm_id}`}</td>
                        <td className="px-4 py-2 capitalize text-muted-foreground">
                          {segment.highway ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {(segment.length_m ?? 0).toFixed(0)} m
                        </td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {segment.lanes ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {segment.maxspeed ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mb-8 grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-border bg-card px-4 py-4">
                <h2 className="text-sm font-medium mb-2">Attribute completeness</h2>
                <p className="text-xs text-muted-foreground mb-3">
                  Share of the {segments.length} ingested road segments that carry each OSM tag.
                </p>
                {Object.entries(attributeCoverage).map(([key, value]) => (
                  <div key={key} className="mb-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="capitalize text-muted-foreground">{key}</span>
                      <span>{value}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full bg-accent-teal rounded-full" style={{ width: `${value}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-card px-4 py-4 text-xs text-muted-foreground">
                <h2 className="text-sm font-medium mb-2 text-foreground">
                  {selected ? "Selected segment" : "How to read this page"}
                </h2>
                {selected ? (
                  <dl className="space-y-1">
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0">Name</dt>
                      <dd className="text-foreground">{selected.name ?? "—"}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0">OSM id</dt>
                      <dd className="text-foreground">{selected.osm_id}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0">Class</dt>
                      <dd className="text-foreground capitalize">{selected.highway ?? "—"}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0">Length</dt>
                      <dd className="text-foreground">{(selected.length_m ?? 0).toFixed(0)} m</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0">Surface</dt>
                      <dd className="text-foreground">{selected.surface ?? "—"}</dd>
                    </div>
                  </dl>
                ) : (
                  <p>
                    Lengths are measured in UTM zone 44N from OSM geometry. Highway classes follow
                    the OSM `highway` tag. Click a row to inspect a segment. Anything not tagged in
                    OSM is shown as “—”, never estimated.
                  </p>
                )}
              </div>
            </section>

            <p className="text-[11px] text-muted-foreground">
              {analytics?.note ?? "Derived from OpenStreetMap road geometry only."} © OpenStreetMap
              contributors (ODbL).
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default Traffic;
