import { describe, expect, it } from "vitest";
import {
  generateCityFabric,
  sampleParkTrees,
  type FabricLayer,
} from "./cityFabric";

const bounds = { west: 78.17, south: 26.21, east: 78.19, north: 26.23 };

const layers: FabricLayer[] = [
  {
    table: "roads",
    data: {
      features: [
        {
          properties: { highway: "primary" },
          geometry: {
            type: "LineString",
            coordinates: [
              [78.17, 26.22],
              [78.19, 26.22],
            ],
          },
        },
        {
          properties: { highway: "residential" },
          geometry: {
            type: "LineString",
            coordinates: [
              [78.18, 26.21],
              [78.18, 26.23],
            ],
          },
        },
      ],
    },
  },
  {
    table: "buildings",
    data: {
      features: [
        {
          properties: { building: "yes" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [78.1805, 26.2205],
                [78.1808, 26.2205],
                [78.1808, 26.2208],
                [78.1805, 26.2205],
              ],
            ],
          },
        },
      ],
    },
  },
  {
    table: "green_spaces",
    data: {
      features: [
        {
          properties: { leisure: "park" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [78.174, 26.224],
                [78.176, 26.224],
                [78.176, 26.226],
                [78.174, 26.226],
                [78.174, 26.224],
              ],
            ],
          },
        },
      ],
    },
  },
];

describe("generateCityFabric", () => {
  it("produces blocks along the streets", () => {
    const { blocks } = generateCityFabric(layers, bounds);
    expect(blocks.length).toBeGreaterThan(20);
  });

  it("is deterministic for a given seed", () => {
    const a = generateCityFabric(layers, bounds, 7);
    const b = generateCityFabric(layers, bounds, 7);
    expect(a.blocks[0]).toEqual(b.blocks[0]);
    expect(a.blocks.length).toBe(b.blocks.length);
  });

  it("changes with the seed", () => {
    const a = generateCityFabric(layers, bounds, 7);
    const b = generateCityFabric(layers, bounds, 8);
    expect(a.blocks).not.toEqual(b.blocks);
  });

  it("keeps every block inside the study area", () => {
    const { blocks } = generateCityFabric(layers, bounds);
    blocks.forEach((block) => {
      expect(block.lon).toBeGreaterThanOrEqual(bounds.west);
      expect(block.lon).toBeLessThanOrEqual(bounds.east);
      expect(block.lat).toBeGreaterThanOrEqual(bounds.south);
      expect(block.lat).toBeLessThanOrEqual(bounds.north);
      expect(block.height).toBeGreaterThan(0);
      expect(block.width).toBeGreaterThan(0);
    });
  });

  it("counts every block by kind", () => {
    const { blocks, counts } = generateCityFabric(layers, bounds);
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(blocks.length);
  });

  it("returns nothing without a street network", () => {
    const { blocks } = generateCityFabric([], bounds);
    expect(blocks).toHaveLength(0);
  });

  it("does not build on top of surveyed footprints", () => {
    const { blocks } = generateCityFabric(layers, bounds);
    const collisions = blocks.filter(
      (block) => Math.abs(block.lon - 78.18065) < 0.0001 && Math.abs(block.lat - 26.2206) < 0.0001,
    );
    expect(collisions).toHaveLength(0);
  });
});

describe("sampleParkTrees", () => {
  it("places deterministic trees inside green space, within the limit", () => {
    const a = sampleParkTrees(layers, 40, 3);
    const b = sampleParkTrees(layers, 40, 3);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(40);
  });
});
