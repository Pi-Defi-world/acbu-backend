# Credential Rotation Attestation (W11-INC-002)

## Purpose

This record is for the incident lead to collect a separate attestation from every engineer, maintainer, and service owner who may have opened the repository while the malicious `.vscode/tasks.json` folder-open task was present.

A repository change cannot revoke credentials held by GitHub, npm, AWS, cloud providers, identity providers, or browser sessions. The affected credentials must be revoked or rotated in those provider consoles by an authorized owner. Do not treat this document or a checked box as proof that a provider-side action occurred: retain the provider audit event or ticket reference.

## Required response

1. Stop using potentially affected workstations for credential administration. Perform recovery from a trusted, clean device.
2. Preserve incident evidence and coordinate the response with the security/incident lead. Do not execute the suspected loader again.
3. Revoke active GitHub personal access tokens, fine-grained tokens, OAuth/app sessions, and any deploy keys that may have been exposed. Replace only the credentials still required.
4. Revoke and recreate npm automation/access tokens; review npm account sessions, 2FA, package access, and publishing activity.
5. Rotate AWS access keys and other cloud credentials, revoke active sessions where supported, and review IAM users, roles, access-key creation, and CloudTrail activity.
6. Rotate affected SSH keys and remove old public keys from GitHub, servers, CI, and deployment systems. Review authorized_keys and known deployment hosts.
7. Revoke relevant browser and identity-provider sessions, refresh tokens, and API keys that were accessible from the affected user profile.
8. Review provider audit logs from the earliest suspected exposure through completion. Escalate unexplained access, token creation, key changes, package publication, or deployment activity.
9. Confirm that the malicious editor task and any related persistence have been removed from the affected checkout and workstation before resuming development.

## Per-person attestation

Complete one copy per person in the organization's approved private incident tracker. Do not commit names, email addresses, credential values, token IDs, private-key material, screenshots containing secrets, or provider audit exports to this repository.

- **Incident reference:** W11-INC-002
- **Attesting team member:** [record in private incident tracker]
- **Completion date (UTC):** [YYYY-MM-DD]
- **Affected workstation(s):** [asset reference only]
- **Trusted recovery device used:** [yes/no; record details privately]
- **GitHub tokens and sessions reviewed/revoked:** [yes/no/not applicable]
- **GitHub deploy keys reviewed/rotated:** [yes/no/not applicable]
- **npm tokens and sessions reviewed/revoked:** [yes/no/not applicable]
- **SSH keys reviewed/rotated:** [yes/no/not applicable]
- **AWS/cloud credentials and sessions reviewed/rotated:** [yes/no/not applicable]
- **Browser/identity sessions and refresh tokens revoked:** [yes/no/not applicable]
- **Provider audit logs reviewed:** [yes/no; date range]
- **Exceptions or outstanding actions:** [none or private ticket reference]
- **Evidence/ticket references:** [provider event IDs or private ticket references only]

**Attestation statement**

I confirm that I have completed the applicable credential review and revocation/rotation actions listed above, reviewed the relevant provider activity to the extent of my access, and recorded any exception or outstanding action with the incident lead. I have not included secret values in this attestation.

- **Attested by:** [name/signature in private tracker]
- **Date/time (UTC):** [timestamp]
- **Reviewed by incident lead:** [name/signature in private tracker]
- **Review date/time (UTC):** [timestamp]

## Incident lead closure checklist

- [ ] Every in-scope team member and service owner is accounted for.
- [ ] Every person has submitted an attestation in the private incident tracker.
- [ ] GitHub tokens, sessions, deploy keys, and organization access were reviewed.
- [ ] npm tokens, account sessions, package permissions, and publish history were reviewed.
- [ ] AWS/cloud credentials, active sessions, IAM changes, and audit logs were reviewed.
- [ ] SSH keys and deployment-host access were reviewed.
- [ ] Browser/identity sessions and other accessible API credentials were revoked or rotated.
- [ ] Exceptions have an owner, due date, and tracked remediation ticket.
- [ ] The incident lead has reviewed the evidence and formally recorded closure.

## Handling and retention

Keep individual attestations and provider evidence in the organization's access-controlled incident-management system. This repository contains only the procedure and blank template. Never store active secrets or sensitive credential metadata here.
