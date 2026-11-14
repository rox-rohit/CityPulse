import { describe, expect, it } from "vitest";
import { generateCityPlan } from "./cityPlan";

const bounds = { west: 78.17, south: 26.21, east: 78.19, north: 26.23 };

describe("generateCityPlan", () => {
  const plan = generateCityPlan(bounds);
  const heights = (zone: string) =>
    plan.buildings.filter((b) => b.zone === zone).map((b) => b.height);

  it("lays out a dense city", () => {
    // eslint-disable-next-line no-console
    console.log(
      "plan:",
      plan.buildings.length,
      "buildings /",
      plan.roads.length,
      "roads /",
      plan.trees.length,
      "trees /",
      JSON.stringify(plan.counts),
    );
    expect(plan.buildings.length).toBeGreaterThan(500);
    expect(plan.roads.length).toBeGreaterThan(20);
  });

  it("populates every district", () => {
    expect(plan.counts.core).toBeGreaterThan(60);
    expect(plan.counts.midtown).toBeGreaterThan(120);
    expect(plan.counts.residential).toBeGreaterThan(150);
    expect(plan.counts.industrial).toBeGreaterThan(10);
    expect(plan.counts.campus).toBeGreaterThanOrEqual(6);
  });

  it("gives the core a skyline and the edge low-rise housing", () => {
    expect(Math.max(...heights("core"))).toBeGreaterThan(60);
    expect(Math.max(...heights("residential"))).toBeLessThan(12);
  });

  it("draws avenues and minor streets", () => {
    expect(plan.roads.some((road) => road.kind === "primary")).toBe(true);
    expect(plan.roads.some((road) => road.kind === "secondary")).toBe(true);
  });

  it("includes parks, a lake, a forest, an industrial estate and the campus", () => {
    const kinds = plan.areas.map((area) => area.kind);
    ["park", "lake", "forest", "industrial", "campus"].forEach((kind) => {
      expect(kinds).toContain(kind);
    });
  });

  it("names the MITS campus buildings", () => {
    const names = plan.buildings.map((building) => building.name).filter(Boolean);
    expect(names).toContain("MITS Main Building");
    expect(names.some((name) => name?.startsWith("MITS Hostel"))).toBe(true);
  });

  it("labels the districts and campus", () => {
    const labels = plan.labels.map((label) => label.text);
    expect(labels).toContain("MITS Campus");
    expect(labels).toContain("Central Park");
    expect(labels).toContain("Lake");
  });

  it("is deterministic and stays inside the study area", () => {
    const again = generateCityPlan(bounds);
    expect(again.buildings[0]).toEqual(plan.buildings[0]);

    plan.buildings.forEach((building) => {
      expect(building.lon).toBeGreaterThanOrEqual(bounds.west);
      expect(building.lon).toBeLessThanOrEqual(bounds.east);
      expect(building.lat).toBeGreaterThanOrEqual(bounds.south);
      expect(building.lat).toBeLessThanOrEqual(bounds.north);
    });
  });
});
