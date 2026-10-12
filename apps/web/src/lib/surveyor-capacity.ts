export type SurveyorCapacity = {
  id: string; name: string; initials: string; base: string | null; services: string[];
  activeJobs: number; capacityJobs: number | null; inspectionsToday: number;
};
/** Declared active-job headroom, not a guarantee that a particular visit can be allocated. */
export function workloadHeadroom(person: Pick<SurveyorCapacity, "activeJobs" | "capacityJobs">) {
  return person.capacityJobs === null ? null : Math.max(0, person.capacityJobs - person.activeJobs);
}
export function orderSurveyorCapacity(people: SurveyorCapacity[]) {
  return [...people].sort((a,b) => (workloadHeadroom(b) ?? -1) - (workloadHeadroom(a) ?? -1) || a.activeJobs-b.activeJobs || a.name.localeCompare(b.name));
}
