import { z } from "zod";
export const professionalDetailsSchema=z.object({
  droneOperatorId:z.string().trim().max(100).default(""),
  droneFlyerId:z.string().trim().max(100).default(""),
  droneQualification:z.string().trim().max(160).default(""),
  droneExpiry:z.union([z.iso.date(),z.literal("")]).default(""),
});
export type ProfessionalDetails=z.infer<typeof professionalDetailsSchema>;
export const emptyProfessionalDetails:ProfessionalDetails={droneOperatorId:"",droneFlyerId:"",droneQualification:"",droneExpiry:""};
