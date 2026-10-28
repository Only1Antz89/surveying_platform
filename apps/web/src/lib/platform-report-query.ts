export function canReadBusinessReports(role: string) {
  return role === "super_admin" || role === "billing";
}
export function reportQuery(params: URLSearchParams, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const preset = ["7", "30", "90", "custom"].includes(
    params.get("period") ?? "",
  )
    ? params.get("period")!
    : "30";
  const to = preset === "custom" ? (params.get("to") ?? today) : today;
  const from =
    preset === "custom"
      ? (params.get("from") ?? today)
      : new Date(Date.parse(today) + (1 - Number(preset)) * 86400000)
          .toISOString()
          .slice(0, 10);
  for (const value of [from, to])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value
    )
      throw Error("Enter valid dates.");
  if (from > to || Date.parse(to) - Date.parse(from) > 365 * 86400000)
    throw Error("Choose an ordered date range of no more than 366 days.");
  const customer = params.get("customer") ?? "";
  if (
    customer &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      customer,
    )
  )
    throw Error("Choose a valid customer.");
  return {
    from,
    to,
    period: preset,
    customer,
    includeDemo: params.get("demo") === "include",
    view: params.get("view") === "operations" ? "operations" : "business",
  };
}
