export type Coordinate = { latitude: number; longitude: number };
export type FieldworkStop = {
  id: string; jobId: string; propertyId: string; clientName: string; serviceName: string;
  propertyType: string | null; reference: string; address: string; startsAt: string; endsAt: string;
  siteStatus?:string|null;siteConfirmedAt?:string|null;surveyorId: string | null; surveyorName: string; coordinates: Coordinate | null; precision: string;
  directDistanceMetres: number | null; openInMapsUrl: string;
};
export type FieldworkRoute = {
  date: string; timezone?:string; today?:string; showTomorrow?:boolean; origin: Coordinate | null; selectedSurveyorId: string | null;
  surveyors: { id: string; name: string }[]; stops: FieldworkStop[];
  provider: { status: string; attribution?: string | null; distanceMetres?: number; durationSeconds?: number;
    geometry?: { type: "LineString"; coordinates: [number, number][] }; legs?: { distanceMetres: number; durationSeconds: number }[] };
};
export function validDay(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export function validCoordinate(point: Coordinate | null | undefined): point is Coordinate {
  return Boolean(point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180);
}
/** Missing locations cannot be silently skipped: that would attribute another leg's ETA to this visit. */
export function normaliseRoadRoute(body: unknown, expectedLegs: number): Pick<FieldworkRoute["provider"], "geometry" | "legs" | "distanceMetres" | "durationSeconds"> | null {
  const route = (body as { routes?: { distance?: number; duration?: number; geometry?: { type?: string; coordinates?: unknown[] }; legs?: { distance?: number; duration?: number }[] }[] })?.routes?.[0];
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (!route || !finite(route.distance) || !finite(route.duration) || route.legs?.length !== expectedLegs || route.legs.some(l => !finite(l.distance) || !finite(l.duration)) || route.geometry?.type !== "LineString" || !Array.isArray(route.geometry.coordinates) || route.geometry.coordinates.length < 2 || route.geometry.coordinates.length > 100_000) return null;
  if (!route.geometry.coordinates.every(p => Array.isArray(p) && p.length >= 2 && validCoordinate({ longitude: p[0], latitude: p[1] }))) return null;
  return { distanceMetres: Math.round(route.distance), durationSeconds: Math.round(route.duration), geometry: { type: "LineString", coordinates: route.geometry.coordinates as [number, number][] }, legs: route.legs.map(l => ({ distanceMetres: Math.round(l.distance!), durationSeconds: Math.round(l.duration!) })) };
}
export function legForVisit(route: FieldworkRoute, index: number) { return route.provider.legs?.[route.origin ? index : index - 1]; }
export function plannedArrival(route:FieldworkRoute,index:number){const leg=legForVisit(route,index),previous=route.stops[index-1];if(!leg||!previous)return null;const departure=Date.parse(previous.endsAt);return Number.isFinite(departure)?new Date(departure+leg.durationSeconds*1000).toISOString():null;}
export function journeySections(route:FieldworkRoute) {
 const points=route.provider.geometry?.coordinates;if(!points?.length)return [];
 let start=0;const result:{stopId:string;points:[number,number][]}[]=[];
 for(const stop of route.stops.slice(route.origin?0:1)){
  if(!stop.coordinates)return [];
  let end=start,best=Infinity;for(let i=start;i<points.length;i++){const d=Math.hypot((points[i][0]-stop.coordinates.longitude)*Math.cos(stop.coordinates.latitude*Math.PI/180),points[i][1]-stop.coordinates.latitude);if(d<best){best=d;end=i;}}
  // Permit repeated/co-located visits without inventing a connecting road segment.
  result.push({stopId:stop.id,points:points.slice(start,end+1)});start=end;
 }
 return result;
}
export function interpolateRoad(points: [number, number][], fraction: number): [number, number] | null {
  if (!points.length) return null;
  const lengths = points.slice(1).map((p, i) => Math.hypot((p[0] - points[i][0]) * Math.cos(p[1] * Math.PI / 180), p[1] - points[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0); let target = total * Math.max(0, Math.min(1, fraction));
  for (let i = 0; i < lengths.length; i++) { if (target <= lengths[i]) { const f = lengths[i] ? target / lengths[i] : 0; return [points[i][0] + (points[i+1][0] - points[i][0]) * f, points[i][1] + (points[i+1][1] - points[i][1]) * f]; } target -= lengths[i]; }
  return points.at(-1)!;
}

export type ContextFeature = {type:"Feature";properties:Record<string,unknown>;geometry:{type:"Point"|"Polygon";coordinates:unknown}};
/** Public landscape manifests contain reference features only, never customer records. Bound to this day's locations. */
export function boundedFieldContext(input:unknown,points:Coordinate[]):{attribution:string;caveat:string;featureCollection:{type:"FeatureCollection";features:ContextFeature[]}}|null {
 const data=input as {attribution?:unknown;caveat?:unknown;crs?:unknown;featureCollection?:{type?:string;features?:unknown[]}};
 if(!data||typeof data.attribution!=="string"||!data.attribution.trim()||data.attribution.length>500||data.crs&&data.crs!=="EPSG:4326"||data.featureCollection?.type!=="FeatureCollection"||!Array.isArray(data.featureCollection.features)||data.featureCollection.features.length>5000||!points.length)return null;
 const minLon=Math.min(...points.map(p=>p.longitude))-.01,maxLon=Math.max(...points.map(p=>p.longitude))+.01,minLat=Math.min(...points.map(p=>p.latitude))-.01,maxLat=Math.max(...points.map(p=>p.latitude))+.01;
 const coordinate=(p:unknown):p is [number,number]=>Array.isArray(p)&&p.length>=2&&validCoordinate({longitude:p[0],latitude:p[1]})&&p[0]>=minLon&&p[0]<=maxLon&&p[1]>=minLat&&p[1]<=maxLat;
 const features=data.featureCollection.features.filter((value):value is ContextFeature=>{
  const f=value as ContextFeature;if(!f||f.type!=="Feature"||!f.properties||!f.geometry)return false;
  if(f.geometry.type==="Point")return ["tree","landmark"].includes(String(f.properties.kind))&&coordinate(f.geometry.coordinates);
  if(f.geometry.type!=="Polygon"||!["park","garden","green_space","building"].includes(String(f.properties.kind))||!Array.isArray(f.geometry.coordinates))return false;
  const rings=f.geometry.coordinates as unknown[][];
  if(!rings.length||!rings.every(r=>Array.isArray(r)&&r.length>=4&&r.length<=10000&&r.every(coordinate)&&JSON.stringify(r[0])===JSON.stringify(r.at(-1))))return false;
  return f.properties.kind!=="building"||(typeof f.properties.height_m==="number"&&Number.isFinite(f.properties.height_m)&&f.properties.height_m>0&&f.properties.height_m<500&&typeof f.properties.source_date==="string"&&typeof f.properties.method==="string");
 });
 return{attribution:data.attribution,caveat:typeof data.caveat==="string"?data.caveat.slice(0,2000):"Mapped context; completeness unverified.",featureCollection:{type:"FeatureCollection",features}};
}
export type LivePosition={userId:string;name:string;latitude:number;longitude:number;accuracyMetres:number;observedAt:string;sharingStatus:string};
