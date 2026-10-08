# Integration ownership and navigation

- Surveynt administrators (platform `super_admin`) see platform integration prerequisites at `/platform/tenants`, the main Customer accounts page. Its separate readiness API rejects ordinary firm members and non-administrator platform staff. National source operations retain their existing dedicated, audited source administration screen; credentials remain deployment-managed, never entered into customer-facing pages.
- Firm owners/administrators activate client payments in Settings → Operations after the existing secure-provider and legal/accounting launch gates. Managers retain operational settings but cannot change payment activation, including by direct API request; their saves omit the payment field to avoid overwriting a concurrent administrator change.
- Every active organisation membership has Your account → Calendar connections for their own Google/Microsoft OAuth identity. Connections remain scoped to the authenticated member and organisation. A provider account already connected to someone else cannot be taken over. Live OAuth remains blocked in demo organisations and non-writable workspaces.
- Calendar → Availability no longer renders platform readiness. It retains scheduling/closure/conflict tools and links to personal calendar settings.
- Fieldwork planner is a primary left-hand destination at the existing `/app/[organisationSlug]/routes` URL, not duplicated beneath Calendar. Existing finance-role route restrictions are unchanged.

Local verification: permission-policy and mocked API checks cover administrator-only platform readiness, personal calendar access across membership roles, and demo isolation. The web unit suite, targeted lint, TypeScript and production build were run. Browser checks confirm platform placement, personal Google/Microsoft cards, removal from Calendar and the independent Fieldwork planner navigation.

No migrations, credential provisioning, live provider calls, production publication or deployment were performed. Real-authentication/database and OAuth-provider smoke tests remain necessary before release.

## Personal account completion

- Profile and Security are separate destinations. Signed-in profile edits use Clerk; security stays provider-managed. Local preview profile, report identity and personal preferences persist only on the current device and are labelled accordingly.
- Professional details include self-declared drone operator/flyer references, qualification and expiry. Additive migration `0041_personal_professional_details.sql` must be applied before releasing authenticated profile reads; it has not been applied by this implementation.
- Personal calendar connections support ownership-filtered status, sync and disconnect. The local preview provides explicitly simulated connections and sync timestamps without contacting providers. Live Google/Microsoft OAuth still requires configured applications, encryption keys and provider smoke tests. Disconnect retains external events and cached busy periods.
- Browser alerts require explicit user permission and account-scoped device opt-in. Permission-filtered operational events generate generic lock-screen text while Surveynt is open. Test and disable controls are provided. Closed-application delivery is not implemented: it requires a separately configured background push service.
- Local checks cover profile/professional save-and-reload, separate account tabs, calendar setup/simulation and notification readiness at desktop and 390px widths. Browser permission was not granted automatically. Actual notification delivery, live Clerk edits, OAuth and database/RLS integration remain release checks.
