import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("requests the layer index from /api/layers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([{ id: "roads", name: "Road Network", table_name: "roads" }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const layers = await api.layers();

    expect(fetchMock).toHaveBeenCalledWith("/api/layers", { signal: undefined });
    expect(layers[0].table_name).toBe("roads");
  });

  it("url-encodes layer ids in the geojson route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ type: "FeatureCollection", features: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await api.layerGeoJson("green spaces");

    expect(fetchMock).toHaveBeenCalledWith("/api/layers/green%20spaces/geojson", {
      signal: undefined,
    });
  });

  it("throws with the HTTP status when the backend rejects a request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "Layer not found" }, 404)),
    );

    await expect(api.layers()).rejects.toThrow(/HTTP 404/);
  });

  it("surfaces AOI properties from the backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [] },
          properties: { name: "Maharaj Bada Study Area", city: "Gwalior", state: "Madhya Pradesh", area_km2: 4.434 },
        }),
      ),
    );

    const aoi = await api.aoi();
    expect(aoi.properties.area_km2).toBeCloseTo(4.434);
    expect(aoi.properties.city).toBe("Gwalior");
  });
});
