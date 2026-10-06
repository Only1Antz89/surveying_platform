export function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return { weekday: part("weekday").toLowerCase(), date: `${part("year")}-${part("month")}-${part("day")}`, minutes: Number(part("hour")) * 60 + Number(part("minute")) };
}

/** Calendar-day bounds in a named timezone; a DST day can be 23 or 25 hours. */
export function localDayRange(day:string,timeZone="Europe/London"){
  function midnight(key:string){const desired=Date.parse(`${key}T00:00:00Z`);let instant=desired;for(let i=0;i<3;i++){const parts=localParts(new Date(instant),timeZone);const actual=Date.parse(`${parts.date}T00:00:00Z`)+parts.minutes*60000;instant+=desired-actual;}return new Date(instant);}
  const next=new Date(`${day}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+1);
  return {start:midnight(day),end:midnight(next.toISOString().slice(0,10))};
}
