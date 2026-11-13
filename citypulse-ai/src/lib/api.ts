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
};
