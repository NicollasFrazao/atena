## Description

<!-- What changes and why. If it fixes a defect, say what happened before. -->

## Issue

<!--
The keyword must be one GitHub recognizes: `Closes`, `Fixes` or `Resolves`
(or `closed` / `fixed` / `resolved`). Anything else is a plain mention, and the
issue stays open after the merge without anyone noticing.

Pasting the issue URL does not link it either. Use the number: `Closes #123`.

Check after opening, because the failure is silent:
  gh pr view <N> --json closingIssuesReferences
-->

Closes #

## Verification

<!-- Results, not "tested": "395/395 API tests, coverage 94/83/89/94; 12/12 Playwright". -->

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run check:architecture`
- [ ] `npm run check:unused`
- [ ] `npm run test:coverage`
- [ ] `npm run test:tooling`
- [ ] `npm run e2e -w @atena/web`
- [ ] `npm run check:context`

## Risks and caveats

<!--
What the review must look at closely, and what was left out on purpose.
If it touches PII, the audit log, RBAC, the incident lifecycle or the tool
catalog, say which of the five principles it affects and how the tests show
they still hold.
-->
