import { and, desc, eq } from "drizzle-orm";
import { scottishEpcCertificates, type Database } from "@surveynt/db";
import { SCOTTISH_EPC_SOURCE } from "../importers/scottish-epc";
import type { ScottishEpcQuery } from "../providers/types";
import { getActiveSync } from "./reference";

export function databaseScottishEpcQuery(db: Database): ScottishEpcQuery {
  return {
    async certificatesForUprn(uprn) {
      const active = await getActiveSync(db, SCOTTISH_EPC_SOURCE);
      if (!active) return { available: false };
      const rows = await db.select().from(scottishEpcCertificates).where(and(eq(scottishEpcCertificates.datasetVersionId, active.id), eq(scottishEpcCertificates.uprn, uprn))).orderBy(desc(scottishEpcCertificates.lodgementDate)).limit(50);
      return { available: true, datasetVersion: active.datasetVersion, certificates: rows.map((row) => ({ certificateKey: row.certificateKey, lodgementDate: row.lodgementDate, currentRating: row.currentRating, potentialRating: row.potentialRating, propertyType: row.propertyType, builtForm: row.builtForm, constructionAgeBand: row.constructionAgeBand, totalFloorAreaM2: row.totalFloorAreaM2 })) };
    },
  };
}
