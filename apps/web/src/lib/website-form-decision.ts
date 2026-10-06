import { normaliseFormAnswers, type FormContext, type FormSubmission } from "./website-form-config";
import { recommendCliftonService, quoteMoney } from "./survey-adviser";
export function formDecision(context: FormContext, answers: FormSubmission["answers"], serviceId?: string) {
  const recommendation = recommendCliftonService(normaliseFormAnswers(answers));
  const service = answers.path === "residential" && answers.purpose !== "bespoke" && answers.propertyAge !== "unknown" && answers.propertyType !== "Other" ? (serviceId ? context.services.find(s => s.id === serviceId) : context.services.find(s => s.adviser && s.name === recommendation.match)) : undefined;
  const surcharges = service ? Object.entries(service.surcharges).filter(([key]) => answers.alterationTypes.includes(key as FormSubmission["answers"]["alterationTypes"][number])).map(([, value]) => value) : [];
  return { service, reason: service ? service.adviser ? recommendation.reason : "You selected this service. The practice will confirm its suitability and agreed scope." : "Your enquiry needs a bespoke review. No instant price has been assumed.", surcharges, money: service ? quoteMoney(service.baseAmountMinor, service.vatBasisPoints, service.depositBasisPoints, surcharges) : null };
}
