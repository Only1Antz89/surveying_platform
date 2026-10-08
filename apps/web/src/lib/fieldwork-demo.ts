import { jobs, properties } from "./demo-data";
import type { FieldworkRoute } from "./fieldwork";
/** Local, non-persistent preview only. Coordinates are illustrative, never confirmed property identities. */
export function localFieldworkDemo(day:string):FieldworkRoute {
 const points=[{latitude:51.4544,longitude:-2.6198},{latitude:51.4555,longitude:-2.603},{latitude:51.378,longitude:-2.36}];
 const sample=[jobs[0],jobs[1],jobs[2]];
 return {date:day,origin:null,selectedSurveyorId:null,surveyors:[],provider:{status:"demo",attribution:"Local fictional demonstration · illustrative locations, no road ETA"},stops:sample.map((job,i)=>{
  const property=properties[i];return{id:`preview-${i}`,jobId:job.id,propertyId:property.id,reference:job.reference,clientName:job.client,serviceName:job.service,propertyType:property.type,address:`${property.address}, ${property.town}, ${property.postcode}`,startsAt:`${day}T${String(9+i*2).padStart(2,"0")}:00:00+01:00`,endsAt:`${day}T${String(10+i*2).padStart(2,"0")}:30:00+01:00`,surveyorId:null,surveyorName:"Demonstration assignment",coordinates:points[i],precision:"illustrative_demo",directDistanceMetres:null,openInMapsUrl:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${property.address}, ${property.town}`)}`};
 })};
}
