// Day headings rendered on both server and client. Intl output differs between
// Node and browser ICU data (for example "Mon 5 Oct" and "Mon, 5 Oct"), which
// breaks hydration, so the label is assembled from the Europe/London date parts.
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const londonDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

export function londonDayLabel(value: Date | string, style: "short" | "long" = "short") {
  const parts = Object.fromEntries(londonDate.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  const day = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const weekday = weekdays[day.getUTCDay()], month = months[day.getUTCMonth()];
  return style === "long" ? `${weekday} ${day.getUTCDate()} ${month}` : `${weekday.slice(0, 3)} ${day.getUTCDate()} ${month.slice(0, 3)}`;
}
