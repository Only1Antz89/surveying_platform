export * from "./types";
export * from "./orchestrator";
export * from "./planning-data";
export * from "./epc";
export * from "./reference-layer";
export * from "./price-paid";
export * from "./scottish-epc";
export * from "./postcode-geography";

import { epcProvider } from "./epc";
import { postcodeGeographyProvider } from "./postcode-geography";
import { planningDataProvider } from "./planning-data";
import { pricePaidProvider } from "./price-paid";
import { scottishEpcProvider } from "./scottish-epc";
import { cadwProvider, floodZonesProvider, geologyProvider, hesProvider, historicEnglandProvider, inspireProvider, naturalEnglandProvider, niHedProvider, nrwFloodZonesProvider, sepaFloodProvider, surfaceWaterProvider } from "./reference-layer";
import type { IntelligenceProvider } from "./types";

/** Providers available to enrichment runs. Each still requires operator enablement in reference.data_sources. */
export const intelligenceProviders: IntelligenceProvider[] = [postcodeGeographyProvider, planningDataProvider, epcProvider, historicEnglandProvider, inspireProvider, floodZonesProvider, surfaceWaterProvider, geologyProvider, naturalEnglandProvider, pricePaidProvider,
  nrwFloodZonesProvider, cadwProvider, hesProvider, sepaFloodProvider, niHedProvider, scottishEpcProvider];

import type { ReferenceLayerProvider } from "./reference-layer";

/** Reference-layer providers whose imported features can be drawn on the property map. */
export const mapLayerProviders: ReferenceLayerProvider[] = [historicEnglandProvider, inspireProvider, floodZonesProvider, surfaceWaterProvider, geologyProvider, naturalEnglandProvider, nrwFloodZonesProvider, cadwProvider, hesProvider, sepaFloodProvider, niHedProvider];
