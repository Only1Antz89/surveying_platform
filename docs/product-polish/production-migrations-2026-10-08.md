# Production database migration — 8 October 2026

## Result

Production is migrated through `0074_questionnaire_answer_disposition`. All 75 journal entries (0000–0074) match the live ledger by SHA-256 and journal timestamp. The initial live ledger ended at 0031, rather than the historical 0025 record; 43 pending migrations were applied.

- Application commit: `ad79030ee37a7e430adede264e63780a82f77ca2`.
- Production deployment: `dpl_2u7USdiS9K96ej7KqMFw19kA3UjR`, READY.
- Previous production deployment: `dpl_34GhbSrJ7NVvVF2VkRqd6Ndq6kuM`, READY, commit `65f39c7ce366a96ea5db4ccbb6d023c23f045632`.
- Final verification: 8 October 2026, 11:32 UTC; subsequent scoped reads also passed.
- Production was identified using authenticated Vercel project/deployment metadata and its Neon integration endpoint. Sensitive database variables were not returned by environment pull; existing working administrator/runtime credentials matched that endpoint. No credentials or customer data are included here.

## Backup and recovery evidence

The user explicitly approved a private local copy of production customer and organisation data before migration. A PostgreSQL 18 full custom-format dump completed, with file permissions 0600. `pg_restore --list` successfully read its 1,020 archive entries.

- Private backup destination on the operator's Mac: `/private/tmp/surveynt-production-before-0074.dump`.
- Size: 119,265,963 bytes.
- SHA-256: `b05dc37357855498218bf64add620dfecd8a288f343729ca124b79f4fcb27b68`.

The backup is local; it has not been uploaded to Git, copied to durable managed storage, or test-restored. Keep it until a managed recovery point is confirmed. A Vercel application rollback does not reverse the database migrations. The prior application build's compatibility with the migrated production schema has not been accepted through authenticated browser scenarios.

## Migration execution

Drizzle executes all pending migrations in one transaction. Migration 0033 adds `manager` to the `organisation_role` enum; later SQL functions use that value. PostgreSQL rejects use of a newly added enum value before its transaction commits.

A disposable local PostgreSQL/PostGIS rehearsal reproduced this error in a combined 0032–0074 transaction. The two-stage sequence then passed, reaching 75 ledger entries. The local CLI could not directly connect to the TCP test database using its Neon WebSocket driver, so the SQL rehearsal used PostgreSQL directly with the same SQL files, hashes and transaction boundaries. Production execution used the normal repository CLI and Neon driver.

1. Ran `pnpm --filter @surveynt/db db:migrate --config /private/tmp/surveynt-migrate-enum.config.ts` against production with a temporary migration directory whose unchanged journal/files ended at 0033. Only pending 0032–0033 were applied. Verified all 34 ledger entries matched.
2. Ran `pnpm --filter @surveynt/db db:migrate` against production with the repository's full journal. Pending 0034–0074 were applied successfully.
3. Verified all 75 hashes and timestamps against the repository journal. Both commands used administrator credentials supplied through process environment, with a 15-second lock timeout and 120-second statement timeout.

No historical migration SQL or checksums were modified. For another database whose ledger precedes 0033, commit the enum addition before running later migrations that use it; a single combined migration command will fail.

## Read-only production verification

- Active reference metadata was identical before and after: one legacy active version, eight canonical active layers, and 23 source decisions. No dataset activation or geometry duplication occurred.
- The application role remains non-superuser and cannot bypass row security.
- Thirteen relevant tables are readable by the application role, with enabled and forced row security: user/member profiles, questionnaire drafts/links/submissions/documents, website enquiries/drafts/versions, manual payment reviews, invoice credits, retention holds and removal queue.
- All thirteen tables returned zero rows to an application connection with no tenant/user context.
- Two existing membership scopes each passed seven read-only application-role queries covering profiles, operational settings, website forms, questionnaires, invoice credits and retention removal records. No customer records were created or modified as test fixtures.
- Both migration 0074 questionnaire removal-fence triggers are present.

These checks establish migration installation and database access. Authenticated browser acceptance, provider activation and stakeholder sign-off remain separate release tasks. Staging acceptance and frequent calendar processing remain deferred under the user's plan-upgrade instruction. Original deletion was not enabled or exercised by this migration run.

## Applied migration checksums

| Migration | SHA-256 |
|---|---|
| `0032_stormy_boomerang` | `d96301932159f391466d60947788d122a59224289945a4c84aa6381d70470521` |
| `0033_blue_bloodaxe` | `34f043fd7c1042920d966f6618d1e6d9b719d3900a3796364d0a31ac926f2df7` |
| `0034_wooden_malice` | `ce71986d76aa07245b832b314046c6229ceb86f151cdbc8a556b67095e64a0f9` |
| `0035_worried_susan_delgado` | `23d8fbe0d7cc5242d83ad2931a2fe0f37203d3c3321d1a4d3c8301fea57ced03` |
| `0036_faithful_mulholland_black` | `29231880b5652984000610a61744ad20cf9e80c3254e8e5fd8be41baabc81ee2` |
| `0037_fancy_talos` | `d0065ea259942dbed4963c8b09209b9db490b2985f9f4e7b75b5835fcf8f390d` |
| `0038_messy_invisible_woman` | `fe25451a8e5bad623e01f6dd94cc4dfb5f3c3353770c42b5204f4ac3b0be4e92` |
| `0039_chubby_human_torch` | `094a40938025c52cadab2656de46a388b8bd92e41039812ae67f1a4edcd0f225` |
| `0040_website_forms` | `0debe1fd731b1e595d6f4cecb05265d5f86a348cd5647927ee4e99915735c9b8` |
| `0041_personal_professional_details` | `6bceda99b6dbecec84b93fc44d4e309d1e61a46069385d564416e1170175bef8` |
| `0042_manual_payment_reviews` | `e2446914ffc354cfe72a5d5d7f71de2161ef142f2a3454400141c32f377691ed` |
| `0043_invoice_credits` | `08dd4e248b7e26bb0c523bb2bebe0d807d75c7841dac876ad9b4923da5962527` |
| `0044_manual_deposit_reviews` | `7fde0efed5f7c98a4578524b0a93fdea618f53aace6bd0a70704373c64e97981` |
| `0045_email_delivery_leases` | `c68832f349ebc543dbfebc78bf56eb8023a15832c6a0e1f44cf962e892dd752a` |
| `0046_practice_email_templates` | `6b5248e9cfd6181f3555cb6daa20aa48afeb8677e4b317ccc576dce58a9f1ae9` |
| `0047_document_removal_state` | `785c8fb1457a703e6e692f141407eed487de7895b7e4917693e8113df0a6aba5` |
| `0048_document_removal_guards` | `bd84705d857f3aa17de5d7bba00e29f60a66c43c45125bd3fb63665e44e5f0a9` |
| `0049_account_profile_revision` | `4e356500cde6a5979a2faafc1daa9fc1658ec16952dc791723fc77bbdc52cfb8` |
| `0050_personal_account_audit` | `eadfec2e54cac96e9b1605daa849e268f69cc58e7095f07aab7447f5dc563660` |
| `0051_account_profile_image` | `31915b3d9046e3093a34f1c8cf16df101b32b193489b7b8b5735464904ca5086` |
| `0052_document_report_references` | `0ba0dd22cafd081c826ef0f4d68a27a5421410417519ea589967cbe3291025e9` |
| `0053_calendar_webhook_resource` | `18be6ff4d187228cde50f2b1eaf13c3b50f4821783052197c2a48129aa31fc3e` |
| `0054_calendar_webhook_attempt` | `33e61245adc6e60cb77209082a1da8c99c02a49556aca899ac873bf502b7e8bf` |
| `0055_survey_file_retention_policy` | `b9a0142cd9190116db17fae098c872022bb100ca771903a659dd6c095f5f2530` |
| `0056_job_retention_holds` | `338e84d1d679f2afdc5e2ad1f401173d121a71b54bc1b16e1fbd8d510f8e5da7` |
| `0057_survey_file_removal_queue` | `84b94f252724957f88fd16a4c8a2bb2e385f9a983d31dd551c863bc45773e8eb` |
| `0058_survey_file_job_fence` | `180ada50ea1fb2af7099bb8db3d40537b4353334584f9264770ed1e73f2c354f` |
| `0059_survey_file_preflight_cancellation` | `9d7cc8d5b0f8357bbd3fc2a3a43aa2dd2e0c802c7476f87a555a8238b1d7e7fa` |
| `0060_questionnaire_analysis_disposition` | `ec7df9d849aeabdd3a662f0ee65797728a999f71d1fe4820699a86226112a5ed` |
| `0061_questionnaire_disposition_delivery_holds` | `fe68b7664becfbd8a34d34f763e91baed48ac3d7d21957c00f59afc4e8326e0f` |
| `0062_media_analysis_disposition` | `71cdb3027f4cb13fa2d1fadda285d04083bca4269a23642512a68ef7a2e6d528` |
| `0063_proposal_value_reference_fence` | `5ed763d3b62f016e8a9fd0dbd06c39938ed3815e2f5a81a72c714e8f63fa6467` |
| `0064_adviser_task_disposition` | `a3d034bcd911a0046a75a3629a36950cadf088394085f6bf2acb4992ee288377` |
| `0065_field_proposal_disposition` | `792847cef653aac41828afdd3d2a896d2c5d62bc699a7ddfb23066888d40f347` |
| `0066_report_content_disposition` | `b5abec3fc6a818e81468ec6b912cbd524970e675e835873ca631aacc412fcb2d` |
| `0067_recorded_content_reference_fence` | `f117a02c34806284542a4284e7606a7c838fd643b29082561d7babb7d4763956` |
| `0068_recorded_field_value_disposition` | `ed89ccaba33f2909cb56153d0353cd38c6c67392102bf85204722a9094548663` |
| `0069_observation_content_disposition` | `0c99dce46ac8045f73085a67f4831810bc59fd30432cbf0349fe11c69ea1022e` |
| `0070_retained_sync_result_disposition` | `151ec74c49040271f1042fabcfc6c0f657194df136af5342aa9bf24d70cb9ba1` |
| `0071_element_content_disposition` | `584e8a3516e48026806a7965e3222f592adff38483c29cdb22ef2c8619ee404f` |
| `0072_media_metadata_disposition` | `02bd2f37231b2248173fdd51c92db1a4eba6fe85dbb27759fbc4c757d898b88d` |
| `0073_evidence_annotation_disposition` | `e56f76d6c08fc521571e6d226cb5e001fd21f9a619478cd2740ce1c985985205` |
| `0074_questionnaire_answer_disposition` | `3b1197827cd9ac7ceea7def00ba3ed2b6ed19c4c3a93216e4363e1de76efc8b8` |
