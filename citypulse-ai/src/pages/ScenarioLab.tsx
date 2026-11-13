import React, { useEffect, useState } from "react";

const ScenarioLab: React.FC = () => {
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);

  useEffect(() => {
    // In a real implementation, this would execute scenario simulations
    // based on actual geographic data from the digital twin
    // For now, we'll simulate with placeholder data grounded in the AOI
    const simulatedData = [
      {
        id: "scenario-1",
        name: "Increase Green Cover",
        description:
          "Simulate adding 20% more green cover to Maharaj Bada area",
        type: "green-cover",
        status: "simulated",
        assumptions: [
          "Green cover increase based on available vacant land in Maharaj Bada study area",
          "20% increase applied to designated zones within the 1.5-2 km radius AOI",
          "Immediate visual effect in digital twin - building footprints replaced with vegetation",
        ],
        estimatedImpact: {
          airQualityImprovement: "5-10%",
          heatReduction: "2-3°C",
          civicIssueReduction: "10-15%",
        },
        geographicScope: "Maharaj Bada study area (AOI boundary)",
        methodology: "Land use conversion model: impervious surfaces converted to permeable green space",
        limitations: [
          "Building heights not modified - only footprint classification changed",
          "20% figure assumes optimal distribution of available vacant land",
          "No drainage or hydrological model applied",
        ],
      },
      {
        id: "scenario-2",
        name: "Road Closure",
        description:
          "Simulate closure of NH-76 through Lashkar area",
        type: "road-closure",
        status: "simulated",
        assumptions: [
          "Closure during peak hours (8-11 AM, 5-8 PM) on NH-76 segment within AOI",
          "Traffic redistributed to alternative routes around Maharaj Bada",
          "Short-term congestion expected on feeder roads bordering the study area",
        ],
        estimatedImpact: {
          congestionIncrease: "20-30%",
          alternativeRouteLoad: "40-50%",
          estimatedDelay: "5-10 minutes",
        },
        geographicScope: "NH-76 corridor through Lashkar area (within AOI)",
        methodology: "Traffic redistribution model: routes recalculated around closed segment",
        limitations: [
          "OpenStreetMap roads are not live traffic data - this is simulated",
          "No consideration of emergency vehicle routing",
          "Public transport alternatives not modeled",
        ],
      },
      {
        id: "scenario-3",
        name: "Tree Planting Initiative",
        description:
          "Simulate planting 100 new trees across Maharaj Bada study area",
        type: "tree-planting",
        status: "simulated",
        assumptions: [
          "100 trees distributed across available green spaces and verges",
          "Within the Maharaj Bada AOI boundary (1.5-2 km radius)",
          "2-3 year growth period for measurable environmental impact",
        ],
        estimatedImpact: {
          airQualityImprovement: "2-5%",
          heatReduction: "1-2°C",
          civicIssueReduction: "5-8%",
        },
        geographicScope: "Maharaj Bada study area",
        methodology: "Urban forestry model: tree canopy coverage increase",
        limitations: [
          "Survival rate not guaranteed - depends on maintenance and soil conditions",
          "Benefits scale over time as trees mature",
          "Does not account for species selection or planting quality",
        ],
      },
    ];

    setScenarios(simulatedData);
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen py-8 flex items-center justify-center">
        <div className="text-muted-foreground">
          <div className="animate-spin rounded-full border-4 border-border border-t-transparent w-12 h-12 mb-4" />
          <span>Loading scenarios...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen py-8">
        <div className="max-w-6xl mx-auto px-4 mb-4">
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            <strong className="font-semibold">Model-estimated scenarios.</strong> These simulations
            are illustrative calculations with stated assumptions; they are not measured outcomes and
            have not been validated against observed data.
          </div>
        </div>
        <p className="text-red-500">Error loading scenarios: {error}</p>
      </div>
    );
  }

  return (
    <section className="py-8">
      <div className="max-w-7xl mx-auto px-4">
        <h2 className="text-2xl font-bold mb-6 text-primary">Scenario Lab</h2>

        <div className="space-y-6">
          {scenarios.map((scenario) => (
            <div
              key={scenario.id}
              className={
                selectedScenario === scenario.id
                  ? `p-6 rounded-2xl bg-card border border-primary/30 hover:border-primary/50 transition-all focus:outline-none focus:border-primary/50`
                  : `p-6 rounded-2xl bg-card border border-border hover:transform hover:transition-all hover:border-primary/30 transition-all cursor-pointer focus:outline-none focus:bg-primary/5 focus:border-primary/50`
              }
            >
              <h3 className="font-medium mb-2 text-primary">
                {scenario.name}
              </h3>
              {selectedScenario !== scenario.id && (
                <p className="text-sm text-muted-foreground mb-4">
                  {scenario.description}
                </p>
              )}

              <div className="grid md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="font-medium text-muted-foreground">Assumptions:</p>
                  <ul className="list-disc list-inside space-y-1">
                    {scenario.assumptions.map((a: string, i: number) => (
                      <li key={i} className="text-muted-foreground">
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium">Status: <span className="text-primary font-medium">{scenario.status}</span></p>
                </div>
                <div>
                  <p className="font-medium">Geographic Scope:</p>
                  <p className="text-xs text-muted-foreground">{scenario.geographicScope}</p>
                </div>
              </div>

              <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                <p className="font-medium text-primary">Estimated Impact:</p>
                <ul className="list-disc list-inside space-y-1">
                  {Object.entries(scenario.estimatedImpact).map(
                    ([key, value]) => (
                      <li key={key} className="text-muted-foreground">
                        <span className="font-medium">
                          {key.replace(/([A-Z])/g, " $1").trim()}:
                        </span>{value}
                      </li>
                    )
                  )}
                </ul>
              </div>

              {selectedScenario !== scenario.id && (
                <p className="mt-3 text-xs text-primary cursor-pointer" onClick={() => setSelectedScenario(scenario.id)}>
                  View detailed assumptions and methodology
                </p>
              )}

              {selectedScenario === scenario.id && (
                <div className="mt-4 p-4 rounded-lg bg-muted-foreground/5">
                  <p className="font-medium text-secondary-500 mb-3">Methodology:</p>
                  <p className="text-secondary-400 text-xs leading-relaxed">
                    {scenario.methodology}
                  </p>
                  <p className="text-secondary-400 text-xs mt-2 mb-3">
                    Limitations: {scenario.limitations
                      .map((l: string) => `- ${l}`)
                      .join(". ")}.
                  </p>
                  <button
                    className="mt-3 w-full text-primary hover:text-white transition-colors py-2 rounded font-medium"
                    onClick={() => setSelectedScenario(null)}
                  >
                    Close scenario
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ScenarioLab;