# Retail Operations Hub - Development Plan

---

## Phase 1: Bootstrap & Database

### 1.1 Monorepo Setup
- [x] 1. Initialize monorepo root with `package.json` (workspaces: /frontend, /backend, /shared)
- [x] 2. Create `/backend`, `/frontend`, `/shared` directory structure
- [x] 3. Set up root `tsconfig.json` with path aliases for shared package
- [x] 4. Add `.gitignore` for node_modules, dist, .env files
- [x] 5. Initialize `/backend` as a Fastify + TypeScript project (tsconfig, package.json)
- [x] 6. Initialize `/shared` as a TypeScript library (shared types, Zod schemas)
- [x] 7. Configure Drizzle ORM in `/backend` with PostgreSQL adapter
- [x] 8. Create `.env.example` with DB connection vars (no secrets committed)

### 1.2 Database Schema — Core Tables
- [x] 9. Create Drizzle schema: `users` (id, username, password_hash, role, failed_attempts, locked_until)
- [x] 10. Create Drizzle schema: `audit_logs` (id, actor_id, action, entity_type, entity_id, before, after, node_duration_ms, created_at)
- [x] 11. Create Drizzle schema: `products` (id, name, description, brand, price, stock_qty, category, is_active)
- [x] 12. Create Drizzle schema: `carts` (id, customer_id, expires_at, status) + `cart_items` (id, cart_id, product_id, qty, reserved_at)
- [x] 13. Create Drizzle schema: `orders` (id, customer_id, status, pickup_code, pickup_attempts, created_at) + `order_items`
- [x] 14. Create Drizzle schema: `pickup_groups` (id, order_id, department, status) + `pickup_group_items`
- [x] 15. Create Drizzle schema: `tender_splits` (id, order_id, method, amount, reference)
- [x] 16. Create Drizzle schema: `reviews` (id, order_id, customer_id, body, is_followup, parent_review_id, submitted_at) + `review_images`
- [x] 17. Create Drizzle schema: `after_sales_tickets` (id, order_id, customer_id, type, status, department, assigned_to, created_at)
- [x] 18. Create Drizzle schema: `ticket_events` (id, ticket_id, actor_id, event_type, note, from_dept, to_dept, created_at)
- [x] 19. Create Drizzle schema: `notifications` (id, customer_id, message, is_read, created_at)
- [x] 20. Create Drizzle schema: `rules` (id, name, version, status, definition_json, created_by, admin_comment, published_at) + `rules_history`
- [x] 21. Create Drizzle schema: `campaigns` (id, store_id, variant, strategy, start_date, end_date, is_active)
- [x] 22. Create Drizzle schema: `moderation_flags` (id, entity_type, entity_id, reason, status, reported_by, created_at) + `moderation_appeals`
- [x] 23. Create Drizzle schema: `image_hashes` (id, sha256, flagged_at, flagged_by)
- [x] 24. Create Drizzle schema: `banned_terms` (id, term, pattern, is_regex, created_by, created_at)
- [x] 25. Write and run initial migration with Drizzle Kit

### 1.3 Backend Scaffolding
- [x] 26. Set up Fastify server with TypeScript, register plugins (multipart, cors restricted to local)
- [x] 27. Create global error handler and request logger (writes to audit_logs)
- [x] 28. Set up Zod-based request validation plugin for Fastify
- [x] 29. Verify server starts and connects to PostgreSQL; confirm all tables exist

---

## Phase 2: Authentication & Security

### 2.1 Auth Endpoints
- [x] 30. `POST /auth/login` — validate credentials with bcrypt, return session token
- [x] 31. Implement failed-attempt counter: increment on failure, lock account for 15 min after 5 fails
- [x] 32. Implement lockout check: reject login if `locked_until > now()`
- [x] 33. Reset failed-attempt counter to 0 on successful login
- [x] 34. `POST /auth/logout` — invalidate session token
- [x] 35. `GET /auth/me` — return current user profile (phone masked in staff views)

### 2.2 RBAC Middleware
- [x] 36. Define roles: `customer`, `associate`, `supervisor`, `manager`, `admin`
- [x] 37. Create `requireAuth` Fastify hook (validates session token on every protected route)
- [x] 38. Create `requireRole(...roles)` hook for role-gated routes
- [x] 39. Mask customer phone numbers in all staff-facing API responses

### 2.3 Secrets & Encryption
- [x] 40. Implement AES-256 encrypt/decrypt helpers for sensitive notes at rest
- [x] 41. Apply encryption to sensitive `ticket_events.note` and `users` sensitive fields
- [x] 42. Enforce minimum password length of 10 characters in Zod schema

---

## Phase 3: Catalog & Search

### 3.1 Product Endpoints
- [x] 43. `GET /products` — list with pagination, filter by brand, price range, availability
- [x] 44. `GET /products/:id` — single product detail
- [x] 45. Implement full-text search on product name + description using PostgreSQL `tsvector`
- [x] 46. Add sorting: price asc/desc, name asc/desc, availability
- [x] 47. `POST /admin/products` — create product (admin only)
- [x] 48. `PUT /admin/products/:id` — update product (admin only)
- [x] 49. `DELETE /admin/products/:id` — soft delete (set `is_active = false`)
- [x] 50. Write audit log entry for every product create/update/delete

### 3.2 Recommendation Panel
- [x] 51. `GET /recommendations` — return ranked product list based on active strategy for store
- [x] 52. Implement ranking strategies: popularity, price-asc, price-desc, newest, manual
- [x] 53. `GET /admin/campaigns` — list campaigns with active A/B test info
- [x] 54. `POST /admin/campaigns` — create A/B test variant (store_id, strategy, start_date, end_date)
- [x] 55. Validate no overlapping active campaign for same store + date range (backend + Zod)
- [x] 56. `PUT /admin/campaigns/:id` — update campaign
- [x] 57. `DELETE /admin/campaigns/:id` — deactivate campaign
- [x] 58. Expose active campaign metadata so frontend can display: "Test A active for MM/DD/YYYY–MM/DD/YYYY"

---

## Phase 4: Cart & Ordering

### 4.1 Cart Management
- [x] 59. `POST /cart` — create cart for customer, set `expires_at = now() + 30 min`
- [x] 60. `POST /cart/items` — add item to cart, reserve stock (decrement `products.stock_qty`)
- [x] 61. `PUT /cart/items/:id` — update qty in cart, adjust reservation
- [x] 62. `DELETE /cart/items/:id` — remove item, release reservation
- [x] 63. `GET /cart` — view current cart with items and expiry countdown
- [x] 64. Implement background job (Fastify scheduler or pg cron) to auto-cancel expired carts, release stock, write audit log

### 4.2 Pickup Groups
- [x] 65. `POST /cart/pickup-groups` — create a new pickup group for an order (assign department)
- [x] 66. `PUT /cart/items/:id/group` — assign cart item to pickup group (only before fulfillment)
- [x] 67. Validate item-to-group reassignment is blocked once order is staged for pickup
- [x] 68. Write audit log on every pickup group assignment change

### 4.3 Order Placement
- [x] 69. `POST /orders` — convert cart to order, validate stock, generate 6-digit pickup code
- [x] 70. Enforce pickup code uniqueness; store as hashed value in DB
- [x] 71. Handle out-of-stock at order time: auto-reassign item to another pickup group or cancel item with mandatory reason code
- [x] 72. `GET /orders` — list customer's own orders
- [x] 73. `GET /orders/:id` — order detail with pickup groups, items, tender splits
- [x] 74. Write audit log on order creation

### 4.4 Tender Splits (Payment)
- [x] 75. `POST /orders/:id/tender` — record tender split (method: cash | card, amount, reference)
- [x] 76. Validate total tender splits equal order total (Zod + backend rule)
- [x] 77. Reject non-local-currency tender (confirmed: local currency only)
- [x] 78. Write audit log on payment recording

---

## Phase 5: Pickup Code Verification

- [x] 79. `POST /orders/:id/pickup/verify` — associate submits customer's 6-digit code
- [x] 80. Compare submitted code against stored hash; return success or failure
- [x] 81. Increment `orders.pickup_attempts` on each failure; write audit log per attempt
- [x] 82. Block further attempts after 5 failures; return `locked` status
- [x] 83. `POST /orders/:id/pickup/manager-override` — manager submits own credentials to complete pickup (role: manager)
- [x] 84. Write audit log on manager override including manager actor ID and timestamp
- [x] 85. On successful pickup: update order status to `picked_up`, record in timeline

---

## Phase 6: Reviews & Moderation

### 6.1 Review Submission
- [x] 86. `POST /reviews` — submit review (body text, up to 6 images, linked to order)
- [x] 87. Enforce max 6 images per review in Zod schema and backend validation
- [x] 88. Validate image MIME type (JPG/PNG only) and file size (≤ 5 MB each)
- [x] 89. Compute SHA-256 hash of each uploaded image; reject if hash matches `image_hashes` flagged list
- [x] 90. `POST /reviews/:id/followup` — submit one follow-up review within 14 days of original
- [x] 91. Enforce: exactly one follow-up per original review, within 14-day window
- [x] 92. `GET /reviews?orderId=` — list reviews for an order

### 6.2 Offline Content Moderation
- [x] 93. On review submit: scan body text against `banned_terms` table (exact match + regex patterns)
- [x] 94. On follow-up submit: also run moderation scan
- [x] 95. Auto-flag review if banned term or pattern matched; insert into `moderation_flags`
- [x] 96. Store flagged image SHA-256 in `image_hashes` to block re-upload
- [x] 97. Write audit log on every moderation flag created

### 6.3 Moderation Appeals
- [x] 98. `POST /moderation/flags/:id/report` — customer reports content (max 5 reports/user/day enforced)
- [x] 99. `GET /moderation/appeals` — staff view of pending appeals queue (associate/supervisor only)
- [x] 100. `PUT /moderation/appeals/:id/resolve` — staff approves or rejects appeal; writes audit log
- [x] 101. `GET /admin/banned-terms` — list banned terms/patterns
- [x] 102. `POST /admin/banned-terms` — add banned term or regex pattern
- [x] 103. `DELETE /admin/banned-terms/:id` — remove banned term; write audit log

---

## Phase 7: After-Sales Tickets

### 7.1 Ticket Lifecycle
- [x] 104. `POST /tickets` — customer opens ticket (type: return | refund | price_adjustment; linked to order)
- [x] 105. Validate refund/return window: default 30 days; manager can extend to 60 days
- [x] 106. Validate price adjustment: require attached receipt reference, cap sum at $50/order (rules engine checks tier override)
- [x] 107. `GET /tickets` — customer views own tickets with status
- [x] 108. `GET /tickets/:id` — ticket detail with full event timeline
- [x] 109. Write audit log on ticket creation

### 7.2 Associate Exam Workflow Console
- [x] 110. `GET /associate/tickets` — queue of tickets assigned to associate's department
- [x] 111. `POST /tickets/:id/checkin` — associate checks in return at counter; timestamps node start
- [x] 112. `POST /tickets/:id/triage` — associate submits triage answers; backend routes ticket to correct department
- [x] 113. Implement routing logic: return → fulfillment; refund → accounting; price_adjustment → front desk
- [x] 114. `POST /tickets/:id/reassign` — reassign ticket to different department (supervisor only); write audit log with old/new owner
- [x] 115. `POST /tickets/:id/interrupt` — flag ticket for re-inspection (interruption/retest handling)
- [x] 116. `POST /tickets/:id/resolve` — close ticket with outcome (approved | rejected | adjusted); write audit log
- [x] 117. Timeline endpoint: `GET /tickets/:id/timeline` — return all events with actor, timestamps, node_duration_ms

### 7.3 Customer Notifications
- [x] 118. On ticket status change: insert row into `notifications` for customer
- [x] 119. `GET /notifications` — customer retrieves own unread notifications
- [x] 120. `PUT /notifications/:id/read` — mark notification as read
- [x] 121. No email/SMS — all notifications are in-app only

---

## Phase 8: Rules Engine

### 8.1 Rule Storage & Versioning
- [x] 122. Define rule definition JSON schema in `/shared` (conditions, actions, priority, grouping, evaluation_mode: serial | parallel)
- [x] 123. `GET /admin/rules` — list all rule sets with version and status
- [x] 124. `GET /admin/rules/:id` — get rule detail including full definition JSON
- [x] 125. `POST /admin/rules` — create new rule set (requires admin_comment)
- [x] 126. `PUT /admin/rules/:id` — update rule, auto-increment version, save old version to `rules_history`, require admin_comment
- [x] 127. `POST /admin/rules/:id/publish` — publish a rule version (set status = active)
- [x] 128. `POST /admin/rules/:id/rollback` — one-click rollback to previous published version; require admin_comment; write audit log

### 8.2 Rule Evaluation Engine
- [x] 129. Implement rule evaluator in `/backend/src/rules-engine/` — load active rules from DB
- [x] 130. Support conditional expressions (field comparisons, AND/OR logic)
- [x] 131. Support allowlists/denylists in rule conditions
- [x] 132. Support thresholds (numeric comparisons, caps)
- [x] 133. Implement serial evaluation: stop at first match if configured
- [x] 134. Implement parallel evaluation: collect all matches
- [x] 135. Implement priority ordering of rules within a group
- [x] 136. Generate human-readable hit explanation for each matched rule
- [x] 137. Apply rules engine to: coupon validation, points calculation, tier benefit checks, price adjustment cap, moderation decisions

### 8.3 Tier & Points
- [x] 138. Define customer tier levels (standard, silver, gold, top) in rules
- [x] 139. Apply tier-based override for $50 price adjustment cap (top tier bypasses)
- [x] 140. Apply tier-based points multipliers via rules engine
- [x] 141. `GET /customers/:id/points` — return customer points balance and tier

---

## Phase 9: Audit Logs

- [x] 142. Centralize audit log writer as a shared service in `/backend/src/audit.ts`
- [x] 143. Ensure every state-changing endpoint calls `writeAuditLog()` with actor, action, entity, before, after values
- [x] 144. Record `node_duration_ms` for all ticket workflow nodes (checkin → triage → resolve)
- [x] 145. `GET /admin/audit-logs` — paginated log viewer (admin/supervisor only), filter by entity_type, actor, date range
- [x] 146. Enforce no UPDATE or DELETE on `audit_logs` table at DB level (revoke privileges in migration)
- [x] 147. Verify immutability: add DB trigger to prevent modifications to `audit_logs`

---

## Backend Cleanup (Pre-Frontend)
- [x] Fix TypeScript TS2353 statusCode error — add `sendError()` helper in `lib/reply.ts`
- [x] Remove task-reference and step-by-step comments from all route files
- [x] Modularize mega files: extract `lib/tickets.ts`, `lib/pickup.ts` from routes
- [x] Fix all TypeScript compile errors (0 errors on `tsc --noEmit`)
- [x] Fix tsconfig to resolve `@retail-hub/shared` from shared workspace package

---

## Phase 10: Angular Frontend — Shell & Auth

### 10.1 Project Setup
- [x] 148. Initialize Angular 18 app in `/frontend` with standalone components and signals
- [x] 149. Install and configure TailwindCSS
- [x] 150. Set up Angular Router with lazy-loaded route modules
- [x] 151. Create `ApiService` using `HttpClient` pointed at local backend URL (configurable via environment.ts)
- [x] 152. Create `AuthService` with login/logout/me using signals for reactive state
- [x] 153. Create `AuthGuard` and `RoleGuard` for route protection

### 10.2 Auth UI
- [x] 154. Build `LoginComponent` — username/password form, show lockout message if locked
- [x] 155. Build `NavbarComponent` — show current user, role badge, logout button
- [x] 156. Handle 401 responses globally: redirect to login

---

## Phase 11: Angular Frontend — Catalog & Recommendations

- [x] 157. Build `CatalogComponent` — product grid with search bar, filter panel (brand, price, availability), sort controls
- [x] 158. Implement full-text search input with debounce (signals-based)
- [x] 159. Build `ProductCardComponent` — name, price, brand, availability badge
- [x] 160. Build `ProductDetailComponent` — full details, add-to-cart button
- [x] 161. Build `RecommendationPanelComponent` — ranked product list, show active A/B test banner if applicable
- [x] 162. Display A/B test status clearly: "Test A active for MM/DD/YYYY–MM/DD/YYYY"
- [x] 163. Build `AdminCampaignComponent` — create/edit/deactivate campaigns, overlap validation feedback

---

## Phase 12: Angular Frontend — Cart & Checkout

- [x] 164. Build `CartComponent` — list cart items, qty controls, expiry countdown timer (signals)
- [x] 165. Auto-navigate to catalog when cart expires (timer reaches zero)
- [x] 166. Build `PickupGroupEditorComponent` — assign items to pickup groups by department
- [x] 167. Build `CheckoutComponent` — review order, enter tender splits (cash + card reference)
- [x] 168. Validate tender splits sum to total before submitting
- [x] 169. On order success: display 6-digit pickup code prominently, offer print button
- [x] 170. Build `PrintPickupCodeComponent` — print-friendly view of pickup code (inline in CartComponent)

---

## Phase 13: Angular Frontend — Pickup Verification (Associate)

- [x] 171. Build `PickupVerifyComponent` (associate view) — enter order ID, submit customer's 6-digit code
- [x] 172. Show attempt count and remaining attempts (max 5)
- [x] 173. On lockout: show manager override form (manager credentials required)
- [x] 174. On success: show pickup confirmed screen with timestamp

---

## Phase 14: Angular Frontend — Reviews

- [x] 175. Build `ReviewFormComponent` — text field, image upload (max 6, JPG/PNG, ≤ 5 MB each)
- [x] 176. Show client-side validation errors for image type/size before upload
- [x] 177. Build `ReviewListComponent` — list reviews for an order with images
- [x] 178. Build `FollowUpReviewComponent` — follow-up form shown only within 14-day window if no follow-up yet submitted
- [x] 179. Show moderation status on review (pending | approved | flagged)

---

## Phase 15: Angular Frontend — After-Sales & Notifications

- [x] 180. Build `TicketFormComponent` — open ticket (type selector, order reference, receipt reference for price adjustments)
- [x] 181. Build `TicketListComponent` — customer's ticket list with status badges
- [x] 182. Build `TicketDetailComponent` — ticket detail with full event timeline (actor, timestamps, node durations)
- [x] 183. Build `NotificationBellComponent` — badge count, dropdown of unread notifications, mark-as-read
- [x] 184. Build `AssociateConsoleComponent` — ticket queue, triage form with guided questions, routing feedback
- [x] 185. Build `TicketTimelineComponent` — visual timeline with node duration, current owner highlight
- [x] 186. Show interrupt/retest status in timeline

---

## Phase 16: Angular Frontend — Admin Panels

- [x] 187. Build `AdminProductsComponent` — CRUD for products, soft delete with confirmation
- [x] 188. Build `AdminRulesComponent` — list rule sets, version history, publish/rollback buttons with comment modal
- [x] 189. Build `AdminBannedTermsComponent` — list, add, remove banned terms and regex patterns
- [x] 190. Build `AdminModerationQueueComponent` — appeals queue, approve/reject with audit trail
- [x] 191. Build `AdminAuditLogViewerComponent` — paginated log table with filters (entity, actor, date)
- [x] 192. Build `AdminUserManagementComponent` — list users, assign roles, reset lockouts

---

## Phase 17: Integration, Hardening & Offline Verification

### Testing Infrastructure (prerequisite)
- [x] Vitest + @vitest/coverage-v8 configured for backend (node env) and frontend (jsdom)
- [x] vitest.workspace.ts at monorepo root; pnpm test / test:ci / test:coverage scripts wired
- [x] backend/src/test/db.ts — test DB helper (runMigrations, clearAllTables, closeDb)
- [x] backend/src/test/helpers.ts — seed helpers (seedUser, seedProduct)
- [x] backend/src/test/app.ts — minimal Fastify test app factory (buildAuthTestApp, buildProductTestApp, buildCartTestApp, buildOrderTestApp)
- [x] backend/src/test/helpers.ts — extended with seedCart, seedCartItem, seedOrder, seedOrderWithCode, seedOrderItem, seedTenderSplit
- [x] .env.test.example with DATABASE_TEST_URL, SESSION_SECRET, ENCRYPTION_KEY
- [x] Sample tests: evaluator.test.ts (20 unit tests, all green), auth-token.spec.ts (6 tests, all green)

### Frontend Unit Tests — AuthService + LoginComponent (57 new tests, 63 frontend total — all green)
- [x] setup.ts — added `import '@angular/compiler'` to enable JIT fallback for Angular packages in Vitest jsdom; enables importing Router/ActivatedRoute/etc. without platform bootstrap
- [x] Testing strategy: `vi.mock('@angular/core', ...)` replaces `inject` with a spy while keeping real `signal`/`computed` — lets service/component logic be tested as plain class instances with mocked deps, no TestBed or @analogjs/vitest-angular required
- [x] src/app/core/services/auth.service.spec.ts (37) — unit tests for AuthService:
    - Initial state: currentUser=null, isLoggedIn=false, role=null, isStaff=false, token=null (localStorage empty)
    - login(): calls api.post with credentials, saves token, sets currentUser signal, isLoggedIn→true, returns user, throws on 401 (no state change), throws on 423 (no state change), never saves token on failure
    - logout(): clears localStorage token, sets currentUser=null, navigates to /login, still clears+navigates when server returns 500, skips API call when no token stored
    - loadCurrentUser(): no-op without token, calls GET /auth/me, sets currentUser on success, clears token+currentUser on API error
    - hasRole(): false when logged out, true for exact match, false for mismatch, true when role in multi-role list
    - Computed signals: role() tracks currentUser, isStaff() false for customer/true for associate/true for admin, all reset after logout (isLoggedIn/role/isStaff/currentUser all falsy)
- [x] src/app/features/auth/login/login.component.spec.ts (20) — unit tests for LoginComponent:
    - Initial state: loading=false, errorMessage=null, lockoutMessage=null, username='', password=''
    - submit() success: calls auth.login with username+password, navigates to / by default, navigates to returnUrl queryParam when present, loading=false after, errorMessage+lockoutMessage remain null
    - submit() 401: errorMessage='Invalid username or password.', lockoutMessage=null, loading=false, no navigation
    - submit() 423: lockoutMessage contains '15 minutes' + 'too many failed attempts', errorMessage=null, loading=false
    - submit() network error: errorMessage contains 'Unable to connect' for status 0 and 500, lockoutMessage=null
    - Loading guard: ignores submit() when loading=true (auth.login not called)
    - State cleanup: previous errorMessage cleared before next attempt, previous lockoutMessage cleared, both cleared even when next attempt also fails

### Frontend Unit Tests — CatalogComponent + ProductCardComponent (76 new tests, 139 frontend total — all green)
- [x] Extended mock strategy: also mocking `effect` from `@angular/core` via `vi.hoisted()` — captures the reactive callback so loadProducts() can be triggered manually in tests without Angular's reactive system; enables testing of async load flows
- [x] src/app/features/catalog/catalog.component.spec.ts (63) — unit tests for CatalogComponent:
    - Initial state (11): all filter signals empty/false/default, loading=true, products=[], total=0
    - hasFilters() computed (7): false initially, true for searchQuery/brand/minPrice/maxPrice/available, false after clearFilters
    - Filter handlers (6): onBrandChange/onMinPriceChange/onMaxPriceChange/onAvailableChange/onSortChange each set signal + reset offset to 0, brand trims whitespace
    - Search debounce (6): onSearchInput immediately sets searchRaw; searchQuery NOT updated before 350ms; updated after 350ms; whitespace trimmed; rapid inputs reset timer (350ms from LAST input); offset reset when debounce fires
    - clearFilters() (8): resets all filter signals (searchRaw/searchQuery/brand/minPriceRaw/maxPriceRaw/available/offset), cancels pending debounce so late-firing timer does not set searchQuery
    - Pagination (9): nextPage increments offset by 20 (multiple times), prevPage decrements offset, prevPage no-ops at 0, currentPage 1 or 2 from offset, pageCount from total (0→1, 20→1, 21→2)
    - loadProducts via effect (16): loading=true sync on call, loading=false+products+total set after flushPromises, error path sets products=[]+total=0+loading=false, passes searchQuery/brand/available/sortBy/offset/limit=20 to ProductService, parses minPrice as float, q/minPrice pass undefined when empty
- [x] src/app/features/catalog/product-card.component.spec.ts (13) — unit tests for ProductCardComponent:
    - addToCart() (4): calls cart.addToCart with product.id, works for out-of-stock products (template handles disabled), works when different product is loading
    - addingProductId signal (3): null initially, disabled condition true when signal matches product.id, false when different product loading
    - Stock availability (4): in-stock stockQty>0, out-of-stock stockQty=0, disabled condition true for out-of-stock, false for in-stock with no loading
    - Product input (4): name/price/brand accessible, product can be swapped by reassigning input

### Frontend Unit Tests — TicketDetailComponent + TicketTimelineComponent (112 new tests, 435 frontend total — all green)
- [x] src/app/features/tickets/ticket-detail.component.spec.ts (44) — unit tests for TicketDetailComponent:
    - Initial state (4): ticketId='', ticket=null, loading=true, loadError=null
    - ngOnInit() (4): sets ticketId from route param, '' when param=null, calls ticketSvc.get, ticketId set synchronously before load
    - load() success (3): sets ticket signal, loading→false, loadError stays null
    - load() 404 error (3): loadError='Ticket not found.', loading→false, ticket stays null
    - load() other errors (3): loadError='Could not load ticket.' for 500/403, loading→false
    - typeLabel() (4): return/refund/price_adjustment/unknown passthrough
    - statusLabel() (6): open/in_progress/pending_inspection/resolved/cancelled/unknown passthrough
    - statusBadge() (6): amber for open, sky for in_progress, violet for pending_inspection, emerald for resolved, zinc for cancelled, matches TICKET_STATUS_BADGE
    - outcomeBadge() (4): emerald/red/amber for approved/rejected/adjusted, matches TICKET_OUTCOME_BADGE
    - deptLabel() (5): front_desk/fulfillment/returns/warehouse/unknown passthrough
    - formatDate() (2): non-empty string, contains year
    - formatDuration exposed (5): null→'', 0→'', 30s, 1m, 1h
- [x] src/app/features/tickets/ticket-timeline.component.spec.ts (68) — unit tests for TicketTimelineComponent:
    - No inject() — instantiated as plain class, @Input properties set directly (no mock needed)
    - @Input defaults (2): assignedToId=null, ticketStatus=''
    - isActiveNode() (8): true for last+open/in_progress/pending_inspection; false when not last; false for resolved/cancelled/empty status
    - nodeClass() (5): returns EVENT_TYPE_COLOR base for event type, appends scale-110 for active node, no scale-110 for non-active, 'created' fallback for unknown type, active node class includes base+scale-110
    - activePing() (5): interrupted→red-500, checked_in→sky-500, triaged→violet-500, other→zinc-500, created→zinc-500
    - label() (6): checked_in/resolved/triaged/reassigned/interrupted → correct labels; unknown passthrough
    - icon() (5): checked_in/resolved/reassigned path, unknown→'created' fallback, created→own path
    - deptLabel() (6): front_desk/fulfillment/returns/warehouse/accounting/unknown passthrough
    - time() (2): non-empty string, different inputs give different outputs
    - dur (formatDuration) (7): null→'', 0→'', 30s, 1m 30s, 1h, 1h 30m, 1m (no trailing 0s)
    - Events ordering (4): array order preserved, empty array valid state, single event at [0], same array reference
    - Status changes — full lifecycle (6): active for open/in_progress/pending_inspection; NOT active for resolved/cancelled; earlier events never active even in open status
    - Node durations (4): null→'', 45s, 2h, 2m 5s from event.nodeDurationMs
    - Department transitions (3): fromDept/toDept accessible on reassign events, deptLabel renders both, null fromDept/toDept leaves event without transition

### Frontend Unit Tests — ReviewFormComponent (68 new tests, 323 frontend total — all green)
- [x] src/app/features/reviews/review-form.component.spec.ts (68) — unit tests for ReviewFormComponent:
    - Initial state (8): submitting=false, apiError=null, selectedFiles=[], previews=[], validationErrors=[], bodyText='', isDragging=false, MAX_IMAGES=6
    - onDragOver() (2): calls event.preventDefault(), sets isDragging=true
    - MIME type validation (6): accepts JPEG/PNG, rejects PDF/GIF/WebP, error message contains "must be JPEG or PNG"
    - Size validation (5): accepts file at 5 MB boundary, rejects 1 byte over, error message contains size in MB + "max 5 MB", accepts 100 KB file
    - Max 6 images cap (5): accepts exactly 6, trims batch of 7 to 6, no-op when at capacity, fills remaining slots when partially full, no validationErrors when capacity-sliced (silently dropped)
    - Mixed valid+invalid (4): adds only valid files, records errors only for invalid, replaces previous validationErrors on new pick, no files added when all invalid
    - Preview URL management (4): calls URL.createObjectURL per valid file, stores blob: URL in previews, previews and selectedFiles stay same length, no createObjectURL called for invalid files
    - onDrop() (4): calls event.preventDefault(), sets isDragging=false, adds dropped files to selectedFiles, handles empty drop without error (plain-object mock — jsdom has no DragEvent constructor)
    - removeFile() (6): removes file at index, removes preview at index, calls URL.revokeObjectURL with correct preview, does not revoke other URLs, keeps files at other indices, empty result after removing only file
    - submit() guards (3): no-op for empty body, no-op for whitespace-only body, no-op when submitting=true
    - submit() success (10): calls reviewSvc.submit with orderId/trimmed body/files, calls toast.success, clears bodyText/selectedFiles/previews/validationErrors, emits returned review via submitted output, resets submitting, clears prior apiError before attempt
    - submit() error (5): sets apiError from API error message, fallback apiError when no message, resets submitting, no submitted emit, no toast.success
    - formatBytes() (5): <1KB→"X B", <1MB→"X.X KB", ≥1MB→"X.X MB", 5MB→"5.0 MB", 0→"0 B"

### Frontend Unit Tests — CartComponent + CheckoutComponent (118 new tests, 255 frontend total — all green)
- [x] src/app/features/cart/cart.component.spec.ts (68) — unit tests for CartComponent:
    - Initial state (8): loading=true, cart=null, countdown=0, placingOrder=false, updatingItemId=null, deletingItemId=null, pickupCode=null, orderId=null
    - ngOnInit/loadCart (6): sets cart from getCart(), loading→false, loading false on null cart, countdown set from secondsRemaining>0, no countdown when secondsRemaining=0, no countdown when cart null
    - lineTotal() (3): price×qty to 2dp, single-unit, fractional price
    - total computed (3): 0.00 when null, sums line totals, updates when cart changes
    - isWarning computed (4): false at 0, false at ≥300, true at 299, true at 60
    - isCritical computed (4): false at 0, false at ≥60, true at 59, true at 1
    - countdownLabel computed (5): 90→"1:30", 65→"1:05", 0→"0:00", 1800→"30:00", 59→"0:59"
    - changeQty() (8): calls updateQty with id+qty, no-op for qty<1, no-op for qty=0, no-op for negative, no-op when updatingItemId matches, updates cart on success, no-op when returns false, clears updatingItemId after, other items unchanged
    - removeItem() (6): calls removeItem with id, no-op when deletingItemId matches, removes from signal on success, keeps others, no-op when returns false, clears deletingItemId after
    - placeOrder() (7): calls cartSvc.placeOrder, no-op when placingOrder, sets pickupCode, sets orderId, clears cart signal, no-op when result null, resets placingOrder after
    - Countdown timer (8): decrements 1/s, reaches 0, clears cart on expiry, calls toast.warning on expiry, navigates /catalog on expiry, no timer when 0s, stops on ngOnDestroy
- [x] src/app/features/orders/checkout.component.spec.ts (50) — unit tests for CheckoutComponent:
    - Initial state (7): loading=true, order=null, error=null, addingTender=false, confirming=false, tenderError=null, tender={method:cash,amount:'',reference:''}
    - ngOnInit() (7): calls getOrder with route id param, sets order on success, loading→false, error set when id=null, loading false when id=null, error set when getOrder throws, loading false when throws
    - activeItems computed (4): [] when null, includes items with cancelledAt=null, excludes cancelled items, all-cancelled→[]
    - orderTotal computed (3): 0.00 when null, sums qty×unitPrice for active items, excludes cancelled items
    - tenderTotal computed (2): 0.00 when no splits, sums split amounts
    - balanceCents computed (3): positive when underpaid, zero when exact, negative when overpaid
    - lineTotal() (2): qty×price, fractional prices
    - addTender() validation (8): empty amount, zero amount, negative, non-numeric, card+no-reference, card+whitespace reference, no API call on invalid, clears error before each attempt
    - addTender() success (7): cash payload, card payload with reference, appends split to order signal, resets form, clears tenderError, resets addingTender, calls toast.success
    - addTender() API error (3): sets tenderError from API message, fallback message, resets addingTender
    - confirmOrder() (7): calls confirmOrder when balanced, no-op when unbalanced, no-op when confirming, resets confirming after, toast.success, toast.error on failure, resets confirming on error
    - onMethodChange() (2): clears reference when switching to cash, keeps reference for card

### Product Catalog Tests (76 tests, all green)
- [x] src/routes/products.test.ts (76) — integration tests via Fastify inject() + real PostgreSQL test DB:
    - GET /products response shape: envelope, field types, price=string, createdAt=ISO-8601, empty results
    - isActive filter: soft-deleted products excluded; all-inactive = empty; isActive always true in response
    - Pagination: limit/offset, total reflects full match count (not page), offset beyond total, limit 1/100, 400 on 0/-1/101, negative offset
    - Sorting: name_asc (default), name_desc, price_asc, price_desc, availability; invalid sortBy → 400
    - Brand filter: exact/case-sensitive match, no results for unknown brand, total reflects filter
    - Price range: minPrice (gte), maxPrice (lte), inclusive boundaries, impossible range → 200+empty, minPrice=0, negatives → 400
    - available=true: stockQty > 0 only; available=false: no stock filter; invalid value → 400
    - Full-text search (q): name match, description match, English stemming, multi-word AND logic, no results, empty → 400, >200 chars → 400, whitespace-only → 400, combined with brand/available, relevance ordering (higher freq = first result)
    - Combined filters: brand+available, brand+price range, all four filters, no-match combinations
    - GET /products/:id: full fields, price string, 404 for inactive, 404 for unknown UUID, 400 for non-UUID, internal fields excluded
    - Edge cases: null description/brand/category, stockQty=0 visible without available=true

### Authentication Tests (122 tests, all green)
- [x] src/lib/mask.test.ts (24) — maskPhone, phoneForViewer, toUserView: null handling, all 5 staff roles, sensitive field exclusion
- [x] src/lib/roles.test.ts (13) — isAtLeast full privilege ladder, hasRole exact membership, isStaff all roles
- [x] src/routes/auth.test.ts (65) — integration tests via Fastify inject() + real test DB:
    - POST /auth/login: happy path, token shape, expiresAt, session creation, audit log
    - Validation: password < 10 chars, empty username, missing fields → 400
    - Wrong credentials: 401 with identical error (no user enumeration)
    - Lockout: failedAttempts increments 1→5, lockedUntil set on 5th fail, 423 while locked
    - Locked user rejected even with correct password (lockout checked before bcrypt)
    - Counter reset to 0 on successful login; auth.counter_reset audit log
    - POST /auth/logout: session deletion, double-logout, token unusable after logout
    - GET /auth/me: field safety (no passwordHash/failedAttempts/lockedUntil), expired session
    - requireAuth: 401 without token, 401 for deleted token, req.user populated
    - requireRole: customer/associate/supervisor blocked from manager-only routes (403 not 401); unauthenticated → 401

### Cart Tests (43 tests, all green)
- [x] src/routes/cart.test.ts (43) — integration tests via Fastify inject() + real PostgreSQL test DB + unit tests for runExpireCartsJob:
    - POST /cart: 201 shape, expiresAt ≈30min, 401 unauthenticated, 409 duplicate active cart, two customers each get their own cart
    - GET /cart: 401 unauthenticated, 404 no active cart, 200 with empty items + positive secondsRemaining, 200 with items (productName+price), secondsRemaining=0 when expiresAt past
    - POST /cart/items: 401 unauthenticated, 404 no active cart, 201+stock decremented, 409 duplicate product, 409 insufficient stock (stock unchanged), 409 inactive product, 410 expired cart, 400 qty<1, 400 non-UUID productId
    - PUT /cart/items/:id: 401 unauthenticated, 404 item not found, 200 increase qty (stock decremented by delta), 200 decrease qty (stock released), 200 same qty (no stock change), 403 other user's item, 409 insufficient stock, 400 non-UUID id, 400 qty=0
    - DELETE /cart/items/:id: 401 unauthenticated, 404 item not found, 200+stock released+item gone, 403 other user's item, 410 expired cart, 400 non-UUID id
    - runExpireCartsJob unit tests: no-op on no carts, non-expired cart untouched, status→expired, stock restored for all items, audit log (action=cart.expired, actorId=null, before/after), multiple carts in one run, idempotent (second run = no-op, no duplicate log), mixed expired+active (only expired flipped)

### Order Tests (73 tests, all green)
- [x] src/lib/pickup.test.ts (11) — unit tests for pickup helpers:
    - collapsePickupGroups: empty input, single group no items, single group with item, multiple rows → one group (collapsed), multiple groups, null assignedAt skipped
    - generateUniquePickupCode: 6-digit string, SHA-256 index matches, bcrypt hash verifiable, successive calls differ, collision detection (pre-occupied code skipped)
- [x] src/routes/orders.test.ts (62) — integration tests via Fastify inject() + real PostgreSQL test DB:
    - POST /orders: 401 unauth, 404 no cart, 410 expired cart, 400 empty cart, 201 shape (id/status/items), 201 pickupCode=6digits, 201 cart→converted, 201 audit log, 201 pickupCode not in GET response, 201 inactive items cancelled+stock released, 409 all items inactive
    - GET /orders: 401 unauth, 200 empty list, 200 shape (data/total/limit/offset), 200 own orders only, 200 pagination (limit+offset), no pickupCode in list
    - GET /orders/:id: 401 unauth, 404, 403 other customer, 200 full detail (items/groups/splits), 200 staff sees any order, 400 non-UUID, tender splits included
    - POST /orders/:id/tender: 401 unauth, 403 customer role, 404, 201 cash, 201 card+reference, 201 audit log, 400 card no reference, 400 cash with reference, 400 amount=0, 400 foreign currency, 400 USD accepted, 409 picked_up, 409 cancelled
    - POST /orders/:id/confirm: 401 unauth, 403 customer, 404, 409 not pending, 422 no splits, 422 total mismatch, 200 confirmed+audit log, 200 split tender (cash+card)
    - POST /orders/:id/pickup/verify: 401 unauth, 403 customer, 404, 409 not ready_for_pickup, 400 non-6-digit code, 200 correct code→picked_up, 200 correct code→audit log, 200 wrong code→attempts++, 200 5th wrong→pickup_locked, 423 already locked
    - POST /orders/:id/pickup/manager-override: 401 unauth, 404, 409 not locked, 401 wrong password, 403 not manager role, 423 manager account locked, 200 manager→picked_up+audit log, 200 admin credentials also work

### Review & Moderation Tests (107 tests, all green)
- [x] src/lib/moderation.test.ts (8) — unit + integration tests for runModerationScan:
    - no banned terms → review stays pending; no match → stays pending; exact term match → flagged; one flag inserted for review body; one flag per image when flagged; audit logs written (actorId=null); regex pattern match → flagged; inactive terms skipped; invalid regex skipped without throw
- [x] src/routes/reviews.test.ts (18) — integration tests via Fastify inject() + multipart bodies + real PostgreSQL test DB:
    - POST /reviews: 401 unauth, 400 missing body, 400 missing orderId, 404 order not found, 403 other customer's order, 409 not picked_up, 409 review already exists, 201 correct shape (no images), 201 JPEG image attachment, 400 unsupported MIME (gif), 400 wrong magic bytes (PNG bytes as JPEG), 400 SHA-256 blocklisted image, 201 flagged after moderation scan (response=pending, DB=flagged)
    - POST /reviews/:id/followup: 401, 404, 403, 400 follow-up of follow-up, 409 already exists, 201 correct shape (isFollowup=true, parentReviewId set)
    - GET /reviews: 401, 400 missing orderId, 404, 403 other customer, 200 empty, 200 with reviews+images, 200 staff any order, 200 original+followup both returned
- [x] src/routes/moderation.test.ts (18) — integration tests via Fastify inject() + real PostgreSQL test DB:
    - POST /moderation/flags/:id/report: 401, 400 invalid body, 201 user_report flag shape, 409 duplicate same entity same day, 429 over 5/day limit, 201 review_image entity type
    - GET /moderation/appeals: 401, 403 customer, 200 empty, 200 pending appeals with embedded flag, resolved appeals excluded, 200 supervisor access
    - PUT /moderation/appeals/:id/resolve: 401, 403 customer, 404, 409 already resolved, approved→review.moderationStatus=approved, rejected→flag.status=resolved_rejected, rejected review_image→SHA-256 added to blocklist, approved image→no blocklist, response includes embedded flag with updated status

### Rules Engine Tests (58 new tests, 429 total — all green)
- [x] src/rules-engine/index.test.ts (34) — DB-integrated evaluateRules + helpers:
    - loading: draft/inactive/rolled_back rules skipped; active rule matches; no-match when condition false; match shape (ruleId, ruleName, version, actions, explanation)
    - group filter: options.group restricts to matching group; empty for unknown group
    - priority ordering: lower priority number returned before higher (task 135)
    - serial mode (task 133): stops after first match per group; evaluates fallback when first doesn't match
    - parallel mode (task 134): collects all matches in group
    - complex conditions: AND group (all leaves), tier-based price cap override (SPEC use case — block vs override_cap)
    - hasAction: true when action present; false when absent; false for empty
    - getAction: returns first matching action with params; undefined when absent
    - summariseMatches: "No rules matched." for empty; pipe-joined explanations; single explanation
- [x] src/routes/admin/rules.test.ts (24) — integration tests via Fastify inject() + real PostgreSQL:
    - GET /admin/rules: 401, 403 non-admin (all roles), 200 paginated shape, limit/offset respected, items are summaries (no definitionJson)
    - GET /admin/rules/:id: 401, 403, 404, 200 with definitionJson, 400 non-UUID
    - POST /admin/rules: 401, 403, 400 missing adminComment, 400 invalid definitionJson, 201 draft+version=1+createdBy, 409 duplicate name
    - PUT /admin/rules/:id: 401, 404, 200 version incremented, history snapshot created (version archived), active→draft demotion, 409 name conflict, 400 missing adminComment
    - POST /admin/rules/:id/publish: 401, 404, 409 already active, 200 status=active+publishedAt, 200 rolled_back→active
    - POST /admin/rules/:id/rollback: 401, 403, 404, 409 no history, 200 restores def+version+1+adminComment, archives current as rolled_back, writes audit log (actorId=admin), 400 missing adminComment

### After-Sales Ticket Tests (89 new tests, 518 total — all green)
- [x] src/lib/tickets.test.ts (11) — unit tests for ticket helpers:
    - DEPT_BY_TYPE: return→fulfillment, refund→accounting, price_adjustment→front_desk
    - appendTicketEvent: first event nodeDurationMs=null, second event positive duration, encrypted note (raw contains iv:tag:cipher colons, decryptNullable round-trips), null note stored as null
    - notifyTicketStatusChange: inserts notification row for customer (entityType=ticket, entityId=ticketId, isRead=false), message contains newStatus
    - toTicketOut: all required fields serialised correctly (null assignedTo/receiptReference/outcome/resolvedAt, windowDays=30), resolvedAt as ISO string when set
- [x] src/routes/tickets.test.ts (45) — integration tests via Fastify inject() + real PostgreSQL:
    - POST /tickets: 401 (valid body, no token), 403 associate, 404 order not found, 403 other customer's order, 409 not picked_up status, 400 price_adjustment missing receiptReference, 409 duplicate open ticket, 201 return→fulfillment dept, 201 refund→accounting dept, 201 price_adjustment→front_desk+receiptReference, audit log written
    - GET /tickets: 401, 403 non-customer, 200 own tickets only (other customer excluded), pagination
    - GET /tickets/:id: 401, 404, 403 other customer, 200 with empty events array, 200 staff can view any, 200 event notes decrypted
    - POST /tickets/:id/checkin: 401, 403 customer, 404, 409 not open, 200 status=in_progress+assignedTo+event created+notification sent
    - POST /tickets/:id/triage: 401, 403 customer, 409 not in_progress, 200 DEPT_BY_TYPE routing (return→fulfillment), 200 dept override, fromDept/toDept in event
    - POST /tickets/:id/reassign: 403 associate, 409 terminal ticket, 409 same dept, 200 dept+assignedTo updated+audit log
    - POST /tickets/:id/interrupt: 403 customer, 409 not in_progress, 200 pending_inspection+event+notification
    - POST /tickets/:id/resolve: 403 customer, 409 bad status, 400 adjusted without amount, 200 from in_progress, 200 from pending_inspection, audit log+notification, 422 rules engine block ($50 cap exceeded)
    - GET /tickets/:id/timeline: 401, 404, 403 other customer, 200 empty array, 200 ordered events with correct shape, 200 nodeDurationMs computed after real checkin+triage, 200 staff can view any timeline
- [x] src/routes/associate.test.ts (11) — integration tests for GET /associate/tickets:
    - 401 unauth, 403 customer role, 200 empty, 200 active non-terminal tickets (open+in_progress included), cancelled excluded, department filter (fulfillment only), 400 invalid department, pagination (limit/offset), supervisor access, manager access, correct response shape, pending_inspection included
- [x] src/routes/notifications.test.ts (13) — integration tests for notification routes:
    - GET /notifications: 401, 200 empty, 200 own unread, read notifications excluded, other user's excluded, correct shape (id/customerId/message/entityType/entityId/isRead/createdAt), staff can access own
    - PUT /notifications/:id/read: 401, 404 missing, 403 other user's, 200 isRead=true+correct shape, idempotent on already-read, GET excludes it after marking read
