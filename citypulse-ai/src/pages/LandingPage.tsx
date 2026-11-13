import { Link } from "react-router-dom";

const MODULES = [
  {
    to: "/digital-twin",
    title: "Digital Twin",
    tag: "real OSM geometry",
    body:
      "862 road segments, 127 building footprints, 25 facilities and 5 green spaces inside the AOI, rendered in 2D (Leaflet) and 3D (CesiumJS) with layer toggles and a feature inspector.",
  },
  {
    to: "/traffic",
    title: "Road Network Intelligence",
    tag: "measured geometry",
    body:
      "Network length by highway class, named-segment share and OSM attribute completeness. No traffic volumes or congestion are shown, because none are measured for this area.",
  },
  {
    to: "/environment",
    title: "Environmental Intelligence",
    tag: "modelled + observed",
    body:
      "CAMS air quality and ERA5/IFS temperature with WHO 2021 guideline comparison, kept strictly separate from CPCB ground-station readings, plus OSM-derived green cover.",
  },
  {
    to: "/civic-issues",
    title: "Civic Reporting",
    tag: "citizen submissions",
    body:
      "Report potholes, garbage, drainage, streetlight, water-supply and road-damage issues on the map. Duplicate linkage, a moderation state machine and DBSCAN hotspot analysis.",
  },
  {
    to: "/ai-analyst",
    title: "Urban Analyst",
    tag: "SQL over stored data",
    body:
      "Ask questions in plain language; answers are computed by queries over the ingested datasets, cite their dataset and observation date, and refuse what the data cannot support.",
  },
  {
    to: "/scenario-lab",
    title: "Scenario Lab",
    tag: "simulated",
    body:
      "Green-space and road-closure scenarios computed from real baseline values, with the formula, the assumption and its uncertainty printed next to every simulated result.",
  },
];

const STACK = [
  ["Frontend", "React 18, TypeScript, Vite 5, Tailwind CSS"],
  ["Maps", "Leaflet / react-leaflet (2D), CesiumJS (3D)"],
  ["Backend", "FastAPI, SQLAlchemy, Pydantic"],
  ["Database", "PostgreSQL 14 + PostGIS 3.2 (WGS84 geometry)"],
  ["Data", "OpenStreetMap, Copernicus CAMS, ERA5/IFS via Open-Meteo, CPCB CAAQMS"],
  ["Tests", "pytest (API + PostGIS), Vitest"],
];

const LandingPage = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <svg className="w-5 h-5 text-background" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </span>
            <span className="text-lg font-semibold tracking-tight text-primary">CityPulse AI</span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              to="/methodology"
              className="hidden sm:inline-block px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              Methodology
            </Link>
            <Link
              to="/digital-twin"
              className="px-4 py-2 rounded-lg bg-primary text-background font-medium hover:opacity-90 transition-opacity"
            >
              Open dashboard
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="max-w-7xl mx-auto px-4 pt-14 pb-10">
          <div className="grid lg:grid-cols-[1.05fr_1fr] gap-10 items-center">
            <div>
              <p className="text-xs uppercase tracking-widest text-accent-cyan/80 mb-3">
                Maharaj Bada / Lashkar, Gwalior · 4.434 km²
              </p>
              <h1 className="text-4xl md:text-5xl font-semibold leading-tight tracking-tight">
                Understand Your City.
                <br />
                <span className="text-primary">Anticipate Its Future.</span>
              </h1>
              <p className="mt-5 text-base text-muted-foreground max-w-xl leading-relaxed">
                An urban analytics and digital-twin platform built on real geospatial data. Explore
                the road network and building footprints, read modelled environmental fields, report
                civic issues and test development scenarios — with every number labelled by how it
                was produced.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  to="/digital-twin"
                  className="px-6 py-3 rounded-xl bg-primary text-background font-medium hover:opacity-90 transition-opacity"
                >
                  Explore the dashboard
                </Link>
                <Link
                  to="/methodology"
                  className="px-6 py-3 rounded-xl border border-border bg-card text-foreground font-medium hover:border-primary transition-colors"
                >
                  Read the methodology
                </Link>
              </div>
              <dl className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                {[
                  ["862", "road segments"],
                  ["127", "buildings"],
                  ["984", "environment rows"],
                  ["2", "CPCB stations"],
                ].map(([value, label]) => (
                  <div key={label}>
                    <dt className="text-xl font-semibold text-primary">{value}</dt>
                    <dd className="text-xs text-muted-foreground">{label}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <img
                src="/screenshots/digital-twin-3d.png"
                alt="CityPulse AI digital twin showing extruded buildings, roads and the AOI boundary over satellite imagery of Maharaj Bada"
                className="w-full h-auto"
                loading="eager"
              />
              <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border">
                Actual application capture — Digital Twin 3D over Esri World Imagery. Building
                extrusions use OSM height where tagged and are otherwise illustrative.
              </p>
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 py-10 border-t border-border">
          <h2 className="text-2xl font-semibold">What the platform does</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
            Six connected modules over one PostGIS database. Each one states its own data type:
            measured, modelled, derived or simulated.
          </p>
          <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {MODULES.map((module) => (
              <Link
                key={module.to}
                to={module.to}
                className="group rounded-xl border border-border bg-card p-5 hover:border-primary/60 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium group-hover:text-primary transition-colors">
                    {module.title}
                  </h3>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-secondary text-muted-foreground">
                    {module.tag}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{module.body}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 py-10 border-t border-border">
          <div className="grid lg:grid-cols-2 gap-8 items-start">
            <div>
              <h2 className="text-2xl font-semibold">Built to be honest about its data</h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                Urban dashboards often present model output as measurement. Every value here carries
                its provenance, and gaps are shown as gaps.
              </p>
              <ul className="mt-4 space-y-3 text-sm">
                <li className="rounded-lg border border-border bg-card px-4 py-3">
                  <span className="font-medium text-accent-cyan">Modelled</span> — CAMS air quality
                  (~40 km grid) and ERA5/IFS temperature (~9–11 km), sampled at the AOI centroid.
                  Never presented as a station reading.
                </li>
                <li className="rounded-lg border border-border bg-card px-4 py-3">
                  <span className="font-medium text-accent-teal">Observed</span> — CPCB CAAQMS
                  stations in Gwalior, stored separately. Shown as unavailable until observation
                  rows are actually retrieved.
                </li>
                <li className="rounded-lg border border-border bg-card px-4 py-3">
                  <span className="font-medium text-accent-teal">Derived / simulated</span> — green
                  cover from mapped OSM polygons (a lower bound); Scenario Lab arithmetic with a
                  user-set coefficient.
                </li>
              </ul>
            </div>
            <div className="space-y-4">
              <img
                src="/screenshots/environment.png"
                alt="Environment page showing modelled PM2.5, PM10 and NO2 values with WHO guideline comparison and Gwalior monitoring stations"
                className="w-full h-auto rounded-xl border border-border"
                loading="lazy"
              />
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                <strong className="font-semibold">Known limitations.</strong> No traffic volumes or
                congestion data exist. OSM coverage in Gwalior is sparse (127 mapped buildings in
                4.4 km²), so the 3D extrusion is mostly illustrative. The AOI is a documented
                rectangle, not a surveyed boundary. No ML model is trained — the analyst uses SQL,
                not a language model.
              </div>
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 py-10 border-t border-border">
          <h2 className="text-2xl font-semibold">Technology stack</h2>
          <dl className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            {STACK.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-card px-4 py-3">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd className="mt-1">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-xs text-muted-foreground">
            © OpenStreetMap contributors (ODbL 1.0) · CAMS and ERA5 © ECMWF/Copernicus, served by
            Open-Meteo · CPCB Central Pollution Control Board, CAAQMS.
          </p>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-4 py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>CityPulse AI — urban analytics for Gwalior, Madhya Pradesh.</span>
          <div className="flex gap-4">
            <Link to="/methodology" className="hover:text-foreground">
              Methodology
            </Link>
            <Link to="/digital-twin" className="hover:text-foreground">
              Dashboard
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
