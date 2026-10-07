# Email delivery recovery

Status: implemented and tested locally. Migration 0045, authenticated platform UI, live SMTP2GO responses and provider webhook activation have not been verified in staging.

## Worker states

| State | Meaning | Recovery |
| --- | --- | --- |
| queued | Available for a delivery attempt | Worker claims it when due |
| processing | Leased preparation; dispatch has not started | Expired current leases can retry; legacy claims require review |
| sending | Dispatch boundary persisted before the provider call | Expired leases require provider verification |
| delivery_unknown | Acceptance is unknown, partial or historically ambiguous | Platform support or a super administrator reviews evidence |
| completed | Provider acceptance recorded | Never automatically resent |
| failed | Retry allowance exhausted before dispatch or after verified rejection | Current attempts can be retried; legacy failures require review |

Claims carry a UUID attempt identifier and a five-minute lease. Provider calls are bounded to fifteen seconds. The worker stops taking new work after forty seconds, leaving time inside the queue route's sixty-second runtime. Completion updates the job, its own practice's linked delivery and the audit in one transaction.

A late response can complete its original uncertain attempt. A reviewed retry clears that attempt and receives a fresh UUID; a late worker cannot overwrite the new attempt.

## Review an uncertain send

1. Open Platform incidents and expand **Review provider evidence** for the job.
2. Check provider evidence for the displayed job and attempt identifiers. New sends include `X-Surveynt-Job-Id` and `X-Surveynt-Attempt-Id` custom headers. Legacy sends may require matching the original recipient, subject and time through the existing operational records.
3. Record acceptance only with a provider message identifier and an evidence reference. The job becomes completed without another send.
4. Queue another attempt only when provider evidence confirms no acceptance. Record the findings and confirm the review. A timeout, missing local response or absent record in an incomplete log is insufficient evidence.
5. Reload if the attempt changed during review. The server rejects stale decisions and restricts review to platform support and super administrators.

The application records provider acceptance here. Recipient delivery, rejection, bounce and suppression outcomes still require provider activation and verification; this implementation does not certify delivery to an inbox.

## Provider configuration references

The official [SMTP2GO send endpoint](https://developers.smtp2go.com/reference/send-standard-email) documents custom email headers. The [webhook overview](https://developers.smtp2go.com/docs/webhooks-overview) documents event types, identifiers, authentication and selected custom headers. Configure and verify those through the staging release process. The worker does not assume provider send idempotency.

No live emails were sent during the local regression tests. Do not resolve uncertain production deliveries based on simulated test outcomes.
