# Project Rules and Guidelines

> Auto-generated from .context/docs on 2026-06-26T20:43:13.425Z

## README

# Documentation Index

Welcome to the repository knowledge base. Start with the project overview, then dive into specific guides as needed.

## Core Guides
- [Project Overview](../.context/docs/project-overview.md)
- [Architecture Notes](../.context/docs/architecture.md)
- [Development Workflow](../.context/docs/development-workflow.md)
- [Testing Strategy](../.context/docs/testing-strategy.md)
- [Glossary & Domain Concepts](../.context/docs/glossary.md)
- [Data Flow & Integrations](../.context/docs/data-flow.md)
- [Security & Compliance Notes](../.context/docs/security.md)
- [Tooling & Productivity Guide](../.context/docs/tooling.md)
- [Code Style](../.context/docs/code-style.md)
- [Tech Debt](../.context/docs/tech-debt.md)
- [Anomaly Scenarios](../.context/docs/anomaly-scenarios.md)

## Repository Snapshot
- `apps/api/` — backend NestJS 11 (Prisma/MySQL, motor DuckDB sobre S3)
- `apps/web/` — frontend React 18 + Vite
- `packages/types/` — `@atena/types` (contrato compartilhado)
- `docs/design_handoff_atena/` — handoff (referência histórica de design/contrato)

## Document Map
| Guide | File | Primary Inputs |
| --- | --- | --- |
| Project Overview | `project-overview.md` | Roadmap, README, stakeholder notes |
| Architecture Notes | `architecture.md` | ADRs, service boundaries, dependency graphs |
| Development Workflow | `development-workflow.md` | Branching rules, CI config, contributing guide |
| Testing Strategy | `testing-strategy.md` | Test configs, CI gates, known flaky suites |
| Glossary & Domain Concepts | `glossary.md` | Business terminology, user personas, domain rules |
| Data Flow & Integrations | `data-flow.md` | System diagrams, integration specs, queue topics |
| Security & Compliance Notes | `security.md` | Auth model, secrets management, compliance requirements |
| Tooling & Productivity Guide | `tooling.md` | CLI scripts, IDE configs, automation workflows |
| Code Style | `code-style.md` | Convenções de código (API, nomenclatura, formatação) |
| Tech Debt | `tech-debt.md` | Itens adiados/simplificados + frentes residuais |
| Anomaly Scenarios | `anomaly-scenarios.md` | Top-3 cenários + thresholds default das regras |

