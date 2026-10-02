/** Platform kill-switch for suggestions and their review. Off unless explicitly enabled. */
export const assistantEnabled = () => process.env.ASSISTANT_ENABLED === "true";
