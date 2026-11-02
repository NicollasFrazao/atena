# Security policy

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub's
[private vulnerability reporting](https://github.com/NicollasFrazao/atena/security/advisories/new)
with:

- what an attacker can do (for example: read a full phone number or message content without
  `pii:reveal`, act without an audit entry, change an incident without the server-side validation,
  get the assistant to return data no tool produced, escalate a role);
- the requests, prompts or test that reproduce it;
- the commit you tested.

You can expect an acknowledgement within a week. Fixes are released on `master` and credited in the
advisory unless you prefer otherwise.

## Supported versions

Only the latest commit on `master` is supported.

## Scope

In scope: authentication (OIDC, the session cookie), RBAC and permissions, PII masking and the
reveal endpoints, the audit log, the incident lifecycle validation, the tool catalog and the
orchestrator's refusal, and the WebSocket handshake.

Known and documented, out of scope for reports: no central revocation of the stateless session
cookie before it expires, and no CSRF token beyond `SameSite` and the OIDC state/nonce/PKCE — see
[`.context/docs/tech-debt.md`](.context/docs/tech-debt.md), item 1, and
[`.context/docs/security.md`](.context/docs/security.md).
