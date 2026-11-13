import React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";

const LandingPage: React.FC = () => {
  const [showFeatures, setShowFeatures] = useState(false);

  return (
    <section className="min-h-screen bg-gradient-to-b from-background via-background to-secondary flex flex-col">
      <header className="border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <svg
                className="w-5 h-5 text-background"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="text-xl font-bold text-primary">CityPulse AI</span>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <Link to="/digital-twin" className="hover:text-primary transition-colors font-medium">
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-12">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-tight mb-6">
                Understand Your City.<br />
                Anticipate Its Future.
              </h1>
              <p className="text-lg text-muted-foreground mb-8 max-w-xl">
                CityPulse AI is an intelligent urban analytics and digital twin platform
                helping people understand how their city functions through geographic data,
                machine learning, predictive analytics, and environmental intelligence.
              </p>
              <div className="space-y-4">
                <Link to="/digital-twin" className="inline-block bg-primary text-background px-8 py-3 rounded-full font-medium text-lg hover:opacity-90 transition-opacity">
                  Explore the Dashboard
                </Link>
                <Link to="/methodology" className="inline-block bg-transparent border-2 border-primary text-primary px-8 py-3 rounded-full font-medium text-lg hover:bg-primary/10 transition-all">
                  Learn Our Methodology
                </Link>
              </div>
            </div>
            <div className="relative lg:hidden">
              <div className="aspect-square rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 overflow-hidden">
                <svg
                  className="absolute inset-0 w-full h-full mx-auto my-auto"
                  viewBox="0 0 400 400"
                  fill="none"
                >
                  <circle
                    cx="200"
                    cy="200"
                    r="180"
                    stroke="primary"
                    strokeWidth={1}
                    fill="none"
                  />
                  <circle
                    cx="200"
                    cy="200"
                    r="120"
                    stroke="secondary"
                    strokeWidth={1}
                    fill="none"
                  />
                  <path
                    className="absolute top-50 left-50 transform -translate-x-50 -translate-y-5 w-10 h-10 bg-primary rounded-full"
                  />
                </svg>
              </div>
            </div>
            <div className="hidden lg:block grid grid-cols-2 gap-6 pt-8">
              <div className="p-6 rounded-2xl bg-card border border-border hover:transform hover:transition-all hover:hover:shadow-lg transition-all">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-primary" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                  </svg>
                </div>
                <h3 className="font-medium mb-2">Geospatial Intelligence</h3>
                <p className="text-sm text-muted-foreground">
                  Interactive maps and geographic analysis of urban areas.
                </p>
              </div>
              <div className="p-6 rounded-2xl bg-card border border-border hover:transform hover:transition-all hover:hover:shadow-lg transition-all">
                <div className="w-12 h-12 rounded-xl bg-teal/10 flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-teal" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 4l6 8h12l6-8zm0 4l6 8h4l6-8zm-6 8l6 8h-12l6-8zm6-4c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-2 4c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zM5 11c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3m1.5 6.5c-1.39 0-2.5-1.11-2.5-2.5s1.11-2.5 2.5-2.5 2.5 1.11 2.5 2.5-1.11 2.5-2.5 2.5z" />
                  </svg>
                </div>
                <h3 className="font-medium mb-2">Predictive Analytics</h3>
                <p className="text-sm text-muted-foreground">
                  Machine learning models for urban forecasting and analysis.
                </p>
              </div>
              <div className="p-6 rounded-2xl bg-card border border-border hover:transform hover:transition-all hover:hover:shadow-lg transition-all">
                <div className="w-12 h-12 rounded-xl bg-violet/10 flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-violet" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5M2 7l10 5 10-5" />
                  </svg>
                </div>
                <h3 className="font-medium mb-2">Environmental Intelligence</h3>
                <p className="text-sm text-muted-foreground">
                  Air quality, urban heat analysis, and green cover monitoring.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </section>
  );
};

export default LandingPage;