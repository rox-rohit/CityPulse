/** Thin typed wrapper around the CityPulse AI backend API. */

export const API_BASE = "/api";

export interface LayerInfo {
  id: string;
  name: string;
  table_name: string;
  description?: string | null;
  geometry_type: string;
  row_count: number | null;
  data_freshness?: string | null;
  validation_status?: string;
  source?: string;
  bounds?: Record<string, number> | null;
}

export type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: string; coordinates: unknown } | null;
    properties: Record<string, unknown>;
  }>;
  layer?: { id: string; name: string; row_count: number | null };
};

export interface AoiBoundary {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: { name: string; city: string; state: string; area_km2: number };
}

export interface Summary {
  aoi: {
    name: string;
    city: string;
    state: string;
    area_km2: number;
    bbox: [number, number, number, number];
  } | null;
  layers: Array<{ table: string; name: string; feature_count: number | null }>;
  attribution: string;
}

export interface Guideline {
  value: number;
  unit: string;
  reference: string;
}

export interface Pollutant {
  variable: string;
  unit: string;
  latest: number | null;
  latest_time: string | null;
  mean_24h: number | null;
  min_24h: number | null;
  max_24h: number | null;
  samples_24h: number;
  data_type: string;
  dataset: string;
  source: string;
  fetched_at: string | null;
  guideline: Guideline | null;
  exceeds_guideline: boolean;
}

export interface TemperatureDay {
  date: string;
  mean?: number | null;
  max?: number | null;
  min?: number | null;
}

export interface EnvironmentOverview {
  generated_at: string;
  available: boolean;
  air_quality: { pollutants: Pollutant[]; who_reference: Record<string, Guideline> };
  temperature: {
    days: TemperatureDay[];
    unit?: string;
    data_type?: string;
    dataset?: string;
    source?: string;
  };
  green_cover: {
    mapped_green_area_ha: number;
    aoi_area_ha: number;
    mapped_share_of_aoi_percent: number | null;
    polygons: number;
    largest_areas: Array<{ name: string | null; category: string; area_ha: number }>;
    data_type: string;
    source: string;
  };
  unavailable: Array<{ variable: string; reason: string }>;
  notes: string[];
}

export interface EnvironmentSource {
  id: string;
  name: string;
  provider: string;
  source_url: string;
  variables: string[];
  data_type: string;
  temporal_resolution: string;
  spatial_resolution: string;
  coverage: string;
  license: string;
  attribution: string;
  known_limitations: string;
  last_fetched: string | null;
  record_count: number | null;
}

export interface EnvironmentStation {
  station_id: string;
  name: string;
  latitude: number;
  longitude: number;
  operating_agency: string;
  source: string;
  /** True when the station point lies inside or on the AOI boundary. */
  inside_aoi: boolean | null;
  /** km to the nearest AOI boundary; 0 when inside the AOI. */
  distance_km_to_aoi_boundary: number | null;
  /** Distance to the AOI centroid, shown only for context. */
  distance_km_from_aoi_centroid: number | null;
  aoi_srid: number | null;
  distance_metric: string;
  /** @deprecated alias of distance_km_to_aoi_boundary. */
  distance_km_from_AOI: number | null;
  inserted_at: string | null;
}

export type IssueCategory =
  | "pothole"
  | "garbage"
  | "drainage"
  | "streetlight"
  | "water_supply"
  | "road_damage";

export type IssueSeverity = "low" | "medium" | "high";

export type IssueStatus = "reported" | "verified" | "in_progress" | "resolved" | "rejected";

export interface CivicIssue {
  id: number;
  reference: string;
  category: IssueCategory;
  category_label: string;
  description: string;
  severity: IssueSeverity;
  status: IssueStatus;
  is_demo: boolean;
  duplicate_of: number | null;
  moderation_note: string | null;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  resolved_at: string | null;
  longitude: number;
  latitude: number;
  reporter_name: string | null;
  geometry: { type: "Point"; coordinates: [number, number] };
  duplicate_warning?: string;
}

export interface CivicIssueList {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: CivicIssue;
  }>;
  counts: Record<string, number>;
  total: number;
  categories: Record<string, string>;
  duplicate_policy: { radius_m: number; window_days: number };
}

export interface CivicStats {
  total: number;
  real_reports: number;
  demo_reports: number;
  duplicates: number;
  resolved_last_30_days: number;
  by_status: Record<string, number>;
  by_category: Record<string, number>;
  by_severity: Record<string, number>;
}

export interface Hotspot {
  cluster_id: number;
  issue_count: number;
  dominant_category: string;
  high_severity: number;
  approximate_radius_m: number;
  center: { longitude: number; latitude: number };
}

export interface AnalystAnswer {
  question: string;
  intent: string | null;
  answer: string;
  facts: Array<{ label: string; value: string | number | null }>;
  sources: Array<{
    dataset: string;
    type: string;
    collected: string | null;
    note: string;
  }>;
  limitations: string[];
  suggestions?: string[];
  generated_at?: string;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { signal });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `${path} failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`,
    );
  }
  return (await response.json()) as T;
}

async function send<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text) as { detail?: unknown };
      if (parsed.detail) message = JSON.stringify(parsed.detail);
    } catch {
      /* keep raw text */
    }
    throw new Error(message || `HTTP ${response.status}`);
  }
  return JSON.parse(text) as T;
}

export const api = {
  layers: (signal?: AbortSignal) => get<LayerInfo[]>("/layers", signal),
  layerGeoJson: (layerId: string, signal?: AbortSignal) =>
    get<GeoJsonFeatureCollection>(`/layers/${encodeURIComponent(layerId)}/geojson`, signal),
  aoi: (signal?: AbortSignal) => get<AoiBoundary>("/aoi", signal),
  summary: (signal?: AbortSignal) => get<Summary>("/summary", signal),
  network: (signal?: AbortSignal) =>
    get<{
      segments: number;
      total_length_km: number;
      named_segments: number;
      by_class: Array<{ highway_class: string; segments: number; length_km: number }>;
      note: string;
    }>("/analytics/network", signal),
  greenCover: (signal?: AbortSignal) =>
    get<{
      mapped_green_area_ha: number;
      aoi_area_ha: number;
      mapped_share_of_aoi_percent: number | null;
      largest_areas: Array<{ name: string; category: string; area_ha: number }>;
      note: string;
    }>("/analytics/green-cover", signal),
  health: (signal?: AbortSignal) => get<Record<string, unknown>>("/health", signal),

  // Environmental intelligence
  environmentOverview: (days = 14, signal?: AbortSignal) =>
    get<EnvironmentOverview>(`/environment/overview?days=${days}`, signal),
  environmentSources: (signal?: AbortSignal) => get<EnvironmentSource[]>("/environment/sources", signal),
  refreshEnvironment: (days = 7) =>
    send<{ status: string; air_quality_rows: number; temperature_rows: number }>(
      `/environment/refresh?days=${days}`,
      "POST",
      {},

    ),

  // NEW: Station and observation endpoints
  environmentStations: (signal?: AbortSignal) =>
    get<EnvironmentStation[]>(`/environment/stations`, signal),
  environmentObservations: (stationId: string, variable: string, signal?: AbortSignal) =>
    get<{ variable: string; value: number | null; observed_at: string; unit: string; quality_flag: string }[]>(
      `/environment/observations?station_id=${encodeURIComponent(stationId)}&variable=${encodeURIComponent(variable)}`,
      signal,
    ),

  // Civic issue reporting
  civicIssues: (
    params: { status?: string; category?: string; include_demo?: boolean } = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.category) query.set("category", params.category);
    if (params.include_demo !== undefined) query.set("include_demo", String(params.include_demo));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return get<CivicIssueList>(`/civic-issues${suffix}`, signal);
  },
  civicStats: (signal?: AbortSignal) => get<CivicStats>("/civic-issues/stats", signal),
  civicHotspots: (radius = 250, minIssues = 2, signal?: AbortSignal) =>
    get<{ clusters: Hotspot[]; method: string; radius_m: number; min_issues: number }>(
      `/civic-issues/hotspots?radius_m=${radius}&min_issues=${minIssues}`,
      signal,
    ),
  createCivicIssue: (payload: {
    category: IssueCategory;
    description: string;
    severity: IssueSeverity;
    latitude: number;
    longitude: number;
    reporter_name?: string;
    reporter_contact?: string;
  }) => send<CivicIssue>("/civic-issues", "POST", payload),
  updateCivicStatus: (id: number, status: IssueStatus, moderation_note?: string) =>
    send<CivicIssue>(`/civic-issues/${id}/status`, "PATCH", { status, moderation_note }),

  // Grounded analyst
  askAnalyst: (question: string) => send<AnalystAnswer>("/analyst/ask", "POST", { question }),
  analystCapabilities: (signal?: AbortSignal) =>
    get<{ categories: string[]; examples: string[]; policy: string }>(
      "/analyst/capabilities",
      signal,
    ),
};