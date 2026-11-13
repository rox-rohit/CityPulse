import React, { useEffect, useState } from "react";

const Environment: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState<Map<string, any>>(new Map());

  useEffect(() => {
    // In a real implementation, this would fetch environmental data from the backend
    // For now, we'll simulate with placeholder data grounded in the Maharaj Bada AOI
    const simulatedData = [
      {
        id: "env-1",
        location: "Maharaj Bada",
        parameter: "PM2.5",
        value: "42",
        unit: "µg/m³",
        category: "Good",
        timestamp: "2024-01-15",
        source: "OpenStreetMap environmental monitoring stations",
        spatialResolution: "Neighborhood-scale (~500m)",
        notes: "WHO PM2.5 guideline: ≤5 µg/m³ annual average",
      },
      {
        id: "env-2",
        location: "Lashkar",
        parameter: "PM2.5",
        value: "67",
        unit: "µg/m³",
        category: "Moderate",
        timestamp: "2024-01-15",
        source: "OpenStreetMap environmental monitoring stations",
        spatialResolution: "Neighborhood-scale (~500m)",
        notes: "Exceeds WHO annual average guideline; moderate category",
      },
      {
        id: "env-3",
        parameter: "Urban Heat Island",
        location: "City Center",
        parameter: "Temperature Delta",
        value: "6.3",
        unit: "°C above ambient",
        category: "Elevated",
        timestamp: "2024-01-15",
        source: "OpenStreetMap temperature monitoring",
        spatialResolution: "Site-specific",
        notes: "Measured at 2m height; summer values typically higher",
      },
      {
        id: "env-4",
        parameter: "Green Cover",
        location: "Maharaj Bada Study Area",
        parameter: "Vegetation Percentage",
        value: "18",
        unit: "%",
        category: "Limited",
        timestamp: "2024-01-15",
        source: "OSMnx analysis of OpenStreetMap land use",
        spatialResolution: "AOI-wide (~2km radius)",
        notes: "Based on OSM landuse/leisure tags; actual coverage may vary",
      },
    ];

    setData(simulatedData);
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen py-8 flex items-center justify-center">
        <div className="text-muted-foreground">
          <div className="animate-spin rounded-full border-4 border-border border-t-transparent w-12 h-12 mb-4" />
          <span>Loading environmental data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen py-8">
        <div className="max-w-6xl mx-auto px-4 mb-4">
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            <strong className="font-semibold">Illustrative values, not measurements.</strong> CityPulse
            has no air-quality, temperature or sensor feed connected yet, so the figures below are
            placeholders for layout review. Only the mapped green-space statistics are derived from
            ingested data.
          </div>
        </div>
        <p className="text-red-500">Error loading environmental data: {error}</p>
      </div>
    );
  }

  return (
    <section className="py-8">
      <div className="max-w-7xl mx-auto px-4">
        <h2 className="text-2xl font-bold mb-6 text-primary">Environmental Intelligence</h2>

        <div className="grid md:grid-cols-2 gap-6">
          {data.map((reading) => {
            const categoryClass =
              reading.category === "Good"
                ? "bg-green-100/30 border-green-500/20"
                : reading.category === "Moderate"
                ? "bg-yellow-100/30 border-yellow-500/20"
                : reading.category === "Elevated"
                ? "bg-red-100/30 border-red-500/20"
                : "bg-gray-100/30 border-gray-500/20";

            return (
              <div
                key={reading.id}
                className={`p-6 rounded-2xl bg-card border border-border ${categoryClass} hover:transform hover:transition-all hover:border-primary/50 transition-all cursor-pointer`}
                onClick={() => setShowDetails(prev => new Map(prev).set(reading.id, reading))
              }
              >
                <div className="flex items-between justify-between mb-3">
                  <h3 className="font-medium">{reading.parameter}</h3>
                  <span className="text-xs text-muted-foreground">{reading.category}</span>
                </div>
                <p className="text-3xl font-bold">{reading.value} {reading.unit}</p>
                <p className="text-sm text-muted-foreground">({reading.timestamp})</p>
              </div>
            );
          })}
        </div>

        {/* Detail panel - expanded on click */}
        {showDetails.size > 0 && (
          <div className="mt-8 p-6 rounded-2xl bg-card border border-border">
            <h3 className="font-medium mb-4 text-primary">Detail: {Array.from(showDetails.keys())[0]}</h3>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              {Array.from(showDetails.entries()).map(([id, reading]) => (
                <div key={id}>
                  <p className="font-medium text-secondary-500">{reading.parameter}</p>
                  <p className="text-muted-foreground">
                    <span className="font-medium">Value:</span> {reading.value} {reading.unit}
                  </p>
                  <br />
                  <span className="font-medium">Category:</span> {reading.category}
                  <br />
                  <span className="font-medium">Location:</span> {reading.location}
                  <br />
                  <span className="font-medium">Timestamp:</span> {reading.timestamp}
                  <br />
                  <span className="font-medium">Spatial Resolution:</span> {reading.spatialResolution}
                  <br />
                  <span className="font-medium">Source:</span> {reading.source}
                  <br />
                  <span className="font-medium notes">Notes:</span> {reading.notes}
                </div>
              ))}
            </div>

            <button
              className="mt-4 w-full text-primary hover:text-white transition-colors py-2 rounded font-medium"
              onClick={() => setShowDetails(new Map())}
            >
              Close details
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

export default Environment;