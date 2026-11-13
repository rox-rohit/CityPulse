import React from "react";
import { Outlet, Link } from "react-router-dom";

const DashboardLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Skip navigation area for focus movement */}
      <div className="skip-nav" aria-hidden="true">
        <a href="#main-dashboard"></a>
      </div>

      <nav className="hidden md:block border-b border-border bg-background/80 backdrop-blur-sm">
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
          <div className="hidden md:flex items-center gap-8">
            <Link to="/digital-twin" className="hover:text-primary transition-colors" aria-label="Navigate to Digital Twin page">
              Digital Twin
            </Link>
            <Link to="/traffic" className="hover:text-primary transition-colors" aria-label="Navigate to Traffic page">
              Traffic
            </Link>
            <Link to="/environment" className="hover:text-primary transition-colors" aria-label="Navigate to Environment page">
              Environment
            </Link>
            <Link to="/civic-issues" className="hover:text-primary transition-colors" aria-label="Navigate to Civic Issues page">
              Civic Issues
            </Link>
            <Link to="/scenario-lab" className="hover:text-primary transition-colors" aria-label="Navigate to Scenario Lab page">
              Scenario Lab
            </Link>
            <Link to="/ai-analyst" className="hover:text-primary transition-colors" aria-label="Navigate to AI Analyst page">
              AI Analyst
            </Link>
            <Link to="/methodology" className="hover:text-primary transition-colors" aria-label="Navigate to Methodology page">
              Methodology
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Gwalior, MP, India
            </span>
          </div>
        </div>
      </nav>

      <main id="main-dashboard" className="flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
};

export default DashboardLayout;