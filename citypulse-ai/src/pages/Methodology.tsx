const SECTIONS = [
  {
    title: "Scope and study area",
    body: [
      "CityPulse AI models a 4.434 km² study area: a rectangle between longitude 78.170–78.190 E and latitude 26.210–26.230 N. The Virtual City inside it is fully generated; the 2D and 3D layers are ingested from OpenStreetMap.",
      "The AOI is stored as a single SRID 4326 polygon in aoi_boundary and every ingested feature is clipped to it. It is a documented study rectangle, not a surveyed municipal boundary — no authoritative polygon was found (see docs/aoi-boundary-investigation.md).",
    ],
  },
];

const DataTypes = () => (
  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
    {[
      {
        label: "Measured / observed",
        colour: "text-accent-teal",
        body: "CPCB CAAQMS station readings and citizen-submitted civic reports. Stored in their own tables, never mixed with model output.",
      },
      {
        label: "Modelled",
        colour: "text-accent-cyan",
        body: "CAMS air quality (~40 km grid, hourly) and ERA5/IFS temperature (~9–11 km, daily) via Open-Meteo, sampled at the AOI centroid.",
      },
      {
        label: "Derived",
        colour: "text-accent-violet",
        body: "Green cover from mapped OSM polygons, and road lengths measured from geometry in UTM 44N. Lower bounds, stated as such.",
      },
      {
        label: "Simulated",
        colour: "text-amber-300",
        body: "Scenario Lab outputs only. Arithmetic over real baselines with a user-set coefficient; not forecasts and not measured outcomes.",
      },
    ].map((item) => (
      <div key={item.label} className="rounded-xl border border-border bg-card px-4 py-3">
        <p className={`font-medium ${item.colour}`}>{item.label}</p>
        <p className="mt-1 text-muted-foreground leading-relaxed">{item.body}</p>
      </div>
    ))}
  </div>
);

const Methodology = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-widest text-accent-cyan/80 mb-1">Research</p>
          <h1 className="text-2xl md:text-3xl font-semibold">Methodology</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
            How the data is obtained, stored, analysed and presented — including what the platform
            deliberately does not claim.
          </p>
        </header>

        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">Data types</h2>
          <DataTypes />
          <p className="mt-3 text-xs text-muted-foreground">
            These four categories are never merged into a single headline metric. The Environment
            page shows modelled and observed values in separate sections, and any observed value is
            displayed with its station and observation timestamp.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">Architecture</h2>
          <div className="rounded-xl border border-border bg-card p-4 text-xs">
            <pre className="overflow-x-auto text-muted-foreground leading-relaxed">{`OSM PBF extract ─┐
Open-Meteo CAMS ─┼─► ingestion (Python) ─► PostgreSQL 14 + PostGIS 3.2
CPCB CAAQMS ─────┘                              │
                                                ▼
                                        FastAPI (SQLAlchemy)
                                                │  /api/*
                                                ▼
                              React 18 + Vite (Leaflet 2D, CesiumJS 3D)`}</pre>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <span className="text-foreground">Ingestion</span> — ingest_aoi.py (geometry),
              environment_ingest.py (CAMS/ERA5), station_ingest.py (CPCB stations). Each records
              provenance and can be re-run.
            </li>
            <li>
              <span className="text-foreground">Storage</span> — PostGIS geometry in EPSG:4326;
              metric measurements in EPSG:32644 (UTM 44N). Observation tables carry source, dataset,
              data type, unit and fetch timestamp.
            </li>
            <li>
              <span className="text-foreground">API</span> — FastAPI routers for geographic layers,
              analytics, environment, civic reporting and the analyst. Responses state data type and
              limitations.
            </li>
            <li>
              <span className="text-foreground">Frontend</span> — one typed API client; the 3D view
              is lazy-loaded so the 2D map paints first.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">Database design</h2>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="bg-secondary text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Table</th>
                  <th className="text-left px-3 py-2 font-medium">Contents</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                {[
                  ["aoi_boundary", "Study-area polygon, name, area in km²"],
                  ["roads / buildings / facilities / green_spaces", "OSM geometry clipped to the AOI, with OSM attributes"],
                  ["geographic_layers / dataset_metadata", "Layer registry, provenance, licence, limitations"],
                  ["environmental_observations", "Modelled CAMS/ERA5 series with dataset, data_type, unit, fetched_at"],
                  ["environment_datasets", "Provenance per environmental dataset"],
                  ["stations / air_quality_observations", "CPCB station metadata and observed readings, keyed by station and timestamp (unique per station + variable + time)"],
                  ["civic_issues", "Citizen reports: category, severity, status, PostGIS point, duplicate_of"],
                ].map(([table, contents]) => (
                  <tr key={table} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-[11px] text-foreground align-top">{table}</td>
                    <td className="px-3 py-2">{contents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            GiST indexes exist on every geometry column. Observed and modelled air quality live in
            different tables so they cannot be accidentally aggregated together.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">Geographic method</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              Features are read from the Madhya Pradesh OSM PBF extract, filtered by bounding box,
              clipped to the AOI polygon, repaired where invalid, and deduplicated on OSM id.
            </li>
            <li>
              Lengths are computed in UTM 44N (EPSG:32644), not in degrees; areas likewise.
            </li>
            <li>
              Building heights use the osm:height tag where present. Otherwise an illustrative
              extrusion of 3.2 m per storey is used and labelled as illustrative in the 3D overlay —
              only 1 of 127 buildings carries an OSM height.
            </li>
            <li>
              Station distance to the AOI is measured to the nearest AOI boundary on the WGS84
              ellipsoid using ST_Distance over geography, and is exactly 0 km when the station lies
              inside or on the AOI (ST_Covers). It is not the distance to the centroid.
            </li>
            <li>
              Civic hotspots use ST_ClusterDBSCAN (ε = 250 m by default, minimum 2 open reports) in
              EPSG:3857; duplicate detection uses distance plus category plus a 30-day window.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">Analytical methods and formulas</h2>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              <span className="text-foreground">Network statistics</span> — counts and length sums
              grouped by the OSM highway tag, plus the share of segments carrying each attribute.
              No speed or volume is derived.
            </p>
            <p>
              <span className="text-foreground">WHO comparison</span> — the 24-hour mean of each
              modelled pollutant is compared against the WHO 2021 24-hour AQG level (PM2.5 15, PM10
              45, NO₂ 25 µg/m³) and the comparison is labelled per pollutant.
            </p>
            <p className="text-foreground">Scenario Lab</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Added green area = AOI area × added % ÷ 100 + trees × 25 m² ÷ 10 000</li>
              <li>New green share = (baseline green + added) ÷ AOI area × 100</li>
              <li>PM2.5 change % = −(Δ green share) × response coefficient (user-set, 0–2)</li>
              <li>Road length removed = class length × closed share</li>
            </ul>
            <p>
              The response coefficient is an assumption, not an empirical value; changing it
              from 0.05 to 2.0 changes the result by more than an order of magnitude. Temperature
              effects are not modelled.
            </p>
            <p>
              <span className="text-foreground">Analyst</span> — question classification followed by
              parameterised SQL over the stored tables. There is no language model and no
              per-question canned answer; unsupported questions return a refusal with no facts.
            </p>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">Data provenance</h2>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="bg-secondary text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Dataset</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-left px-3 py-2 font-medium">Licence</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                {[
                  ["OpenStreetMap (roads, buildings, facilities, green space)", "measured geometry", "ODbL 1.0"],
                  ["CAMS global via Open-Meteo", "modelled", "CC BY 4.0 (ECMWF/Copernicus)"],
                  ["ERA5 / IFS via Open-Meteo", "modelled", "CC BY 4.0 (ECMWF/Copernicus)"],
                  ["CPCB CAAQMS (CCR portal / XKDR API)", "observed", "CPCB public data"],
                  ["Citizen civic reports", "reported, unverified", "submitted by users"],
                ].map(([dataset, type, licence]) => (
                  <tr key={dataset} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground">{dataset}</td>
                    <td className="px-3 py-2">{type}</td>
                    <td className="px-3 py-2">{licence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Full field-level provenance, update frequency and limitations:{" "}
            <code className="text-accent-cyan">docs/data-sources.md</code>. The running API exposes
            the same information at <code className="text-accent-cyan">/api/environment/sources</code>.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">Reproducibility</h2>
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
            <li>Provision PostgreSQL 14 + PostGIS 3.2 (scripts/setup_postgis_wsl.sh, or Docker Compose).</li>
            <li>pip install -r requirements.txt into a Python 3.12 virtual environment.</li>
            <li>Run setup_db.py, then ingest_aoi.py; validate_data.py writes a JSON validation report.</li>
            <li>Run environment_ingest.py (and station_ingest.py with an XKDR key if available).</li>
            <li>Start uvicorn on port 8000, then npm run dev on port 5173.</li>
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            Ingest and validation runs write timestamped JSON reports. All configuration is read from
            environment variables (DATABASE_URL, XKDR_AQI_KEY, CORS_ORIGINS).
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium mb-3">Known limitations</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>No traffic volumes, speeds or congestion measurements exist; the Traffic page reports network composition only.</li>
            <li>Air quality and temperature are modelled grids sampled at one point, not station measurements. Street-level variation is unresolved.</li>
            <li>CPCB station observations are only present once retrieved with an API key; until then the platform reports them as unavailable rather than estimating them.</li>
            <li>OSM coverage is sparse: 127 buildings and 25 facilities across 4.4 km², so mapped features understate the real city.</li>
            <li>The AOI is a documented rectangle, not a surveyed boundary.</li>
            <li>No NDVI or land-surface temperature product is configured; both are reported unavailable.</li>
            <li>No machine-learning model is trained — there is no validated target variable with enough local data. The analyst is deterministic SQL.</li>
            <li>Citizen reports are unverified self-selections; moderation status is the only verification signal.</li>
            <li>Scenario outputs are arithmetic with stated assumptions, not forecasts.</li>
          </ul>
        </section>
      </div>
    </div>
  );
};

export default Methodology;
