export const deviceAlertKey="surveynt:device-alerts";
export type DeviceEvent={id:string;label:string;href:string;detail:string};
export function newDeviceEvents(rows:DeviceEvent[],seen:string[]){return rows.filter(row=>!seen.includes(row.id));}
export function safeNotificationPath(value:unknown):string{
  if(typeof value!=="string")return "/";
  try{const decoded=decodeURIComponent(value);return /^\/app\/[^/?#]+\/(overview|jobs|customers|calendar|reports|properties|finance)(\?|\/|$)/.test(decoded)&&!decoded.includes("\\")&&!/(^|\/)\.{1,2}(\/|$)/.test(decoded)?value:"/";}catch{return "/";}
}
export async function showDeviceAlert(body:string,tag:string,path="/"){
  const registration=await navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"});
  await navigator.serviceWorker.ready;
  await registration.showNotification("Surveynt",{body,tag,icon:"/icon.svg",data:{url:safeNotificationPath(path)}});
}
