import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  api,
  type CivicIssue,
  type CivicIssueList,
  type CivicStats,
  type Hotspot,
  type IssueCategory,
  type IssueSeverity,
  type IssueStatus,
} from "../lib/api";

const CENTER: [number, number] = [26.218, 78.178];

const CATEGORY_LABELS: Record<IssueCategory, string> = {
  pothole: "Pothole",
  garbage: "Garbage",
  drainage: "Drainage",
  streetlight: "Streetlight",
  water_supply: "Water supply",
  road_damage: "Road damage",
};

const SEVERITY_COLOUR: Record<IssueSeverity, string> = {
  high: "#F87171",
  medium: "#FBBF24",
  low: "#38BDF8",
};

const STATUS_COLOUR: Record<string, string> = {
  reported: "#94A3B8",
  verified: "#39D5FF",
  in_progress: "#A78BFA",
  resolved: "#34D399",
  rejected: "#64748B",
};

const NEXT_STATUS: Record<IssueStatus, IssueStatus[]> = {
  reported: ["verified", "rejected"],
  verified: ["in_progress", "rejected"],
  in_progress: ["resolved"],
  resolved: [],
  rejected: [],
};

function ClickPicker({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

function RecentreButton({ target }: { target: [number, number] | null }) {
  const map = useMapEvents({});
  const previous = useRef(target);
  useEffect(() => {
    if (target && target !== previous.current) {
      map.flyTo(target, Math.max(map.getZoom(), 16), { duration: 0.6 });
    }
    previous.current = target;
  }, [map, target]);
  return null;
}

const CivicIssues = () => {
  const [issues, setIssues] = useState<CivicIssueList | null>(null);
  const [stats, setStats] = useState<CivicStats | null>(null);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [hotspotMethod, setHotspotMethod] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [includeDemo, setIncludeDemo] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<[number, number] | null>(null);

  const [category, setCategory] = useState<IssueCategory>("pothole");
  const [severity, setSeverity] = useState<IssueSeverity>("medium");
  const [description, setDescription] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [coordinates, setCoordinates] = useState<{ lat: number; lon: number } | null>(null);
  const [manualCoords, setManualCoords] = useState({ lat: "26.218", lon: "78.178" });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [list, summary, clusterInfo] = await Promise.all([
          api.civicIssues(
            {
              status: statusFilter || undefined,
              category: categoryFilter || undefined,
              include_demo: includeDemo,
            },
            signal,
          ),
          api.civicStats(signal),
          api.civicHotspots(250, 2, signal),
        ]);
        setIssues(list);
        setStats(summary);
        setHotspots(clusterInfo.clusters);
        setHotspotMethod(clusterInfo.method);
        setError(null);
      } catch (loadError) {
        if ((loadError as Error).name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load civic issues");
      }
    },
    [statusFilter, categoryFilter, includeDemo],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const pick = (lat: number, lon: number) => {
    setCoordinates({ lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) });
    setManualCoords({ lat: lat.toFixed(6), lon: lon.toFixed(6) });
    setSelected([lat, lon]);
  };

  const updateManual = (lat: string, lon: string) => {
    setManualCoords({ lat, lon });
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    if (Number.isFinite(parsedLat) && Number.isFinite(parsedLon)) {
      setCoordinates({ lat: parsedLat, lon: parsedLon });
    } else {
      setCoordinates(null);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!coordinates) {
      setError("Pick a location on the map or type coordinates first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.createCivicIssue({
        category,
        severity,
        description: description.trim(),
        latitude: coordinates.lat,
        longitude: coordinates.lon,
        reporter_name: reporterName.trim() || undefined,
      });
      setNotice(
        created.duplicate_warning
          ? `${created.reference}: ${created.duplicate_warning}`
          : `Report ${created.reference} stored. Status: ${created.status}.`,
      );
      setDescription("");
      setSelected([created.latitude, created.longitude]);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const moderate = async (issue: CivicIssue, next: IssueStatus) => {
    try {
      await api.updateCivicStatus(issue.id, next);
      setNotice(`${issue.reference} moved to ${next.replace("_", " ")}.`);
      await load();
    } catch (moderationError) {
      setError(moderationError instanceof Error ? moderationError.message : "Status update failed");
    }
  };

  const openIssues = useMemo(
    () =>
      (issues?.features ?? [])
        .map((feature) => feature.properties)
        .filter((issue) => !["resolved", "rejected"].includes(issue.status)),
    [issues],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-widest text-accent-cyan/80 mb-1">Citizen reporting</p>
          <h1 className="text-2xl md:text-3xl font-semibold">Civic Issues</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
            Reports submitted here are written to PostGIS with their coordinates, category, severity
            and a moderation status. Duplicate detection links a new report to any same-category
            report within 60 m filed in the last 30 days. Demonstration rows, if any exist, are
            labelled and never counted as citizen reports.
          </p>
        </header>

        {(error || notice) && (
          <div
            className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
              error
                ? "border-red-500/40 bg-red-500/10 text-red-300"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <span>{error ?? notice}</span>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                }}
                className="text-xs opacity-70 hover:opacity-100"
              >
                dismiss
              </button>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-5 gap-6">
          <section className="lg:col-span-3 space-y-4">
            <div className="rounded-xl overflow-hidden border border-border h-[420px] relative">
              <MapContainer center={CENTER} zoom={15} scrollWheelZoom className="h-full w-full">
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <ClickPicker onPick={pick} />
                <RecentreButton target={selected} />
                {(issues?.features ?? []).map((feature) => {
                  const issue = feature.properties;
                  return (
                    <CircleMarker
                      key={issue.id}
                      center={[issue.latitude, issue.longitude]}
                      radius={issue.severity === "high" ? 9 : 7}
                      pathOptions={{
                        color: STATUS_COLOUR[issue.status] ?? "#94A3B8",
                        fillColor: SEVERITY_COLOUR[issue.severity] ?? "#38BDF8",
                        fillOpacity: 0.75,
                        weight: 2,
                      }}
                    >
                      <div className="text-xs" />
                    </CircleMarker>
                  );
                })}
                {coordinates && (
                  <CircleMarker
                    center={[coordinates.lat, coordinates.lon]}
                    radius={10}
                    pathOptions={{ color: "#39D5FF", fillColor: "#39D5FF", fillOpacity: 0.4, dashArray: "4" }}
                  />
                )}
                {hotspots.map((cluster) => (
                  <CircleMarker
                    key={`hotspot-${cluster.cluster_id}`}
                    center={[cluster.center.latitude, cluster.center.longitude]}
                    radius={Math.min(60, cluster.approximate_radius_m)}
                    pathOptions={{ color: "#F87171", weight: 1, fillOpacity: 0.06, dashArray: "3" }}
                  />
                ))}
              </MapContainer>
              <div className="absolute bottom-2 left-2 z-[400] bg-background/90 border border-border rounded-lg px-2 py-1 text-[10px] text-muted-foreground">
                click map to set report location · {issues?.features.length ?? 0} shown
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-lg bg-secondary border border-border px-2 py-1.5"
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                {Object.keys(STATUS_COLOUR).map((status) => (
                  <option key={status} value={status}>
                    {status.replace("_", " ")}
                  </option>
                ))}
              </select>
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="rounded-lg bg-secondary border border-border px-2 py-1.5"
                aria-label="Filter by category"
              >
                <option value="">All categories</option>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 rounded-lg bg-secondary border border-border px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={includeDemo}
                  onChange={(event) => setIncludeDemo(event.target.checked)}
                />
                include demo rows
              </label>
              <span className="text-muted-foreground self-center">
                duplicate window {issues?.duplicate_policy.radius_m ?? 60} m /{" "}
                {issues?.duplicate_policy.window_days ?? 30} days
              </span>
            </div>

            <div className="rounded-xl border border-border bg-card divide-y divide-border max-h-[420px] overflow-auto">
              {(issues?.features ?? []).length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  No reports match the current filters.
                </p>
              )}
              {(issues?.features ?? []).map((feature) => {
                const issue = feature.properties;
                return (
                  <div key={issue.id} className="p-3 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-sm">
                          {issue.category_label}
                          {issue.is_demo && (
                            <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                              demo
                            </span>
                          )}
                          {issue.duplicate_of && (
                            <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-accent-violet/20 text-accent-violet">
                              linked
                            </span>
                          )}
                        </p>
                        <p className="text-muted-foreground mt-0.5">{issue.description}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelected([issue.latitude, issue.longitude])}
                        className="shrink-0 text-[11px] text-primary hover:underline"
                      >
                        locate
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{issue.reference}</span>
                      <span style={{ color: STATUS_COLOUR[issue.status] }}>{issue.status.replace("_", " ")}</span>
                      <span style={{ color: SEVERITY_COLOUR[issue.severity] }}>{issue.severity} severity</span>
                      <span>{new Date(issue.created_at).toLocaleString()}</span>
                      <span>
                        {issue.latitude.toFixed(5)}, {issue.longitude.toFixed(5)}
                      </span>
                    </div>
                    {NEXT_STATUS[issue.status].length > 0 && (
                      <div className="mt-2 flex gap-2">
                        {NEXT_STATUS[issue.status].map((next) => (
                          <button
                            key={next}
                            type="button"
                            onClick={() => void moderate(issue, next)}
                            className="px-2 py-1 rounded border border-border bg-secondary hover:border-primary text-[11px]"
                          >
                            mark {next.replace("_", " ")}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="lg:col-span-2 space-y-4">
            <form onSubmit={submit} className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h2 className="text-sm font-medium">Report an issue</h2>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="space-y-1">
                  <span className="text-muted-foreground">Category</span>
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value as IssueCategory)}
                    className="w-full rounded-lg bg-secondary border border-border px-2 py-1.5"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-muted-foreground">Severity</span>
                  <select
                    value={severity}
                    onChange={(event) => setSeverity(event.target.value as IssueSeverity)}
                    className="w-full rounded-lg bg-secondary border border-border px-2 py-1.5"
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </label>
              </div>
              <label className="block text-xs space-y-1">
                <span className="text-muted-foreground">Description (min 10 characters)</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  minLength={10}
                  maxLength={2000}
                  required
                  className="w-full rounded-lg bg-secondary border border-border px-2 py-1.5"
                  placeholder="What is wrong, and where exactly?"
                />
              </label>
              <label className="block text-xs space-y-1">
                <span className="text-muted-foreground">Your name (optional)</span>
                <input
                  value={reporterName}
                  onChange={(event) => setReporterName(event.target.value)}
                  maxLength={120}
                  className="w-full rounded-lg bg-secondary border border-border px-2 py-1.5"
                />
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="space-y-1">
                  <span className="text-muted-foreground">Latitude</span>
                  <input
                    value={manualCoords.lat}
                    onChange={(event) => updateManual(event.target.value, manualCoords.lon)}
                    className="w-full rounded-lg bg-secondary border border-border px-2 py-1.5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-muted-foreground">Longitude</span>
                  <input
                    value={manualCoords.lon}
                    onChange={(event) => updateManual(manualCoords.lat, event.target.value)}
                    className="w-full rounded-lg bg-secondary border border-border px-2 py-1.5"
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {coordinates
                  ? `Location set: ${coordinates.lat}, ${coordinates.lon}`
                  : "Click the map to set the location, or type coordinates."}
              </p>
              <button
                type="submit"
                disabled={submitting || !coordinates || description.trim().length < 10}
                className="w-full rounded-lg bg-primary text-background text-sm font-medium py-2 disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Submit report"}
              </button>
            </form>

            <div className="rounded-xl border border-border bg-card p-4 text-xs">
              <h2 className="text-sm font-medium mb-2">Summary</h2>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-muted-foreground">Stored reports</p>
                  <p className="text-lg">{stats?.total ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Citizen submissions</p>
                  <p className="text-lg">{stats?.real_reports ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Demo rows</p>
                  <p className="text-lg">{stats?.demo_reports ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Duplicates linked</p>
                  <p className="text-lg">{stats?.duplicates ?? 0}</p>
                </div>
              </div>
              <div className="mt-3 space-y-1">
                {Object.entries(stats?.by_status ?? {}).map(([status, count]) => (
                  <div key={status} className="flex justify-between">
                    <span className="text-muted-foreground">{status.replace("_", " ")}</span>
                    <span>{count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 text-xs">
              <h2 className="text-sm font-medium mb-1">Hotspots</h2>
              <p className="text-[11px] text-muted-foreground mb-2">
                {hotspotMethod || "Spatial clustering of open reports."}
              </p>
              {hotspots.length === 0 ? (
                <p className="text-muted-foreground">
                  No cluster of two or more open reports within 250 m.
                </p>
              ) : (
                <ul className="space-y-1">
                  {hotspots.map((cluster) => (
                    <li key={cluster.cluster_id} className="flex justify-between gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setSelected([cluster.center.latitude, cluster.center.longitude])
                        }
                        className="text-left hover:underline"
                      >
                        {cluster.dominant_category} · {cluster.issue_count} reports
                      </button>
                      <span className="text-muted-foreground">
                        r≈{cluster.approximate_radius_m} m
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                {openIssues.length} open report(s) considered.
              </p>
            </div>
          </aside>
        </div>

        <p className="mt-6 text-[11px] text-muted-foreground">
          Map tiles © OpenStreetMap contributors (ODbL). Reports are citizen submissions and are not
          verified municipal records unless their status says verified.
        </p>
      </div>
    </div>
  );
};

export default CivicIssues;
