# Surveynt Fieldwork companion

Expo companion for assigned jobs, navigation, site capture and explicit workday location sharing. Uses native background location; Expo Go cannot verify the required behaviour.

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

## Site capture and offline queue

"Capture on site" on a job opens the survey outline for that job (it must already be started in the workspace). For each inspectable element the surveyor can:

- set the inspection status (inspected, not inspected, inaccessible, not applicable; a reason is required when not inspected);
- take photos with the camera, tagged to the element;
- save a site note, recorded as a current observation.

Rooms with dimensions and time on site can also be recorded. Field answers and report wording stay in the full survey workspace.

Every action is written to the device first: a JSON queue per practice and user in the app's document directory, and photos copied out of the camera cache. The queue syncs on launch, on returning to the app and after each capture, in order, stopping at the first connection problem.

- **Retries:** survey changes carry operation ids and photos carry client ids, so retries are not applied twice.
- **Errors:** if the server refuses an item (validation or permission), it stays on the device marked for attention and can be discarded. Sign-in, rate-limit and server errors are retried.
- **Rooms:** a room sent just before a connection drops may be sent again; remove the duplicate in the survey workspace.

Server endpoints: `GET /api/mobile/jobs/:id/capture`, `POST /api/mobile/surveys/:id/sync` (status, notes and photo links only), `POST /api/mobile/surveys/:id/media`, `POST /api/mobile/surveys/:id/rooms` and `POST /api/mobile/jobs/:id/costs`. All use the same mobile token, assignment checks and recording permission as the existing mobile routes.

Photo upload needs the practice's storage to be configured; until then photos stay queued on the device with the storage message.

Verify on physical devices:

- camera permission prompts and denial;
- capture with no signal, then sync on reconnection;
- app restarts with a non-empty queue;
- switching practice, which keeps queues separate;
- large photos on mobile data.

