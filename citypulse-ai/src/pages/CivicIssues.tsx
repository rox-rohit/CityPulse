import React, { useEffect, useState } from "react";

const CivicIssues: React.FC = () => {
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState<Map<string, any>>(new Map());
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  useEffect(() => {
    // In a real implementation, this would fetch civic issue data from the backend
    // For now, we'll simulate with placeholder data grounded in the Maharaj Bada AOI
    const simulatedData = [
      {
        id: "civic-1",
        type: "pothole",
        location: "NH-76 near Maharaj Bada",
        severity: "high",
        reported: "2024-01-10",
        status: "pending",
        description: "Pothole formed due to water accumulation and freeze-thaw cycles",
        coordinates: [78.1824, 26.2210],
      },
      {
        id: "civic-2",
        type: "streetlight",
        location: "Lashkar Market",
        severity: "medium",
        reported: "2024-01-12",
        status: "in-progress",
        description: "Streetlight not functioning since storm damage",
        coordinates: [78.1880, 26.2150],
      },
      {
        id: "civic-3",
        type: "garbage",
        location: "City Center Park",
        severity: "low",
        reported: "2024-01-14",
        status: "resolved",
        description: "Garbage accumulation cleared by municipal workers",
        coordinates: [78.1780, 26.2300],
      },
      {
        id: "civic-4",
        type: "pothole",
        location: "Lashkar Gwalior Road",
        severity: "medium",
        reported: "2024-01-11",
        status: "pending",
        description: "Pothole affecting traffic flow; requires repair",
        coordinates: [78.1850, 26.2180],
      },
      {
        id: "civic-5",
        type: "water-supply",
        location: "Maharaj Bada",
        severity: "low",
        reported: "2024-01-13",
        status: "resolved",
        description: "Water supply interruption restored after pipeline repair",
        coordinates: [78.1750, 26.2200],
      },
    ];

    setIssues(simulatedData);
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen py-8 flex items-center justify-center">
        <div className="text-muted-foreground">
          <div className="animate-spin rounded-full border-4 border-border border-t-transparent w-12 h-12 mb-4" />
          <span>Loading civic issues...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen py-8">
        <div className="max-w-6xl mx-auto px-4 mb-4">
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            <strong className="font-semibold">Illustrative sample reports.</strong> CityPulse has no
            civic-issue reporting store or municipal feed connected yet, so these entries are
            examples for layout review and do not describe real reported issues.
          </div>
        </div>
        <p className="text-red-500">Error loading civic issues: {error}</p>
      </div>
    );
  }

  // Filter issues by status
  const filteredIssues = filterIssues(issues, filterStatus);

  return (
    <section className="py-8">
      <div className="max-w-7xl mx-auto px-4">
        <h2 className="text-2xl font-bold mb-6 text-primary">Civic Issue Intelligence</h2>

        {/* Filters */}
        <div className="mb-6 rounded-xl bg-card border border-border p-4">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={`px-3 py-1.5 rounded text-sm font-medium ${
                filterStatus === "all" || !filterStatus
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-primary/10 transition-colors"
              }`}
              onClick={() => setFilterStatus(null)}
            >
              All ({filteredIssues.length})
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 rounded text-sm font-medium ${
                filterStatus === "pending"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-primary/10 transition-colors"
              }`}
              onClick={() => setFilterStatus("pending")}
            >
              Pending ({countByStatus(filteredIssues, "pending")})
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 rounded text-sm font-medium ${
                filterStatus === "in-progress"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-primary/10 transition-colors"
              }`}
              onClick={() => setFilterStatus("in-progress")}
            >
              In Progress ({countByStatus(filteredIssues, "in-progress")})
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 rounded text-sm font-medium ${
                filterStatus === "resolved"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-primary/10 transition-colors"
              }`}
              onClick={() => setFilterStatus("resolved")}
            >
              Resolved ({countByStatus(filteredIssues, "resolved")})
            </button>
          </div>
        </div>

        {/* Issues grid */}
        <div className="grid md:grid-cols-2 gap-4">
          {filteredIssues.map((issue) => {
            const severityClass =
              issue.severity === "high"
                ? "bg-red-100/30 border-red-500/30"
                : issue.severity === "medium"
                ? "bg-yellow-100/30 border-yellow-500/30"
                : "bg-green-100/30 border-green-500/30";

            return (
              <div
                key={issue.id}
                className={`p-4 rounded-xl bg-card border border-border ${severityClass} hover:transform hover:transition-all hover:border-primary/30 transition-all cursor-pointer`}
                onClick={() =>
                  setShowDetails(prev => new Map(prev).set(issue.id, issue))
                }
              >
                <div className="flex items-start gap-3">
                  {/* Severity badge */}
                  <div
                    className={`w-3 h-3 rounded-full ${
                      issue.severity === "high"
                        ? "bg-red-500"
                        : issue.severity === "medium"
                        ? "bg-yellow-500"
                        : "bg-green-500"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate mb-1">{issue.type}</h3>
                    <p className="text-xs text-muted-foreground truncate">
                      {issue.location}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail panel - expanded on click */}
        {showDetails.size > 0 && (
          <div className="mt-8 p-6 rounded-2xl bg-card border border-border">
            <h3 className="font-medium mb-4 text-primary">Issue Details</h3>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              {Array.from(showDetails.entries()).map(([id, issue]) => (
                <div key={id}>
                  <p className="font-medium text-secondary-500">{issue.type}</p>
                  <p className="text-muted-foreground">
                    <span className="font-medium">Severity:</span> {issue.severity}
                  </p>
                  <br />
                  <span className="font-medium">Reported:</span> {issue.reported}
                  <br />
                  <span className="font-medium">Status:</span> {issue.status}
                  <br />
                  <span className="font-medium">Location:</span> {issue.location}
                  <br />
                  <span className="font-medium">Description:</span> {issue.description}
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

/**
 * Filter issues by status
 */
function filterIssues(issues: any[], status: string | null): any[] {
  if (!status || status === "all") return issues;
  return issues.filter((issue) => issue.status === status);
}

/**
 * Count issues by status
 */
function countByStatus(issues: any[], status: string): number {
  return issues.filter((issue) => issue.status === status).length;
}

export default CivicIssues;