# Contributing

Thanks for taking the time. Atena handles PII and drives support decisions, so the bar is the five
non-negotiable principles (the AI only chooses tools, no fabricated data, incident changes are not
tools, everything sensitive is audited, PII masked by default) and code a reviewer can trust.

The full rules are in [`.context/docs/development-conventions.md`](.context/docs/development-conventions.md).
This page is the short version.

## Setup

```bash
nvm use 22                      # the CI runs on Node.js 22; the lint tooling needs it
npm ci                          # installs every workspace and the git hooks
make env                        # creates apps/api/.env from the template (never committed)
npm run build -w @atena/types   # the apps consume the contract from its build
npm run prisma:generate         # the Prisma client the API compiles against
```

`make up ENV=local` (or `make dev`) starts the API and MySQL in Docker; see the README.

## Branches

Branch from `master`, named by the kind of change:

| Prefix | For |
| --- | --- |
| `feat/` | a new capability |
| `fix/` | a defect |
| `docs/` | documentation only |
| `refactor/` | a structural change with no behaviour change |
| `chore/` | maintenance, dependencies |
| `test/` | tests only |
| `ci/` | workflows |

## Commits

[Conventional Commits](https://www.conventionalcommits.org/) in English, checked by commitlint in the
`commit-msg` hook and, in CI, on every commit of a pull request:

```
fix(incidents): reject resolve without escalated_to for escalations

The UI disabled the button, but the endpoint accepted the request, so
an escalation could be resolved without saying to whom. The service now
validates it and answers 422.

Closes #12
```

Scopes are the modules: `api`, `web`, `types`, `llm`, `chat`, `shippings`, `catalog`, `incidents`,
`detector`, `rules`, `auth`, `audit`, `admin`, `observability`, `db`, `make`, `context`, `deps`, `ci`.

**The commit type is the version**: `feat` → minor; `fix`, `perf`, `refactor` → patch; `!` after the
type or a `BREAKING CHANGE:` footer → major; `docs`, `test`, `build`, `ci`, `chore`, `style` → no
release.

## Before pushing: the local gate

Run these one at a time, from the root:

```bash
npm run lint                  # ESLint (type-aware, Sonar and TSDoc rules), any warning fails
npm run typecheck
npm run check:architecture    # layer rules and cycles
npm run check:unused          # unused files, exports, dependencies
npm run test:coverage         # Jest (API, 80% gate) and Vitest (web, coverage floor)
npm run test:tooling          # local ESLint rules and the context script
npm run e2e -w @atena/web     # Playwright, hermetic
npm run check:context         # agent surfaces in sync with .context/docs/README.md
```

They are the CI jobs. If they pass locally, CI passes. `make test-e2e` (real MySQL) is not in CI;
run it when you touch the database layer.

## Pull requests

- Small, one concern each. A refactor and a behaviour change are two pull requests.
- Fill in the template. Verification states **results** ("395/395 API tests, coverage
  94/83/89/94"), not "tested".
- Link the issue with an English closing keyword: `Closes #12`. Other words do not link.
- A change that touches PII, the audit log, RBAC, the incident lifecycle or the tool catalog needs a
  test that fails without it.

## Language

Code, comments, docs, commits, issues and pull requests are in English. The product's UI copy is in
Portuguese for its users and stays so.

## Repository settings (maintainers)

On GitHub:

- **Branch ruleset on `master`**: require a pull request; require the status checks `lint`,
  `typecheck`, `architecture`, `unused`, `test-api`, `test-web`, `e2e-web`, `tooling`, `audit`,
  `context`, `commitlint` and `CodeQL`; block force pushes; require linear history.
- **Code security**: enable secret scanning, push protection, Dependabot alerts and private
  vulnerability reporting (used by [SECURITY.md](SECURITY.md)).
