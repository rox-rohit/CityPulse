import React from "react";
import { Link } from "react-router-dom";

const Navigation: React.FC = () => {
  return (
    <nav className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-50">
      {/* Skip link for screen readers */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

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
        </div>
        <button
          className="md:hidden p-2 rounded-lg hover:bg-primary/10 transition-colors"
          aria-label="Open main navigation menu"
        >
          <svg
            className="w-6 h-6 text-primary"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M3 12l2-2m6 8l2-2m6 8l2-2m-6-4l2-2m6 8l2-2m6 8l2-2m-6-4l2-2" />
          </svg>
        </button>
      </div>
    </nav>

    <main id="main-content" className="pt-16">
  );
};

export default Navigation;