import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type EnvironmentOverview, type Summary } from "../lib/api";

const CANOPY_M2_PER_TREE = 25;

type Baseline = {
  aoiAreaHa: number;
  greenHa: number;
  greenSharePercent: number;
  roadKm: number;
  roadByClass: Array<{ highway_class: string; segments: number; length_km: number }>;
  buildings: number;
  pm25Mean24h: number | null;
  pm25Latest: number | null;
  tempMaxAvg: number | null;
};

const ScenarioLab = () => {
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [overview, setOverview] = useState<EnvironmentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [addedGreenPercent, setAddedGreenPercent] = useState(4);
  const [trees, setTrees] = useState(1500);
  const [responseCoefficient, setResponseCoefficient] = useState(0.4);
  const [closedClass, setClosedClass] = useState("secondary");
  const [closurePercent, setClosurePercent] = useState(20);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [summaryData, network, green, environment] = await Promise.all([
        api.summary(signal),
        api.network(signal),
        api.greenCover(signal),
        api.environmentOverview(14, signal),
      ]);
      const pm25 = environment.air_quality.pollutants.find((item) => item.variable === "pm2_5");
      const tempMaxValues = environment.temperature.days
        .map((day) => day.max)
        .filter((value): value is number => typeof value === "number");
      setSummary(summaryData);
      setOverview(environment);
      setBaseline({
        aoiAreaHa: green.aoi_area_ha,
        greenHa: green.mapped_green_area_ha,
        greenSharePercent: green.mapped_share_of_aoi_percent ?? 0,
        roadKm: network.total_length_km,
        roadByClass: network.by_class,
        buildings:
          summaryData.layers.find((layer) => layer.table === "buildings")?.feature_count ?? 0,
        pm25Mean24h: pm25?.mean_24h ?? null,
        pm25Latest: pm25?.latest ?? null,
        tempMaxAvg: tempMaxValues.length
          ? tempMaxValues.reduce((total, value) => total + value, 0) / tempMaxValues.length
          : null,
      });
      setError(null);
    } catch (loadError) {
      if ((loadError as Error).name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Failed to load baseline data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const model = useMemo(() => {
    if (!baseline) return null;

    // 1. Green area added by the direct polygon expansion assumption.
    const expansionHa = (baseline.aoiAreaHa * addedGreenPercent) / 100;
    // 2. Canopy area from planted trees.
    const canopyHa = (trees * CANOPY_M2_PER_TREE) / 10_000;
    const addedHa = expansionHa + canopyHa;
    const newGreenHa = baseline.greenHa + addedHa;
    const newSharePercent = baseline.aoiAreaHa
      ? (newGreenHa / baseline.aoiAreaHa) * 100
      : 0;
    const deltaShare = newSharePercent - baseline.greenSharePercent;

    // 3. Air-quality response: explicitly a user-set assumption, not a measurement.
    const pm25ChangePercent = -deltaShare * responseCoefficient;
    const pm25Projected =
      baseline.pm25Mean24h === null
        ? null
        : baseline.pm25Mean24h * (1 + pm25ChangePercent / 100);

    // 4. Road closure: only network arithmetic, no traffic model exists.
    const classRow = baseline.roadByClass.find((row) => row.highway_class === closedClass);
    const closedKm = classRow ? (classRow.length_km * closurePercent) / 100 : 0;
    const closedShare = baseline.roadKm ? (closedKm / baseline.roadKm) * 100 : 0;

    return {
      expansionHa,
      canopyHa,
      addedHa,
      newGreenHa,
      newSharePercent,
      deltaShare,
      pm25ChangePercent,
      pm25Projected,
      classRow,
      closedKm,
      closedShare,
    };
  }, [baseline, addedGreenPercent, trees, responseCoefficient, closedClass, closurePercent]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-widest text-accent-cyan/80 mb-1">Simulation</p>
          <h1 className="text-2xl md:text-3xl font-semibold">Scenario Lab</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
            Every scenario starts from measured baseline values read from the database, applies an
            explicit formula, and labels the result simulated. The air-quality response coefficient
            is a user-adjustable assumption, not a value derived from a study — the uncertainty of
            that assumption is the dominant term in the result.
          </p>
        </header>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading || !baseline || !model ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading baseline dataset…
          </div>
        ) : (
          <>
            <section className="mb-6 rounded-xl border border-border bg-secondary/40 p-4">
              <h2 className="text-sm font-medium mb-2">Baseline dataset (measured / computed)</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">AOI area</p>
                  <p className="text-lg">{baseline.aoiAreaHa.toFixed(0)} ha</p>
                  <p className="text-[10px] text-muted-foreground">
                    {summary?.aoi?.name ?? "AOI"} polygon
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Mapped green space</p>
                  <p className="text-lg">{baseline.greenHa.toFixed(1)} ha</p>
                  <p className="text-[10px] text-muted-foreground">
                    {baseline.greenSharePercent.toFixed(2)}% of AOI · OSM polygons
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Road network</p>
                  <p className="text-lg">{baseline.roadKm.toFixed(1)} km</p>
                  <p className="text-[10px] text-muted-foreground">OSM geometry</p>
                </div>
                <div>
                  <p className="text-muted-foreground">PM2.5 (24 h mean)</p>
                  <p className="text-lg">
                    {baseline.pm25Mean24h !== null ? `${baseline.pm25Mean24h.toFixed(1)} µg/m³` : "unavailable"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    CAMS modelled{baseline.pm25Latest !== null ? ` · latest ${baseline.pm25Latest} µg/m³` : ""}
                  </p>
                </div>
              </div>
            </section>

            <div className="grid lg:grid-cols-2 gap-6">
              <section className="rounded-xl border border-border bg-card p-4 space-y-4">
                <h2 className="text-sm font-medium">Input parameters</h2>

                <label className="block text-xs space-y-1">
                  <div className="flex justify-between">
                    <span>Additional green area as % of AOI</span>
                    <span className="text-foreground">{addedGreenPercent}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    step={0.5}
                    value={addedGreenPercent}
                    onChange={(event) => setAddedGreenPercent(Number(event.target.value))}
                    className="w-full accent-[#39D5FF]"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    Assumes the added area is fully realised as continuous green cover.
                  </span>
                </label>

                <label className="block text-xs space-y-1">
                  <div className="flex justify-between">
                    <span>Trees planted (25 m² mature canopy each)</span>
                    <span className="text-foreground">{trees.toLocaleString()}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5000}
                    step={100}
                    value={trees}
                    onChange={(event) => setTrees(Number(event.target.value))}
                    className="w-full accent-[#39D5FF]"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    Canopy area assumes full maturity; establishment loss and mortality are not modelled.
                  </span>
                </label>

                <label className="block text-xs space-y-1">
                  <div className="flex justify-between">
                    <span>Assumed PM2.5 response (% per green-share point)</span>
                    <span className="text-foreground">{responseCoefficient.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={responseCoefficient}
                    onChange={(event) => setResponseCoefficient(Number(event.target.value))}
                    className="w-full accent-[#A78BFA]"
                  />
                  <span className="text-[10px] text-amber-300">
                    Assumption only — no local study establishes this coefficient.
                  </span>
                </label>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="space-y-1">
                    <span className="text-muted-foreground">Road class partially closed</span>
                    <select
                      value={closedClass}
                      onChange={(event) => setClosedClass(event.target.value)}
                      className="w-full rounded-lg bg-secondary border border-border px-2 py-1.5"
                    >
                      {baseline.roadByClass.map((row) => (
                        <option key={row.highway_class} value={row.highway_class}>
                          {row.highway_class} ({row.length_km} km)
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Closed share</span>
                      <span>{closurePercent}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={closurePercent}
                      onChange={(event) => setClosurePercent(Number(event.target.value))}
                      className="w-full accent-[#F87171]"
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-4">
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-medium">Simulated output</h2>
                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                      simulated
                    </span>
                  </div>
                  <dl className="mt-3 space-y-2 text-xs">
                    <div className="flex justify-between border-b border-border pb-1">
                      <dt className="text-muted-foreground">Green area added</dt>
                      <dd>+{model.addedHa.toFixed(1)} ha</dd>
                    </div>
                    <div className="flex justify-between border-b border-border pb-1">
                      <dt className="text-muted-foreground">Green share of AOI</dt>
                      <dd>
                        {baseline.greenSharePercent.toFixed(2)}% → {model.newSharePercent.toFixed(2)}%
                      </dd>
                    </div>
                    <div className="flex justify-between border-b border-border pb-1">
                      <dt className="text-muted-foreground">PM2.5 change (assumed)</dt>
                      <dd>
                        {model.pm25ChangePercent.toFixed(2)}% → {model.pm25Projected !== null ? `${model.pm25Projected.toFixed(1)} µg/m³` : "baseline unavailable"}
                      </dd>
                    </div>
                    <div className="flex justify-between border-b border-border pb-1">
                      <dt className="text-muted-foreground">Road length removed from use</dt>
                      <dd>
                        {model.closedKm.toFixed(2)} km ({model.closedShare.toFixed(1)}% of network)
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Temperature effect</dt>
                      <dd className="text-muted-foreground">not modelled</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-xl border border-border bg-card p-4 text-xs">
                  <h2 className="text-sm font-medium mb-2">Methodology</h2>
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>
                      <span className="text-foreground">Green area added</span> = AOI area × added
                      percent ÷ 100 + trees × {CANOPY_M2_PER_TREE} m² ÷ 10 000.
                    </li>
                    <li>
                      <span className="text-foreground">New green share</span> = (baseline green
                      area + added area) ÷ AOI area × 100.
                    </li>
                    <li>
                      <span className="text-foreground">PM2.5 change</span> = −(Δ green share) ×
                      response coefficient, applied to the CAMS 24 h mean.
                    </li>
                    <li>
                      <span className="text-foreground">Road removal</span> = class length × closed
                      share, from OSM segment lengths.
                    </li>
                  </ol>

                  <h2 className="text-sm font-medium mt-4 mb-1">Limitations</h2>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>
                      The PM2.5 coefficient is an assumption. Changing it from 0.05 to 2.0 changes
                      the result by more than an order of magnitude.
                    </li>
                    <li>
                      CAMS is a ~40 km modelled grid; a local greening intervention is far smaller
                      than one grid cell, so the model cannot resolve it physically.
                    </li>
                    <li>
                      No traffic counts, speeds or emissions model exist, so congestion, idling and
                      emission redistribution from a road closure are not computed.
                    </li>
                    <li>
                      OSM green-space mapping is incomplete, so the baseline green share is a lower
                      bound and the simulated delta is displaced by that bias.
                    </li>
                    <li>
                      These outputs are scenario arithmetic, not forecasts or measured outcomes.
                    </li>
                  </ul>
                  {overview?.notes.map((note) => (
                    <p key={note} className="mt-2 text-[11px] text-muted-foreground">
                      · {note}
                    </p>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ScenarioLab;
