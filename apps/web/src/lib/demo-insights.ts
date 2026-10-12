import { jobs } from "./demo-data";
import type { PracticeInsights } from "./insights";
/** Only current fixture counts are available; the preview has no dated quote/payment/issue records. */
export function demoPracticeInsights(from:Date,to:Date):PracticeInsights {
  const distribution=(values:string[])=>[...new Set(values)].map(name=>({name,count:values.filter(value=>value===name).length}));
  return {from:from.toISOString(),to:to.toISOString(),quotes:0,converted:0,conversionPercent:null,money:[],
    pipeline:distribution(jobs.filter(job=>job.stage!=="archived").map(job=>job.stage)),
    workload:distribution(jobs.filter(job=>!["paid","archived"].includes(job.stage)).map(job=>job.assignee)),
    services:[],completion:{count:0,days:null}};
}
