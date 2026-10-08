import type { ExternalEvent } from "./calendar-events";

/** A local reschedule is safe to export only when the provider revision is unchanged. */
export function hasExternalCalendarConflict(event:ExternalEvent,appointment:{startsAt:Date;endsAt:Date;version:number},link:{externalVersion:string|null;lastSyncedAppointmentVersion:number}){
  if(event.cancelled)return true;
  const different=!event.start||!event.end||Math.abs(event.start.getTime()-appointment.startsAt.getTime())>1000||Math.abs(event.end.getTime()-appointment.endsAt.getTime())>1000;
  if(!different)return false;
  const localChanged=appointment.version>link.lastSyncedAppointmentVersion;
  const knownUnchangedRemote=event.version!==null&&link.externalVersion!==null&&event.version===link.externalVersion;
  return !(localChanged&&knownUnchangedRemote);
}
