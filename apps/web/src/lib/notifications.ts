export function notificationResources(preferences:Record<string,boolean>,role:string){
  if(role==="finance")return preferences["Payment updates"]===false?[]:["invoice","client_payment","settlement_batch"];
  const resources:string[]=[];
  if(preferences["Assigned jobs"]!==false)resources.push("job","property","quote");
  if(preferences["Report reviews"]!==false)resources.push("report_version","survey");
  if(preferences["Appointment changes"]!==false)resources.push("appointment","calendar_conflict","availability_block");
  if(preferences["Payment updates"]!==false&&["owner","administrator","manager","finance"].includes(role))resources.push("invoice","client_payment","settlement_batch");
  return resources;
}
