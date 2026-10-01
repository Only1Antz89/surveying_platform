export * from "./types";
export * from "./orchestrator";
export * from "./planning-data";
export * from "./epc";
export * from "./reference-layer";

import { epcProvider } from "./epc";
import { planningDataProvider } from "./planning-data";
import { floodZonesProvider, geologyProvider, historicEnglandProvider, inspireProvider, naturalEnglandProvider, surfaceWaterProvider } from "./reference-layer";
import type { IntelligenceProvider } from "./types";

/** Providers available to enrichment runs. Each still requires operator enablement in reference.data_sources. */
export const intelligenceProviders: IntelligenceProvider[] = [planningDataProvider, epcProvider, historicEnglandProvider, inspireProvider, floodZonesProvider, surfaceWaterProvider, geologyProvider, naturalEnglandProvider];

import type { ReferenceLayerProvider } from "./reference-layer";

/** Reference-layer providers whose imported features can be drawn on the property map. */
export const mapLayerProviders: ReferenceLayerProvider[] = [historicEnglandProvider, inspireProvider, floodZonesProvider, surfaceWaterProvider, geologyProvider, naturalEnglandProvider];
