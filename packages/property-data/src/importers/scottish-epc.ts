import { sql } from "drizzle-orm";
import type { Database } from "@surveynt/db";
import { parseCsvLine } from "./csv";
import type { ImportOutcome } from "./os-open-uprn";
import { normaliseUprn } from "./price-paid";
import { countRows, createSync, finish, lines, rejectionError } from "./staged";

export const SCOTTISH_EPC_SOURCE = "scottish_epc";

// The extract's column names could not be checked from the build environment.
// These are the reported names; an operator can override any of them.
export const scottishEpcColumns = {
  uprn: ["osg_reference_number", "osg_uprn", "uprn"],
  certificateKey: ["report_reference_number", "certificate_number", "lmk_key", "building_reference_number"],
  lodgementDate: ["lodgement_date", "date_of_certificate", "date_of_assessment"],
  currentRating: ["current_energy_rating", "current_energy_efficiency_band", "energy_rating_current"],
  potentialRating: ["potential_energy_rating", "potential_energy_efficiency_band", "energy_rating_potential"],
  propertyType: ["property_type"],
  builtForm: ["built_form"],
  constructionAgeBand: ["construction_age_band", "age_band"],
  totalFloorArea: ["total_floor_area"],
} as const;
export type ScottishEpcField = keyof typeof scottishEpcColumns;

const normalise = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function mapScottishEpcHeader(header: string[], overrides: Partial<Record<ScottishEpcField, string>> = {}) {
  const names = header.map(normalise);
  const indexes = {} as Record<ScottishEpcField, number>;
  for (const field of Object.keys(scottishEpcColumns) as ScottishEpcField[]) {
    const candidates = overrides[field] ? [normalise(overrides[field]!)] : scottishEpcColumns[field];
    indexes[field] = names.findIndex((name) => (candidates as readonly string[]).includes(name));
  }
  const missing = (["uprn", "certificateKey"] as const).filter((field) => indexes[field] < 0);
  if (missing.length) throw new Error(`Required columns not found: ${missing.join(", ")}. Pass --column ${missing[0]}=<published header>.`);
  return indexes;
}

/** ISO (yyyy-mm-dd…) or UK (dd/mm/yyyy) dates; anything else, or an impossible date, is dropped. */
function isoDate(raw: string | undefined) {
  const value = raw?.trim() ?? "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const uk = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const [year, month, day] = iso ? [iso[1], iso[2], iso[3]] : uk ? [uk[3], uk[2], uk[1]] : [];
  if (!year) return null;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) ? `${year}-${month}-${day}` : null;
}

const rating = (raw: string | undefined) => {
  const value = raw?.trim().toUpperCase() ?? "";
  return /^[A-G]$/.test(value) ? value : null;
};

export type ScottishEpcImportOptions = { filePath: string; datasetVersion: string; columns?: Partial<Record<ScottishEpcField, string>>; sourceUrl?: string; batchSize?: number; maxRejected?: number; activate?: boolean; importedBy: string };

/**
 * Full, versioned import of a Scottish EPC Register extract. Only certificate
 * facts and the published UPRN reference are kept; rows without a valid UPRN
 * cannot be linked exactly and are counted, not stored.
 */
export async function importScottishEpc(db: Database, options: ScottishEpcImportOptions): Promise<ImportOutcome> {
  const sync = await createSync(db, SCOTTISH_EPC_SOURCE, { ...options, extent: "full file" });
  return finish(db, sync, "scottish_epc_certificates", async () => {
    const counts = { read: 0, withoutUprn: 0, rejected: 0 };
    const rejected: { line: number; reason: string }[] = [];
    let columns: ReturnType<typeof mapScottishEpcHeader> | null = null;
    let batch: { key: string; uprn: string; lodged: string | null; current: string | null; potential: string | null; type: string | null; form: string | null; age: string | null; area: number | null }[] = [];
    const flush = async () => {
      if (!batch.length) return;
      await db.execute(sql`
        insert into reference.scottish_epc_certificates (dataset_sync_id, certificate_key, uprn, lodgement_date, current_rating, potential_rating, property_type, built_form, construction_age_band, total_floor_area_m2)
        select ${sync.id}::uuid, t.k, t.u, t.d, t.c, t.p, t.ty, t.f, t.a, t.ar
        from unnest(${sql.param(batch.map((row) => row.key))}::text[], ${sql.param(batch.map((row) => row.uprn))}::text[], ${sql.param(batch.map((row) => row.lodged))}::date[], ${sql.param(batch.map((row) => row.current))}::text[], ${sql.param(batch.map((row) => row.potential))}::text[], ${sql.param(batch.map((row) => row.type))}::text[], ${sql.param(batch.map((row) => row.form))}::text[], ${sql.param(batch.map((row) => row.age))}::text[], ${sql.param(batch.map((row) => row.area))}::float8[])
          as t(k, u, d, c, p, ty, f, a, ar)
        on conflict (dataset_sync_id, certificate_key) do nothing`);
      batch = [];
    };
    for await (const { line, number } of lines(options.filePath)) {
      const fields = parseCsvLine(line);
      if (!columns) {
        if (!fields) throw new Error("The header line is not valid CSV.");
        columns = mapScottishEpcHeader(fields, options.columns);
        continue;
      }
      counts.read += 1;
      if (!fields) { counts.rejected += 1; if (rejected.length < 5) rejected.push({ line: number, reason: "unterminated quote" }); continue; }
      const at = (field: ScottishEpcField) => (columns![field] >= 0 ? fields[columns![field]] : undefined);
      const uprn = normaliseUprn(at("uprn") ?? "");
      if (!uprn) { counts.withoutUprn += 1; continue; }
      const key = (at("certificateKey") ?? "").trim();
      if (!key || key.length > 80) { counts.rejected += 1; if (rejected.length < 5) rejected.push({ line: number, reason: "missing certificate reference" }); continue; }
      const area = Number(at("totalFloorArea"));
      batch.push({ key, uprn, lodged: isoDate(at("lodgementDate")), current: rating(at("currentRating")), potential: rating(at("potentialRating")), type: at("propertyType")?.trim().slice(0, 80) || null, form: at("builtForm")?.trim().slice(0, 80) || null, age: at("constructionAgeBand")?.trim().slice(0, 80) || null, area: Number.isFinite(area) && area > 0 ? area : null });
      if (batch.length >= (options.batchSize ?? 5000)) await flush();
    }
    await flush();
    const stored = await countRows(db, "scottish_epc_certificates", sync.id);
    const validation = { ...counts, storedRows: stored, firstRejections: rejected, columns };
    if (counts.rejected > (options.maxRejected ?? 0)) throw rejectionError(rejected, counts.rejected, options.maxRejected ?? 0, validation);
    if (stored === 0) throw Object.assign(new Error("No certificates with a UPRN were found."), { validation });
    return { stored, skipped: counts.rejected + counts.withoutUprn, validation };
  }, options.activate);
}
