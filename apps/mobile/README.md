# Surveynt Fieldwork companion

Expo companion for assigned jobs, navigation and explicit workday location sharing. Uses native background location; Expo Go cannot verify the required behaviour.

## Setup

Copy `.env.example` to your local mobile environment. Use the deployed HTTPS app URL and the same Clerk instance as the web application. Public variables contain no server secrets.

Configure a Clerk JWT template named `surveynt-mobile`, with `aud` set to `surveynt-mobile` and `org_id` supplied from the active organisation. Sign in, select a practice and ensure the corresponding internal active membership has survey recording permission and full subscription access (or the existing `billing_exempt` entitlement).

From the repository root:

```sh
pnpm --filter @surveynt/mobile ios
pnpm --filter @surveynt/mobile android
```

Install a development/native build on physical devices and grant foreground/background location permission. Native signing and release packaging require your Apple/Android credentials; nothing was published.

## Behaviour and device acceptance

Start/stop sharing is explicit. While moving, the native task requests updates about every 30 seconds, subject to OS scheduling. Manager-facing uploads carry timestamp and measured accuracy. Only the latest point is retained. There is no offline coordinate backlog. Sharing ends at configured workday end or 12 hours; failed stop requests retry without resuming coordinate uploads.

Verify on physical iOS and Android: sign-in/MFA, organisation selection, assigned-job isolation, navigation, explicit job status confirmation, backgrounding, screen lock, revoked permissions, stopped/expired sessions and lost/recovered connectivity. Confirm uploads stop after logout/practice switch and stale offline updates do not reappear. Both platform JavaScript bundles were exported locally; physical/native verification remains outstanding.

[Expo Location documentation](https://docs.expo.dev/versions/latest/sdk/location/)
