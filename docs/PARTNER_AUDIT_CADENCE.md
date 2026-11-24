# Partner reconciliation and audit cadence proposal

Status: proposed for maintainer approval (W10-DOC-016, issue #1215).

## Basis and scope

Issue #1215 reports weekly reconciliation and monthly attestation in `docs.md`
sections 4.3 and 11.5, a monthly independent accounting audit in section 13.3,
and monthly reconciliation with a quarterly audit in section 22.1.

The referenced specification and partner contract template are not present in
the checked `dev` tree. This proposal provides consistent wording for review;
it does not reconstruct those documents or claim to amend an existing agreement.
The section descriptions below come from the issue, not an inspection of the
unavailable specification.

## Proposed common schedule

| Activity | Cadence | Alignment rationale |
| --- | --- | --- |
| Partner reconciliation | Weekly | Retains the protocol cadence reported for sections 4.3 and 11.5. |
| Attestation | Monthly | Retains the attestation cadence reported for sections 4.3 and 11.5. |
| Independent accounting audit | Monthly | Retains the independent audit cadence reported for section 13.3. |

This choice aligns partner requirements with the protocol requirements quoted
in the issue. It is a proposed resolution, not evidence that the maintainers or
partners have approved these obligations. Attestation and independent accounting
audit remain separate activities even though both have a monthly cadence.

## Common wording for the specification

> Partner reconciliation is performed weekly. Attestation is performed monthly.
> An independent accounting audit is performed monthly. Partner requirements use
> the same reconciliation, attestation, and independent accounting audit cadences
> as the protocol's operational description.

### Section alignment map

| Source location reported in #1215 | Proposed update when source is supplied |
| --- | --- |
| `docs.md` section 4.3 | Retain weekly reconciliation and monthly attestation; reference the common schedule for the independent accounting audit. |
| `docs.md` section 11.5 | Retain weekly reconciliation and monthly attestation; use the same terminology as section 4.3. |
| `docs.md` section 13.3 | Retain the monthly independent accounting audit; distinguish it from monthly attestation. |
| `docs.md` section 22.1 | Replace monthly reconciliation with weekly reconciliation and quarterly audit with monthly independent accounting audit; include monthly attestation. |
| Partner contract template | Align the cadence clause with the common schedule using the proposed wording below, subject to review of the full template. |

## Proposed partner contract cadence clause

For integration into the actual template after maintainer review:

> The partner requirements are weekly reconciliation, monthly attestation, and
> a monthly independent accounting audit, aligned with the protocol's operational
> requirements. Monthly attestation and the monthly independent accounting audit
> are separate requirements.

This is a cadence clause only. The actual template must identify the responsible
parties and preserve the agreed scope, reporting obligations, and other terms.
No deadlines, evidence-retention periods, or contractual remedies are inferred
from the issue.

## Maintainer integration checklist

- [ ] Confirm or revise the proposed weekly/monthly/monthly schedule.
- [ ] Supply the authoritative specification and partner template paths and revisions.
- [ ] Apply the section alignment map to all four specification sections and the
      actual partner contract template, preserving their surrounding context.
- [ ] Confirm the responsible parties, reporting periods, completion deadlines,
      and recipients in the authoritative documents rather than assuming them.
- [ ] Review the complete documents for conflicting monthly reconciliation or
      quarterly audit requirements, and align any remaining references.
- [ ] Confirm specification and partner wording match before approving adoption;
      record the approved source revisions and update this proposal's status.

Until that integration is complete, the source-document contradiction remains
unverified. This documentation change does not add or change a backend scheduler,
perform an audit, or establish that existing partner agreements have changed.
