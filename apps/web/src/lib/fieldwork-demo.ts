import { jobs, properties, members } from "./demo-data";
import type { FieldworkRoute } from "./fieldwork";
/** Local, non-persistent preview only. Coordinates are illustrative, never confirmed property identities. */
export function localFieldworkDemo(day:string):FieldworkRoute {
 const points=[{latitude:51.4544,longitude:-2.6198},{latitude:51.4555,longitude:-2.603},{latitude:51.378,longitude:-2.36}];
 const sample=[jobs[0],jobs[1],jobs[2]];
 return {date:day,origin:null,selectedSurveyorId:null,timezone:"Europe/London",today:day,showTomorrow:new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",hourCycle:"h23"}).format(new Date())>="16",surveyors:members.filter(m=>sample.some(j=>j.assignee===m.name)).map(m=>({id:m.id,name:m.name})),provider:{status:"demo",attribution:"Local fictional demonstration · illustrative locations, no road ETA"},stops:sample.map((job,i)=>{
  const property=properties[i];return{id:`preview-${i}`,jobId:job.id,propertyId:property.id,reference:job.reference,clientName:job.client,serviceName:job.service,propertyType:property.type,address:`${property.address}, ${property.town}, ${property.postcode}`,startsAt:`${day}T${String(9+i*2).padStart(2,"0")}:00:00+01:00`,endsAt:`${day}T${String(10+i*2).padStart(2,"0")}:30:00+01:00`,surveyorId:members.find(m=>m.name===job.assignee)?.id??null,surveyorName:job.assignee,coordinates:points[i],precision:"illustrative_demo",directDistanceMetres:null,openInMapsUrl:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${property.address}, ${property.town}`)}`};
 })};
}
