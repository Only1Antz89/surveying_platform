import { sql } from "drizzle-orm";
import type { Database } from "@surveynt/db";
import { postcodeAreasFromExtent, PRICE_PAID_LOOKUP_SOURCE, PRICE_PAID_SOURCE } from "../importers/price-paid";
import type { HistoryQuery, SaleRecord } from "../providers/types";
import { getActiveSync, getSourceState } from "./reference";

/**
 * Sales linked to a UPRN through the active look-up version only. Nothing is
 * matched by address or distance. Look-up rows whose transaction is absent
 * from the imported Price Paid version are counted, not shown.
 */
export function databaseHistoryQuery(db: Database): HistoryQuery {
  return {
    async salesForUprn(uprn) {
      const [pricePaid, lookup, lookupState] = await Promise.all([getActiveSync(db, PRICE_PAID_SOURCE), getActiveSync(db, PRICE_PAID_LOOKUP_SOURCE), getSourceState(db, PRICE_PAID_LOOKUP_SOURCE)]);
      if (!pricePaid) return { available: false, reason: "price_paid_not_imported" };
      if (!lookup) return { available: false, reason: "lookup_not_imported" };
      if (!lookupState.enabled) return { available: false, reason: "lookup_not_enabled" };
      const result = await db.execute(sql`
        select l.transaction_id, t.price, t.transfer_date::text as transfer_date, t.property_type, t.new_build, t.tenure, t.ppd_category,
          (select count(*)::int from price_paid_uprn_links other where other.dataset_version_id = l.dataset_version_id and other.transaction_id = l.transaction_id) as linked_uprn_count
        from price_paid_uprn_links l
        left join price_paid_transactions t on t.dataset_version_id = ${pricePaid.id} and t.transaction_id = l.transaction_id
        where l.dataset_version_id = ${lookup.id} and l.uprn = ${uprn}
        order by t.transfer_date desc nulls last
        limit 200`);
      const rows = (result as unknown as { rows: { transaction_id: string; price: number | null; transfer_date: string | null; property_type: SaleRecord["propertyType"] | null; new_build: boolean | null; tenure: SaleRecord["tenure"] | null; ppd_category: SaleRecord["ppdCategory"] | null; linked_uprn_count: number }[] }).rows;
      const sales = rows.filter((row) => row.price !== null).map((row): SaleRecord => ({
        transactionId: row.transaction_id, price: Number(row.price), transferDate: row.transfer_date!, propertyType: row.property_type!, newBuild: Boolean(row.new_build), tenure: row.tenure!, ppdCategory: row.ppd_category!, linkedUprnCount: Number(row.linked_uprn_count),
      }));
      return {
        available: true,
        pricePaidVersion: pricePaid.datasetVersion,
        lookupVersion: lookup.datasetVersion,
        // The operator labels each import with the release date (YYYY-MM or YYYY-MM-DD); anything else is not treated as a date.
        publishedAt: /^\d{4}-\d{2}(-\d{2})?$/.test(pricePaid.datasetVersion) ? pricePaid.datasetVersion : null,
        postcodeAreas: postcodeAreasFromExtent(pricePaid.extent),
        sales,
        unresolvedLinks: rows.length - sales.length,
      };
    },
  };
}
