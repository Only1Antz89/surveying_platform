/** Platform provisioning is distinct from tenant activation and personal OAuth. */
export const canManagePlatformIntegrations = (role: string) => role === "super_admin";
export const canConfigureClientPayments = (role: string) => ["owner", "administrator"].includes(role);
export const firmCapabilityVisible = (role: string, key: string) =>
  ["google", "microsoft"].includes(key) ||
  (key === "payments" && canConfigureClientPayments(role)) ||
  (key === "quotes" && ["owner", "administrator", "manager"].includes(role));
