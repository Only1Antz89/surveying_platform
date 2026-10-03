export function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return { weekday: part("weekday").toLowerCase(), date: `${part("year")}-${part("month")}-${part("day")}`, minutes: Number(part("hour")) * 60 + Number(part("minute")) };
}
