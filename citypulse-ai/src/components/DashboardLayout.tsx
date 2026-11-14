import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";

const LINKS = [
  { to: "/digital-twin", label: "Digital Twin" },
  { to: "/traffic", label: "Traffic" },
  { to: "/environment", label: "Environment" },
  { to: "/civic-issues", label: "Civic Issues" },
  { to: "/scenario-lab", label: "Scenario Lab" },
  { to: "/ai-analyst", label: "AI Analyst" },
  { to: "/methodology", label: "Methodology" },
];

const DashboardLayout = () => {
  const [menuOpen, setMenuOpen] = useState(false);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    [
      "px-3 py-2 rounded-lg text-sm transition-colors",
      isActive
        ? "bg-secondary text-primary font-medium"
        : "text-muted-foreground hover:text-foreground",
    ].join(" ");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#main-dashboard"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-background"
      >
        Skip to main content
      </a>

      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3 shrink-0" aria-label="CityPulse AI home">
            <span className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <svg
                className="w-5 h-5 text-background"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </span>
            <span className="text-lg font-semibold tracking-tight text-primary">CityPulse AI</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-1" aria-label="Main navigation">
            {LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} className={linkClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden xl:inline text-xs text-muted-foreground">
              Generated district · simulated
            </span>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="lg:hidden p-2 rounded-lg border border-border hover:bg-secondary transition-colors"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            >
              <svg
                className="w-5 h-5 text-foreground"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                {menuOpen ? (
                  <path d="M6 6l12 12M18 6L6 18" />
                ) : (
                  <path d="M4 7h16M4 12h16M4 17h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav
            id="mobile-nav"
            className="lg:hidden border-t border-border bg-background px-4 py-3"
            aria-label="Mobile navigation"
          >
            <ul className="grid gap-1">
              {LINKS.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      [
                        "block px-3 py-2 rounded-lg text-sm transition-colors",
                        isActive
                          ? "bg-secondary text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground",
                      ].join(" ")
                    }
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <main id="main-dashboard">
        <Outlet />
      </main>
    </div>
  );
};

export default DashboardLayout;
