import type { ProviderResult } from "@surveynt/property-data";
/** Synthetic results enter the canonical immutable snapshot path, never a live provider or global reference cache. */
export function demoProviderResults():ProviderResult[]{
  const now=new Date(),base={coverage:"unknown" as const,informationClass:"indicative_external" as const,licence:{name:"Surveynt demonstration fixture",url:null,attribution:"Fictional stakeholder scenario — not an external record",restrictions:["Not valid for property advice or risk assessment"]},retrievedAt:now.toISOString(),datasetVersion:"demo-v1",expiresAt:new Date(now.getTime()+86400000).toISOString(),errorCode:null};
  return [
    {...base,source:"planning_data",category:"conservation_area",status:"matched",message:"DEMO: fictional conservation-area intersection. A real search requires verified location and source coverage.",records:[{sourceRecordId:"demo-conservation",category:"conservation_area",data:{name:"Demonstration conservation area",label:"Fictional planning context",simulated:true},evidence:[],matchMethod:"point_in_polygon",confidence:"low",sourceUpdatedAt:null}]},
    {...base,source:"hmlr_inspire",category:"inspire_indicative_extent",status:"not_configured",message:"DEMO: no boundary supplied. National conversion and capacity approval remain outstanding. INSPIRE extents are not definitive boundaries.",records:[]},
    {...base,source:"epc_england_wales",category:"energy_certificate",status:"not_configured",message:"DEMO: EPC credentials, licence and data-protection approval are not configured.",records:[]},
    {...base,source:"ea_flood_zones",category:"planning_flood_zone_2",status:"unavailable",message:"DEMO: simulated provider outage. This is not a flood-risk assessment.",errorCode:"demo_provider_outage",records:[]},
  ];
}
