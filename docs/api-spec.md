# Retail Operation Hub — HTTP API

**Base URL:** `http://<host>:<port>` — default `PORT=3000` (see `repo/backend/src/index.ts`).

**JSON:** Unless noted, send `Content-Type: application/json` and expect JSON bodies.

**Auth:** After `POST /auth/login`, send `Authorization: Bearer <token>` on protected routes.

**Errors:** Structured error responses are produced by the Fastify error handler (`repo/backend/src/plugins/error-handler.ts`); status codes follow HTTP semantics (401/403/404/409, etc.).

---

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | DB connectivity + presence of expected tables; **503** if degraded |

---

## Auth (`/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | No | Body: `username`, `password` → `token`, `expiresAt`, `user` |
| POST | `/auth/logout` | Yes | End session |
| GET | `/auth/me` | Yes | Current user profile |

---

## Catalog (`/products`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/products/` | No | List active products (pagination, search, filters, sort) |
| GET | `/products/:id` | No | Product detail |

---

## Recommendations (`/recommendations`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/recommendations/` | No | Recommendation panel payload (campaign/strategy aware) |

---

## Cart (`/cart`)

All routes require authentication (customer).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/cart/` | Create active cart (30 min TTL; **409** if one already active) |
| GET | `/cart/` | Current cart with items and time remaining |
| POST | `/cart/items` | Add line item |
| PUT | `/cart/items/:id` | Update line quantity |
| DELETE | `/cart/items/:id` | Remove line |
| POST | `/cart/pickup-groups` | Create pickup group for an order |
| PUT | `/cart/items/:id/group` | Assign item to a pickup group |

---

## Orders (`/orders`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/orders/` | List orders (role-appropriate) |
| GET | `/orders/:id` | Order detail |
| POST | `/orders/` | Create order from cart / checkout flow |
| POST | `/orders/:id/tender` | Record tender / payment split |
| POST | `/orders/:id/confirm` | Confirm order step (state transition) |
| POST | `/orders/:id/pickup/verify` | Verify pickup code |
| POST | `/orders/:id/pickup/manager-override` | Manager override after failed verifications |

Exact bodies and transitions are defined by Zod schemas in `repo/backend/src/routes/orders.ts`.

---

## Reviews (`/reviews`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/reviews/` | Yes | Multipart: `body`, `orderId`, optional image files (max 6, size/MIME enforced) |
| POST | `/reviews/:id/followup` | Yes | Follow-up review (single per parent, 14-day window) |
| GET | `/reviews/?orderId=<uuid>` | Yes | List reviews for an order (customer: own orders only; staff: any) |

---

## Moderation (`/moderation`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/moderation/flags/:id/report` | Yes | Customer report flow |
| GET | `/moderation/appeals` | Staff | Appeals queue |
| PUT | `/moderation/appeals/:id/resolve` | Staff | Resolve appeal |

---

## After-sales tickets (`/tickets`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/tickets/` | Customer | Open ticket (`return` / `refund` / `price_adjustment`, etc.) |
| GET | `/tickets/` | Yes | List tickets (scoped by role) |
| GET | `/tickets/:id` | Yes | Ticket detail |
| POST | `/tickets/:id/checkin` | Staff | Check-in |
| POST | `/tickets/:id/triage` | Staff | Triage |
| POST | `/tickets/:id/reassign` | Staff | Reassign |
| POST | `/tickets/:id/interrupt` | Staff | Interrupt |
| POST | `/tickets/:id/resolve` | Staff | Resolve |
| GET | `/tickets/:id/timeline` | Yes | Timeline / audit-style events |

---

## Associate queue (`/associate`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/associate/tickets` | Associate+ | Paginated active ticket queue (`department` filter optional) |

---

## Notifications (`/notifications`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/notifications/` | Customer | List notifications |
| PUT | `/notifications/:id/read` | Customer | Mark read |

---

## Customers (`/customers`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/customers/:id/points` | Yes | Points / tier-style loyalty data (authorization rules in route) |

---

## Admin — products (`/admin/products`)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/admin/products/` | Admin | Create product |
| PUT | `/admin/products/:id` | Admin | Update product |
| DELETE | `/admin/products/:id` | Admin | Soft-delete / deactivate (see implementation) |

---

## Admin — campaigns (`/admin/campaigns`)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/admin/campaigns/` | Admin | List campaigns |
| POST | `/admin/campaigns/` | Admin | Create (overlap validation per store/date range) |
| PUT | `/admin/campaigns/:id` | Admin | Full update |
| DELETE | `/admin/campaigns/:id` | Admin | Deactivate |

---

## Admin — banned terms (`/admin/banned-terms`)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/admin/banned-terms/` | Admin | List |
| POST | `/admin/banned-terms/` | Admin | Create |
| DELETE | `/admin/banned-terms/:id` | Admin | Remove |

---

## Admin — rules (`/admin/rules`)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/admin/rules/` | Admin | List rules |
| GET | `/admin/rules/:id` | Admin | Rule detail |
| POST | `/admin/rules/` | Admin | Create draft |
| PUT | `/admin/rules/:id` | Admin | Update |
| POST | `/admin/rules/:id/publish` | Admin | Publish |
| POST | `/admin/rules/:id/rollback` | Admin | Rollback version |

---

## Admin — audit logs (`/admin/audit-logs`)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/admin/audit-logs/` | Admin/Manager | Read-only audit stream (query params per `audit-logs.ts`) |

---

## Multipart and limits

- Review image uploads use `@fastify/multipart` with a **6 file** max and per-file size default **5 MiB** (`MAX_IMAGE_SIZE_BYTES`).
- Field names and validation match `repo/backend/src/routes/reviews.ts`.

---

## OpenAPI

There is no generated OpenAPI artifact in-repo yet; **Zod schemas on each route** are the source of truth. To add OpenAPI later, generate from Fastify route schemas or export Zod to JSON Schema.
