import React from "react";

const Methodology: React.FC = () => {
  return (
    <section className="py-8">
      <div className="max-w-7xl mx-auto px-4">
        <h2 className="text-2xl font-bold mb-6 text-primary">Methodology</h2>
        
        <div className="grid md:grid-cols-2 gap-8">
          <div>
            <h3 className="text-xl font-medium mb-4 text-primary">Project Objectives</h3>
            <ul className="space-y-3 text-muted-foreground">
              <li>
                Develop an intelligent urban analytics platform for Gwalior, Madhya
                Pradesh, India
              </li>
              <li>
                Provide geospatial visualization and digital twin capabilities using
                real geographic data
              </li>
              <li>
                Enable predictive analytics for urban planning and environmental
                monitoring
              </li>
              <li>
                Support scenario analysis for urban intervention evaluation
              </li>
              <li>
                Offer natural-language AI analysis of available city data
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-xl font-medium mb-4 text-primary">Data Sources</h3>
            <ul className="space-y-3 text-muted-foreground">
              <li>
                OpenStreetMap (road network, building footprints, points of interest)
              </li>
              <li>
                Government open data sources (where available and legally usable)
              </li>
              <li>
                Environmental monitoring stations (air quality, temperature)
              </li>
              <li>
                Civic issue reporting systems (potholes, streetlights, garbage)
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-xl font-medium mb-4 text-primary">Data Collection & Processing</h3>
            <ul className="space-y-3 text-muted-foreground">
              <li>
                Geographic data ingested via OSMnx from OpenStreetMap, stored in
                PostGIS with proper coordinate reference system (EPSG:4326)
              </li>
              <li>
                Data cleaning pipeline handles missing values, invalid geometries,
                and duplicate records
              </li>
              <li>
                Spatial indexing for efficient query performance
              </li>
              <li>
                Time-stamped records with provenance tracking for data freshness
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-xl font-medium mb-4 text-primary">Analytical Methods</h3>
            <ul className="space-y-3 text-muted-foreground">
              <li>
                Spatial statistics for hotspot identification and geographic clustering
              </li>
              <li>
                Time-series analysis for environmental trend detection
              </li>
              <li>
                Machine learning models for prediction (with proper validation and
                time-aware splits)
              </li>
              <li>
                SHAP values for model interpretability and feature importance
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-border">
          <h3 className="text-xl font-medium mb-4 text-primary">Known Limitations</h3>
          <ul className="space-y-3 text-muted-foreground">
            <li>
              Initial focus on Maharaj Bada study area (~1.5-2 km radius); city-wide
              data not yet available
            </li>
            <li>
              Traffic analysis based on OpenStreetMap geometry without live data
              integration
            </li>
            <li>
              Building heights in digital twin are estimated for visualization;
              actual height data not yet integrated
            </li>
            <li>
              Machine learning models in early development; no trained models
            </li>
            <li>
              Environmental measurements are snapshot data; continuous monitoring
              not yet deployed
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
};

export default Methodology;