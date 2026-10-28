import { platformApiContext } from "@/lib/access";
import {
  canReadBusinessReports,
  reportQuery,
} from "@/lib/platform-report-query";
import { loadPlatformReport, reportCsv } from "@/lib/platform-reports";
import { ok, problem } from "@/lib/api";
export async function GET(request: Request) {
  const c = await platformApiContext();
  if (!c) return problem(401, "unauthorised", "Platform access required.");
  const params = new URL(request.url).searchParams;
  try {
    const query = reportQuery(params);
    if (query.view === "business" && !canReadBusinessReports(c.role))
      return problem(
        403,
        "forbidden",
        "Business reports require billing or super-admin access.",
      );
  } catch {
    return problem(
      422,
      "invalid_report",
      "Choose valid report filters and a date range of up to 366 days.",
    );
  }
  const report = await loadPlatformReport(params, c.role, c.demo);
  if (params.get("format") === "csv")
    return new Response(reportCsv(report), {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition":
          'attachment; filename="surveynt-platform-report.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  return ok(report);
}
