# Retail Operation Hub — Design

This document summarizes how the hub is structured, who uses it, and which product rules the implementation follows. Detailed Q&A lives in [`questions.md`](./questions.md).

## Purpose

An **offline-first retail operations** application: customers browse, reserve stock, check out, and pick up orders; staff process payments, verify pickup, and work ticket queues; administrators manage catalog, campaigns, moderation, rules, and audit visibility. External SaaS calls are out of scope—everything runs against a **local PostgreSQL** database.

## Architecture

| Layer | Stack | Location |
|-------|--------|----------|
| Frontend | Angular 18 (TypeScript), standalone components, route-level lazy loading | `repo/frontend` |
| Backend | Fastify 4 + Zod validation, Drizzle ORM | `repo/backend` |
| Database | PostgreSQL | migrations/schema under `repo/backend` |

The Angular app talks to the API over HTTP (CORS restricted to localhost and private LAN origins). Sessions use a **Bearer token** returned from login (see [`api-spec.md`](./api-spec.md)).

## Roles and surfaces

- **Customer** — catalog, cart (30-minute TTL, single active cart), orders, post-pickup reviews (with image limits and moderation), after-sales tickets, in-app notifications, loyalty points view.
- **Associate / supervisor / manager** — associate console: ticket queue, checkout/payment flows, pickup verification (including manager override after failed attempts).
- **Admin** (and **manager** where routes allow) — products, campaigns (A/B recommendation strategies per store/date range), banned terms, rules engine (versioning, publish, rollback), moderation queue, audit log (read-only), user management screens as exposed in the UI.

Route guards in `repo/frontend/src/app/app.routes.ts` enforce authentication and role access.

## Major flows

1. **Browse → cart → order** — Public product listing and detail; authenticated cart creation, line items, optional **pickup groups** (department staging) before checkout.
2. **Checkout and tender** — Staff-assisted payment; **mixed tender** (e.g. cash + card) with **local currency only**; rules engine participates in caps and eligibility (e.g. price adjustments per order).
3. **Pickup** — Verification via pickup code; lockout and **manager override** after repeated failures; timeline/audit captures failures and overrides.
4. **Reviews** — One original review per picked-up order; **one follow-up** within 14 days; multipart uploads (max 6 images, size/MIME/sha256 rules); offline moderation and appeals.
5. **After-sales tickets** — Created by customers on picked-up orders; triage, reassignment, resolution, and **timeline** for staff; departments map from ticket type.
6. **Campaigns & recommendations** — Admin-defined campaigns; **at most one overlapping active test per store per date range** for the recommendation panel on the catalog.

## Cross-cutting concerns

- **Audit logs** — Immutable append-only records for sensitive actions; rules rollback does not rewrite history.
- **Cart expiry** — Background job releases reservations and records expiration; expired carts do not resume.
- **Auth security** — Failed login tracking and time-based lockout; successful login clears the failure streak.
- **Health** — `GET /health` checks database connectivity and expected schema tables (used for ops/Docker).

## Documentation index

| File | Contents |
|------|-----------|
| [`design.md`](./design.md) | This overview |
| [`api-spec.md`](./api-spec.md) | HTTP API route map and conventions |
| [`questions.md`](./questions.md) | Resolved product/spec questions |

Implementation details and schemas are authoritative in `repo/backend/src` and `repo/frontend/src`.
