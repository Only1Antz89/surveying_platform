import type { JobStage, OrganisationRole, OrganisationStatus, SubscriptionStatus } from "@surveynt/domain";

export type Client = { id: string; name: string; kind: "Individual" | "Company"; email: string; phone: string; properties: number; lastActivity: string; version?: number };
export type Property = { id: string; address: string; town: string; postcode: string; type: string; client: string; activeJobs: number; version?: number };
export type Job = { id: string; reference: string; client: string; address: string; service: string; stage: JobStage; assignee: string; target: string; fee?: number; priority: "Normal" | "High"; version?: number };
export type Member = { id: string; name: string; email: string; initials: string; role: OrganisationRole; status: "Active" | "Invited"; canRecordSurvey?: boolean; canApproveReports?: boolean; workload: string };
export type Tenant = { id: string; name: string; owner: string; plan: string; status: OrganisationStatus; subscription: SubscriptionStatus; seats: number; trialEnds: string; onboarding: number; usage: number; lastActive: string };

export const clients: Client[] = [
  { id: "cli_01", name: "Elizabeth Harrington", kind: "Individual", email: "elizabeth@example.co.uk", phone: "07700 900 124", properties: 2, lastActivity: "Today, 09:42" },
  { id: "cli_02", name: "Whitmore Property Group", kind: "Company", email: "projects@whitmore.co.uk", phone: "020 7946 0384", properties: 6, lastActivity: "Yesterday" },
  { id: "cli_03", name: "Daniel Okafor", kind: "Individual", email: "daniel@example.co.uk", phone: "07700 900 492", properties: 1, lastActivity: "27 Sep 2026" },
  { id: "cli_04", name: "Alder & Stone Developments", kind: "Company", email: "office@alderstone.co.uk", phone: "0117 496 0190", properties: 4, lastActivity: "26 Sep 2026" },
  { id: "cli_05", name: "Sophie Bennett", kind: "Individual", email: "sophie@example.co.uk", phone: "07700 900 782", properties: 1, lastActivity: "24 Sep 2026" },
];

export const properties: Property[] = [
  { id: "prop_01", address: "18 Royal York Crescent", town: "Bristol", postcode: "BS8 4JX", type: "Georgian terrace", client: "Elizabeth Harrington", activeJobs: 1 },
  { id: "prop_02", address: "Westgate House, Park Street", town: "Bristol", postcode: "BS1 5PB", type: "Commercial office", client: "Whitmore Property Group", activeJobs: 2 },
  { id: "prop_03", address: "42 Sydenham Road", town: "Bath", postcode: "BA2 3DA", type: "Victorian semi", client: "Daniel Okafor", activeJobs: 1 },
  { id: "prop_04", address: "The Old Granary, Station Lane", town: "Frome", postcode: "BA11 1RE", type: "Barn conversion", client: "Alder & Stone Developments", activeJobs: 0 },
  { id: "prop_05", address: "7 Willowbank Close", town: "Portishead", postcode: "BS20 6QS", type: "Detached house", client: "Sophie Bennett", activeJobs: 1 },
];

export const jobs: Job[] = [
  { id: "job_01", reference: "SVY-1048", client: "Elizabeth Harrington", address: "18 Royal York Crescent, Bristol", service: "Level 3 Building Survey", stage: "scheduled", assignee: "Maya Patel", target: "Today, 13:30", fee: 1450, priority: "High" },
  { id: "job_02", reference: "SVY-1047", client: "Whitmore Property Group", address: "Westgate House, Bristol", service: "Commercial Survey", stage: "internal_review", assignee: "Oliver Grant", target: "Today, 16:00", fee: 3200, priority: "High" },
  { id: "job_03", reference: "SVY-1046", client: "Daniel Okafor", address: "42 Sydenham Road, Bath", service: "Level 2 Home Survey", stage: "report_drafting", assignee: "Maya Patel", target: "30 Sep 2026", fee: 895, priority: "Normal" },
  { id: "job_04", reference: "SVY-1045", client: "Alder & Stone Developments", address: "The Old Granary, Frome", service: "Defect Investigation", stage: "quoted", assignee: "Unassigned", target: "02 Oct 2026", fee: 1100, priority: "Normal" },
  { id: "job_05", reference: "SVY-1044", client: "Sophie Bennett", address: "7 Willowbank Close, Portishead", service: "Level 3 Building Survey", stage: "instructed", assignee: "Amara Lewis", target: "04 Oct 2026", fee: 1295, priority: "Normal" },
];

export const members: Member[] = [
  { id: "mem_01", name: "Maya Patel", email: "maya@northstarsurveying.co.uk", initials: "MP", role: "owner", status: "Active", workload: "5 active jobs" },
  { id: "mem_02", name: "Oliver Grant", email: "oliver@northstarsurveying.co.uk", initials: "OG", role: "surveyor", status: "Active", workload: "4 active jobs" },
  { id: "mem_03", name: "Amara Lewis", email: "amara@northstarsurveying.co.uk", initials: "AL", role: "surveyor", status: "Active", workload: "3 active jobs" },
  { id: "mem_04", name: "James Bell", email: "james@northstarsurveying.co.uk", initials: "JB", role: "coordinator", status: "Active", workload: "8 coordinated jobs" },
  { id: "mem_05", name: "Priya Shah", email: "priya@northstarsurveying.co.uk", initials: "PS", role: "finance", status: "Invited", workload: "Invite sent yesterday" },
];

export const tenants: Tenant[] = [
  { id: "org_01", name: "North Star Surveying", owner: "Maya Patel", plan: "Practice", status: "active", subscription: "trialing", seats: 5, trialEnds: "10 Oct 2026", onboarding: 86, usage: 68, lastActive: "2 min ago" },
  { id: "org_02", name: "Cedar Building Consultancy", owner: "Henry Walsh", plan: "Practice", status: "active", subscription: "active", seats: 12, trialEnds: "—", onboarding: 100, usage: 42, lastActive: "18 min ago" },
  { id: "org_03", name: "Mason & Vale", owner: "Ruth Mason", plan: "Studio", status: "provisioning", subscription: "incomplete", seats: 2, trialEnds: "—", onboarding: 30, usage: 8, lastActive: "3 hr ago" },
  { id: "org_04", name: "Southbank Property Advisory", owner: "Marcus Reid", plan: "Practice", status: "active", subscription: "past_due", seats: 8, trialEnds: "—", onboarding: 100, usage: 91, lastActive: "Yesterday" },
  { id: "org_05", name: "Hart & Field Surveyors", owner: "Fiona Hart", plan: "Studio", status: "suspended", subscription: "unpaid", seats: 3, trialEnds: "—", onboarding: 100, usage: 24, lastActive: "12 Sep 2026" },
];

export const activities = [
  { text: "Oliver moved SVY-1047 to internal review", time: "18 minutes ago" },
  { text: "Maya scheduled SVY-1048 for inspection", time: "1 hour ago" },
  { text: "James added Whitmore Property Group", time: "Yesterday at 16:42" },
  { text: "Amara accepted her team invitation", time: "Yesterday at 10:11" },
];
