type Profile={email:string;firstName:string|null|undefined;lastName:string|null|undefined};
export function changedAccountProfileFields(previous:Profile|null,next:Profile):Array<"email"|"firstName"|"lastName"|"photo"> {
  const fields=["email","firstName","lastName"] as const;
  return fields.filter(field=>!previous||(previous[field]??null)!==(next[field]??null));
}
