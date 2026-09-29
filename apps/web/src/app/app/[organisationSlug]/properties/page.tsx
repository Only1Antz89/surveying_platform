import { Building2, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ActionButton } from "@/components/action-feedback";
import { properties } from "@/lib/demo-data";

export const metadata = { title: "Properties" };
export default function PropertiesPage() { return <main className="page"><PageHeader title="Properties" description="A single property record for every address, linked to its clients and active work." actions={<ActionButton className="button button-primary" message="Property creation flow opened"><Plus size={15} />New property</ActionButton>} /><section className="panel"><div className="panel-header"><div><h2>Property register</h2><p>{properties.length} properties in this demonstration workspace</p></div><Building2 size={17} color="#2563eb" /></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Address</th><th>Property type</th><th>Client</th><th>Active jobs</th></tr></thead><tbody>{properties.map((property) => <tr key={property.id}><td data-label="Address"><strong>{property.address}</strong><span className="cell-sub">{property.town} · {property.postcode}</span></td><td data-label="Property type">{property.type}</td><td data-label="Client">{property.client}</td><td data-label="Active jobs">{property.activeJobs}</td></tr>)}</tbody></table></div></section></main>; }
