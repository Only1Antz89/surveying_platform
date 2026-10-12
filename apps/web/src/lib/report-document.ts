import type { ComposedReport, ReportBlock } from "@surveynt/assistant";
const escape = (text:string) => text.replace(/[&<>"']/g, value => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[value]!));
const block = (item:ReportBlock) => `<p>${escape(item.text).replace(/\n/g,"<br>")}</p>`;
/** Review copy only. Exact licensed documents are a separate, versioned output adapter. */
export function reportDocument(report:ComposedReport) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(report.jobReference)} — draft</title><style>
  @page{size:A4;margin:20mm}body{font:11pt Arial,sans-serif;color:#000;background:#fff;max-width:180mm;margin:24px auto;line-height:1.5}h1,h2,h3{color:#4d2d69}h1{font-size:24pt}h2{border-top:2px solid #4d2d69;padding-top:12px;break-after:avoid}h3{break-after:avoid}p{white-space:normal;overflow-wrap:anywhere}header{border-bottom:3px solid #4d2d69}footer{border-top:1px solid #4d2d69;font-size:9pt}button{color:#000}@media print{button{display:none}body{margin:0}} </style></head><body><button onclick="window.print()">Print / save PDF</button><header><p>DRAFT — NOT FOR ISSUE</p><h1>${escape(report.title)}</h1><p>${escape([report.property.line1,report.property.city,report.property.postcode].filter(Boolean).join(", "))}</p><p>Reference: ${escape(report.jobReference)}</p></header>
  ${report.sections.map(section=>`<section><h2>${escape(section.title)}</h2>${section.blocks.map(block).join("")}${section.elements.map(element=>`<article><h3>${escape(element.title)}</h3>${element.blocks.map(block).join("")}</article>`).join("")}</section>`).join("")}
  ${report.recommendations.length ? `<section><h2>Recommendations</h2>${report.recommendations.map(block).join("")}</section>` : ""}
  ${report.omissions.length ? `<section><h2>Review required</h2><ul>${report.omissions.map(item=>`<li>${escape(item)}</li>`).join("")}</ul></section>` : ""}
  <footer>Surveyant review copy · ${escape(report.templateKey)} ${escape(report.templateVersion)} · Configure the company’s licensed template and complete professional review before issue.</footer></body></html>`;
}
