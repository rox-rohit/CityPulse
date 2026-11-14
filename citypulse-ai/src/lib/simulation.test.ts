import { describe, expect, it } from "vitest";
import {
  GARBAGE_KG_PER_SITE_DAY,
  PM25_PER_1000_VEHICLES,
  TREE_CANOPY_M2,
  damageProbability,
  markerCount,
  peakGroundAcceleration,
  pm25Category,
  seededSequence,
  simulateInterventions,
  type Interventions,
  type SimBaseline,
} from "./simulation";

const baseline: SimBaseline = {
  aoiAreaHa: 443.37,
  greenHa: 9.38,
  greenSharePercent: 2.11,
  roadKm: 124.06,
  roadByClass: [
    { highway_class: "residential", segments: 565, length_km: 67.0 },
    { highway_class: "secondary", segments: 53, length_km: 12.57 },
  ],
  pm25Mean24h: 67.0,
};

const none: Interventions = {
  trees: 0,
  garbageSites: 0,
  carsAdded: 0,
  potholes: 0,
  blockedDrains: 0,
  closedClass: "secondary",
  closurePercent: 0,
  pm25Coefficient: 0.4,
  buildingFloors: 0,
  buildingFootprintM2: 0,
};

describe("simulateInterventions", () => {
  it("returns the baseline unchanged when nothing is applied", () => {
    const result = simulateInterventions(baseline, none);
    expect(result.canopyHa).toBe(0);
    expect(result.newSharePercent).toBeCloseTo(baseline.greenSharePercent, 6);
    expect(result.deltaShare).toBeCloseTo(0, 6);
    expect(result.pm25Projected).toBeCloseTo(67.0, 6);
    expect(result.pm25Total).toBeCloseTo(67.0, 6);
    expect(result.closedKm).toBe(0);
    expect(result.garbageLoadKgPerDay).toBe(0);
    expect(result.cityCondition).toBe(100);
    expect(result.seismic).toBeNull();
  });

  it("converts trees to canopy area at 25 m² each", () => {
    const result = simulateInterventions(baseline, { ...none, trees: 1500 });
    expect(result.canopyHa).toBeCloseTo((1500 * TREE_CANOPY_M2) / 10_000, 6);
    expect(result.addedGreenHa).toBeCloseTo(3.75, 6);
  });

  it("raises the green share and lowers the modelled PM2.5 estimate", () => {
    const result = simulateInterventions(baseline, { ...none, trees: 1500 });
    expect(result.newSharePercent).toBeGreaterThan(baseline.greenSharePercent);
    expect(result.pm25ChangePercent).toBeLessThan(0);
    expect(result.pm25Projected).toBeLessThan(67.0);
  });

  it("scales the assumed response with the coefficient", () => {
    const low = simulateInterventions(baseline, { ...none, trees: 1000, pm25Coefficient: 0.1 });
    const high = simulateInterventions(baseline, { ...none, trees: 1000, pm25Coefficient: 2 });
    expect(Math.abs(high.pm25ChangePercent ?? 0)).toBeGreaterThan(
      Math.abs(low.pm25ChangePercent ?? 0),
    );
  });

  it("reports PM2.5 as unavailable when no baseline exists", () => {
    const result = simulateInterventions({ ...baseline, pm25Mean24h: null }, {
      ...none,
      trees: 500,
    });
    expect(result.pm25Projected).toBeNull();
    expect(result.pm25ChangePercent).toBeNull();
    expect(result.pm25Total).toBeNull();
    expect(result.aqiCategory).toBeNull();
  });

  it("computes road closure as a share of the selected class only", () => {
    const result = simulateInterventions(baseline, {
      ...none,
      closedClass: "secondary",
      closurePercent: 20,
    });
    expect(result.closedKm).toBeCloseTo(12.57 * 0.2, 6);
    expect(result.closedShare).toBeCloseTo((2.514 / 124.06) * 100, 4);
  });

  it("agrees with the Scenario Lab green-share formula", () => {
    // Scenario Lab: new share = (baseline green + added) ÷ AOI × 100, using
    // measured hectares. Here the delta is derived from added canopy and added
    // to the reported baseline share, so the two agree within baseline rounding.
    const result = simulateInterventions(baseline, { ...none, trees: 1500 });
    const scenarioLabShare = ((9.38 + 3.75) / 443.37) * 100;
    // Tolerance covers the baseline share being reported rounded (2.11 vs 2.1156).
    expect(result.newSharePercent).toBeCloseTo(scenarioLabShare, 1);
  });

  it("treats garbage as an assumed collection load and nothing more", () => {
    const result = simulateInterventions(baseline, { ...none, garbageSites: 12 });
    expect(result.garbageLoadKgPerDay).toBe(12 * GARBAGE_KG_PER_SITE_DAY);
    expect(result.notModelled).toContain("Air-quality effect of uncollected waste");
  });

  it("adds the assumed vehicle increment on top of the green response", () => {
    const result = simulateInterventions(baseline, { ...none, carsAdded: 5000 });
    expect(result.trafficPm25).toBeCloseTo((5000 / 1000) * PM25_PER_1000_VEHICLES, 6);
    expect(result.pm25Total).toBeCloseTo(67.0 + result.trafficPm25, 6);
    expect(result.cityCondition).toBeLessThan(100);
  });

  it("classifies PM2.5 with the CPCB bands", () => {
    expect(pm25Category(25)).toBe("Good");
    expect(pm25Category(45)).toBe("Satisfactory");
    expect(pm25Category(67)).toBe("Moderate");
    expect(pm25Category(100)).toBe("Poor");
    expect(pm25Category(200)).toBe("Very poor");
    expect(pm25Category(300)).toBe("Severe");
  });

  it("converts potholes and blocked drains into assumed areas", () => {
    const result = simulateInterventions(baseline, {
      ...none,
      potholes: 40,
      blockedDrains: 2,
    });
    expect(result.repairedAreaM2).toBeCloseTo(60, 6);
    expect(result.floodedHa).toBeCloseTo(0.7, 6);
  });

  it("trades condition index down for waste and up for trees, within bounds", () => {
    const dirty = simulateInterventions(baseline, { ...none, garbageSites: 40 });
    const green = simulateInterventions(baseline, { ...none, trees: 5000 });
    expect(dirty.cityCondition).toBeLessThan(green.cityCondition);
    expect(dirty.cityCondition).toBeGreaterThanOrEqual(0);
    expect(green.cityCondition).toBeLessThanOrEqual(100);
  });

  it("ignores negative and non-finite inputs", () => {
    const result = simulateInterventions(baseline, {
      ...none,
      trees: -500,
      garbageSites: Number.NaN,
      closurePercent: -10,
      carsAdded: -100,
    });
    expect(result.canopyHa).toBe(0);
    expect(result.garbageLoadKgPerDay).toBe(0);
    expect(result.closedKm).toBe(0);
    expect(result.trafficPm25).toBe(0);
  });

  it("caps closure percentage at 100", () => {
    const result = simulateInterventions(baseline, {
      ...none,
      closedClass: "secondary",
      closurePercent: 400,
    });
    expect(result.closedKm).toBeCloseTo(12.57, 6);
  });
});

describe("seismic screening", () => {
  it("attenuates PGA with distance and grows it with magnitude", () => {
    expect(peakGroundAcceleration(6.5, 40)).toBeLessThan(peakGroundAcceleration(6.5, 10));
    expect(peakGroundAcceleration(7.0, 20)).toBeGreaterThan(peakGroundAcceleration(6.0, 20));
  });

  it("raises damage probability with shaking and with storeys", () => {
    expect(damageProbability(0.2, 4)).toBeGreaterThan(damageProbability(0.05, 4));
    expect(damageProbability(0.2, 10)).toBeGreaterThan(damageProbability(0.2, 1));
    expect(damageProbability(0, 4)).toBe(0);
  });

  it("screens the proposed building against its real neighbours", () => {
    const result = simulateInterventions(
      baseline,
      { ...none, buildingFloors: 6, buildingFootprintM2: 600 },
      { nearbyBuildings: 12, nearbyAverageFloors: 2 },
    );
    expect(result.seismic).not.toBeNull();
    expect(result.seismic?.nearbyBuildings).toBe(12);
    expect(result.seismic?.expectedDamaged).toBeCloseTo(
      (result.seismic?.damageProbability ?? 0) * 12,
      6,
    );
  });

  it("skips the seismic screen when no building is proposed", () => {
    const result = simulateInterventions(baseline, {
      ...none,
      buildingFloors: 0,
      buildingFootprintM2: 600,
    });
    expect(result.seismic).toBeNull();
  });
});

describe("marker helpers", () => {
  it("caps markers at the pool size", () => {
    expect(markerCount(5000, 150)).toBe(150);
    expect(markerCount(120, 150)).toBe(120);
    expect(markerCount(-5, 150)).toBe(0);
  });

  it("produces a deterministic sequence", () => {
    const a = seededSequence(42);
    const b = seededSequence(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
