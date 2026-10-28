/** Server-controlled canonical origin; never derive invitation destinations from a request Host header. */
export function platformApplicationUrl() {
  const configured = (
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL
  )?.trim();
  if (!configured) throw new Error("The application URL is not configured.");
  const url = new URL(configured);
  if (
    url.protocol !== "https:" &&
    !(
      process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Error("A secure application URL is required.");
  if (url.username || url.password)
    throw new Error("The application URL must not contain credentials.");
  return url.origin;
}
export function platformInvitationsConfigured() {
  if (!process.env.CLERK_WEBHOOK_SECRET || !process.env.DATABASE_ADMIN_URL)
    return false;
  try {
    platformApplicationUrl();
    return true;
  } catch {
    return false;
  }
}
