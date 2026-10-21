// Go-live checks for the external services that need production keys.
// Each check reports which variables are missing or malformed and where each
// provider must send its webhooks, without ever returning a secret value.

type Env = Record<string, string | undefined>;

export type GoLiveCheck = {
  key: "authentication" | "billing" | "client_payments" | "email" | "quotes" | "calendar_google" | "calendar_microsoft" | "background_jobs";
  label: string;
  ready: boolean;
  /** Variable names that are unset. */
  missing: string[];
  /** Human-readable problems with variables that are set. Never includes values. */
  problems: string[];
  /** URLs to register with the provider, built from APP_URL. */
  register: { label: string; url: string }[];
  /** Non-technical approvals that also gate going live. */
  approvals: string[];
};

const set = (env: Env, name: string) => Boolean(env[name]?.trim());
const stripeMode = (value: string | undefined) => value?.match(/^(?:sk|rk)_(live|test)_/)?.[1] ?? null;

function base64Bytes(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return -1;
  return Buffer.from(value, "base64").length;
}

function appOrigin(env: Env) {
  const value = env.APP_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim();
  if (!value) return null;
  try { return new URL(value).origin; } catch { return null; }
}

function build(key: GoLiveCheck["key"], label: string, env: Env, required: string[], problems: string[], register: GoLiveCheck["register"] = [], approvals: string[] = []): GoLiveCheck {
  const missing = required.filter((name) => !set(env, name));
  return { key, label, ready: missing.length === 0 && problems.length === 0, missing, problems, register, approvals };
}

export function goLiveChecks(env: Env = process.env): GoLiveCheck[] {
  const origin = appOrigin(env);
  const at = (path: string) => (origin ? `${origin}${path}` : path);
  const originProblems = [
    ...(origin === null && (set(env, "APP_URL") || set(env, "NEXT_PUBLIC_APP_URL")) ? ["APP_URL is not a valid URL."] : []),
    ...(origin && !origin.startsWith("https://") && !origin.startsWith("http://localhost") ? ["APP_URL must use https in production."] : []),
  ];

  const auth: string[] = [];
  if (set(env, "CLERK_SECRET_KEY") && !/^sk_(live|test)_/.test(env.CLERK_SECRET_KEY!)) auth.push("CLERK_SECRET_KEY should start with sk_live_ or sk_test_.");
  if (set(env, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") && !/^pk_(live|test)_/.test(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!)) auth.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY should start with pk_live_ or pk_test_.");
  if (set(env, "CLERK_WEBHOOK_SECRET") && !env.CLERK_WEBHOOK_SECRET!.startsWith("whsec_")) auth.push("CLERK_WEBHOOK_SECRET should start with whsec_.");
  const clerkModes = [env.CLERK_SECRET_KEY?.match(/^sk_(live|test)_/)?.[1], env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.match(/^pk_(live|test)_/)?.[1]].filter(Boolean);
  if (new Set(clerkModes).size > 1) auth.push("The Clerk secret and publishable keys are from different modes (live and test).");

  const billing: string[] = [];
  const billingMode = stripeMode(env.STRIPE_SECRET_KEY);
  if (set(env, "STRIPE_SECRET_KEY") && !billingMode) billing.push("STRIPE_SECRET_KEY should start with sk_live_, sk_test_, rk_live_ or rk_test_.");
  if (set(env, "STRIPE_WEBHOOK_SECRET") && !env.STRIPE_WEBHOOK_SECRET!.startsWith("whsec_")) billing.push("STRIPE_WEBHOOK_SECRET should start with whsec_.");
  for (const name of ["STRIPE_BASE_PRICE_ID", "STRIPE_SEAT_PRICE_ID"]) if (set(env, name) && !env[name]!.startsWith("price_")) billing.push(`${name} should be a Stripe price ID starting with price_.`);

  const payments: string[] = [];
  const paymentsMode = stripeMode(env.STRIPE_CLIENT_PAYMENTS_KEY);
  if (set(env, "STRIPE_CLIENT_PAYMENTS_KEY") && !paymentsMode) payments.push("STRIPE_CLIENT_PAYMENTS_KEY should start with rk_ (restricted key) or sk_.");
  if (paymentsMode && billingMode && paymentsMode !== billingMode) payments.push("STRIPE_CLIENT_PAYMENTS_KEY and STRIPE_SECRET_KEY must both be live or both be test keys; the shared webhook verifies one account.");
  if (env.CLIENT_PAYMENTS_LAUNCH_APPROVED !== "true") payments.push("CLIENT_PAYMENTS_LAUNCH_APPROVED is not true, so checkout stays closed until approvals are recorded.");

  const email: string[] = [];
  if (set(env, "SMTP2GO_API_KEY") && !env.SMTP2GO_API_KEY!.startsWith("api-")) email.push("SMTP2GO_API_KEY should start with api-.");
  if (set(env, "SMTP2GO_SENDER") && !/^(?:[^<>]*<)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(env.SMTP2GO_SENDER!.trim())) email.push("SMTP2GO_SENDER should be an email address, optionally as \"Name <address>\".");

  const quotes: string[] = [];
  if (set(env, "QUOTE_TOKEN_SECRET") && env.QUOTE_TOKEN_SECRET!.length < 32) quotes.push("QUOTE_TOKEN_SECRET should be at least 32 random characters.");

  const calendarShared: string[] = [];
  if (set(env, "CALENDAR_TOKEN_ENCRYPTION_KEY") && base64Bytes(env.CALENDAR_TOKEN_ENCRYPTION_KEY!) !== 32) calendarShared.push("CALENDAR_TOKEN_ENCRYPTION_KEY must be base64 for exactly 32 bytes (openssl rand -base64 32).");
  if (set(env, "CALENDAR_WEBHOOK_SECRET") && env.CALENDAR_WEBHOOK_SECRET!.length < 32) calendarShared.push("CALENDAR_WEBHOOK_SECRET should be at least 32 random characters.");
  if (set(env, "CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION") && !/^[1-9]\d{0,5}$/.test(env.CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION!)) calendarShared.push("CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION must be a positive whole number.");
  if (set(env, "CALENDAR_TOKEN_ENCRYPTION_PREVIOUS_KEYS")) {
    try {
      const previous = JSON.parse(env.CALENDAR_TOKEN_ENCRYPTION_PREVIOUS_KEYS!) as unknown;
      if (!previous || typeof previous !== "object" || Array.isArray(previous) || Object.values(previous).some((value) => typeof value !== "string" || base64Bytes(value) !== 32)) throw new Error();
    } catch { calendarShared.push("CALENDAR_TOKEN_ENCRYPTION_PREVIOUS_KEYS must be a JSON object of version to 32-byte base64 key."); }
  }
  const calendarRequired = ["APP_URL", "CALENDAR_TOKEN_ENCRYPTION_KEY", "CALENDAR_WEBHOOK_SECRET", "CRON_SECRET", "QUEUE_CONSUMER_SECRET"];
  const callback = { label: "OAuth redirect URI", url: at("/api/v1/calendar/oauth/callback") };

  const jobs: string[] = [];
  for (const name of ["CRON_SECRET", "QUEUE_CONSUMER_SECRET"]) if (set(env, name) && env[name]!.length < 32) jobs.push(`${name} should be at least 32 random characters.`);

  return [
    build("authentication", "Sign-in (Clerk)", env, ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "CLERK_WEBHOOK_SECRET"], auth,
      [{ label: "Clerk webhook (user.created, user.updated, organization.created)", url: at("/api/webhooks/clerk") }]),
    build("billing", "Subscription billing (Stripe)", env, ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_BASE_PRICE_ID", "STRIPE_SEAT_PRICE_ID", "APP_URL"], [...billing, ...originProblems],
      [{ label: "Stripe webhook (checkout.session.*, customer.subscription.*, charge.refunded)", url: at("/api/webhooks/stripe") }]),
    build("client_payments", "Client deposits and balances (Stripe)", env, ["STRIPE_CLIENT_PAYMENTS_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "APP_URL"], payments,
      [{ label: "Uses the same Stripe webhook", url: at("/api/webhooks/stripe") }],
      ["Legal, accounting, VAT, refund-policy and client-money approval", "Each practice switches on client payments in its settings"]),
    build("email", "Transactional email (SMTP2GO)", env, ["SMTP2GO_API_KEY", "SMTP2GO_SENDER", "APP_URL", "QUEUE_CONSUMER_SECRET"], [...email, ...originProblems], [],
      ["Verify the sender domain in SMTP2GO (SPF and DKIM)"]),
    build("quotes", "Public customer quotes", env, ["QUOTE_TOKEN_SECRET", "APP_URL"], [...quotes, ...originProblems], [],
      ["Each practice enables public quotes in its settings"]),
    build("calendar_google", "Google Calendar sync", env, ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET", ...calendarRequired], [...calendarShared, ...originProblems],
      [callback, { label: "Google push notifications", url: at("/api/webhooks/calendar/google") }],
      ["Google OAuth consent screen verified for the calendar scope"]),
    build("calendar_microsoft", "Microsoft 365 calendar sync", env, ["MICROSOFT_CALENDAR_CLIENT_ID", "MICROSOFT_CALENDAR_CLIENT_SECRET", ...calendarRequired], [...calendarShared, ...originProblems],
      [callback, { label: "Microsoft Graph notifications", url: at("/api/webhooks/calendar/microsoft") }]),
    build("background_jobs", "Scheduled jobs and queues", env, ["CRON_SECRET", "QUEUE_CONSUMER_SECRET", "APP_URL"], [...jobs, ...originProblems]),
  ];
}
