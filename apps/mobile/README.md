# Surveynt Fieldwork companion

Expo companion for assigned jobs, navigation, site capture and explicit workday location sharing. Uses native background location; Expo Go cannot verify the required behaviour.

## Setup

Copy `.env.example` to your local mobile environment. Use the deployed HTTPS app URL and the same Clerk instance as the web application. Public variables contain no server secrets.

Configure a Clerk JWT template named `surveynt-mobile`, with `aud` set to `surveynt-mobile` and `org_id` supplied from the active organisation. The app also sends its Clerk session token in `x-surveynt-session-token`. A custom JWT alone is not session-bound and cannot prove MFA. Practices requiring two-step sign-in accept only a separately verified session token for the same user and active organisation, with a verified second factor. Sign in, select a practice and ensure the corresponding internal active membership has survey recording permission and full subscription access (or the existing `billing_exempt` entitlement).

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

## Site capture and offline queue

"Capture on site" on a job opens the survey outline for that job (it must already be started in the workspace). For each inspectable element the surveyor can:

- set the inspection status (inspected, not inspected, inaccessible, not applicable; a reason is required when not inspected);
- take photos with the camera, tagged to the element;
- save a site note, recorded as a current observation.

Rooms with dimensions and time on site can also be recorded. Field answers and report wording stay in the full survey workspace.

Every action is written to the device first: a JSON queue per practice and user in the app's document directory, and photos copied out of the camera cache. The queue syncs on launch, on returning to the app and after each capture, in order, stopping at the first connection problem.

- **Retries:** survey changes and room/cost submissions carry stable operation ids; photos carry client ids. The server stores room/cost replay receipts atomically, scoped to the practice and user. Retries return the original result, including concurrent sends. Reusing an id for different data is rejected.
- **Errors:** if the server refuses an item (validation or permission), it stays on the device marked for attention and can be discarded. Sign-in, rate-limit and server errors are retried.
- **Release pairing:** apply migration `0084_mobile_capture_retries` before releasing this server code; grant the tenant runtime role DML on the new `mobile_capture_operations` table if migration-owner default grants are not configured. Deploy the updated companion with the server: older companions without a stable `x-surveynt-operation-id` are explicitly rejected for room/cost writes instead of risking duplicates. MFA-required practices also need the updated session-token header. Physical-device acceptance remains required.

Server endpoints: `GET /api/mobile/jobs/:id/capture`, `POST /api/mobile/surveys/:id/sync` (status, notes and photo links only), `POST /api/mobile/surveys/:id/media`, `POST /api/mobile/surveys/:id/rooms` and `POST /api/mobile/jobs/:id/costs`. All use the same mobile token, assignment checks and recording permission as the existing mobile routes.

Photo upload needs the practice's storage to be configured; until then photos stay queued on the device with the storage message.

Verify on physical devices:

- camera permission prompts and denial;
- capture with no signal, then sync on reconnection;
- app restarts with a non-empty queue;
- switching practice, which keeps queues separate;
- large photos on mobile data.


## Internal testing release

The `internal` profile in `eas.json` builds a standalone Android APK and an iOS ad hoc build. It targets the production API; use dedicated, authorised test accounts and fictional records. It is not an App Store/Play Store submission or an Expo Go build.

The release operator must sign in to the intended Expo account and link this app to its EAS project (`eas init` from `apps/mobile`). Set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in that project's **preview** EAS environment to the same Clerk instance as the production API. The API URL is already set in the profile. No server secrets belong in the mobile environment.

For iOS, the operator needs Apple Developer signing access and must register each tester's device with `eas device:create` before building. Android needs the project's signing keystore (or an operator-approved new keystore for its first release). Run from `apps/mobile` with an EAS CLI satisfying the configured version:

```sh
eas build --profile internal --platform android
eas build --profile internal --platform ios
```

Share the resulting installation links only with the internal testers. In the Expo project's settings, disable **Unauthenticated access to internal builds** so downloading requires an authorised Expo account. Project linking, signing, cloud builds and installation links remain pending until the operator signs in; JavaScript bundle export does not produce an installable app.

Acceptance before broader release: sign in with MFA, switch practice, check assigned-job isolation, queue a room and expense offline, restart the app, reconnect and verify exactly one record of each. Also check photo capture, denied permissions, and that workday location sharing stops after logout or practice switch. Do not discard an existing queue when upgrading a tester's app.

Reference: [Expo internal distribution](https://docs.expo.dev/build/internal-distribution/).
