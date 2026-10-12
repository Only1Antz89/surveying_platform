type CitedMessage={role:string;citations?:{id:string}[]};
/** A saved answer must not replay records whose assignment has since been removed. */
export function personalConversationHistory<T extends CitedMessage>(messages:T[],permittedSourceIds:Set<string>):T[]{
 return messages.some(m=>m.role==="assistant"&&(!m.citations?.length||m.citations.some(c=>!permittedSourceIds.has(c.id))))?[]:messages;
}
