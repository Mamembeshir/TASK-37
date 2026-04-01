1. Pickup Code Verification

Question: What happens if a customer enters the wrong 6-digit pickup code 5 times?
Understanding/Hypothesis: The spec says “maximum 5 attempts before requiring manager override.” This likely means no automatic reset or bypass.
Solution / Confirmation: Implement offline manager override workflow. Confirmed solution: after 5 failed attempts, associate must enter manager credentials to complete pickup.

2. Split Orders Across Pickup Groups

Question: Can items in an order be moved between pickup groups?
Understanding/Hypothesis: Items are assigned by inventory staging; reassignment might complicate audit logs.
Solution / Confirmation: Confirmed that reassignment is allowed only before order fulfillment. Once staged for pickup, items cannot move between groups. Logs record any reassignment.

3. Refunds and Price Adjustments

Question: Is the $50 adjustment cap per order or per item?
Understanding/Hypothesis: The spec says “per order unless customer is top tier.”
Solution / Confirmation: Implement cap at order level. Confirmed with rules engine: sum of all adjustments in order cannot exceed $50 unless customer tier overrides.

4. Review Follow-Up

Question: Can a customer submit more than one follow-up review in 14 days?
Understanding/Hypothesis: Spec allows only “one follow-up review.”
Solution / Confirmation: Enforce exactly one follow-up; additional attempts blocked. Offline moderation triggers on follow-up submission.

5. A/B Recommendation Panel

Question: Can multiple A/B tests run concurrently on the same store?
Understanding/Hypothesis: Panel supports toggling ranking strategies per store/date range. Likely only one active test per store/date.
Solution / Confirmation: Implement single active test per store per date range. Confirmed that overlapping tests are blocked by UI and backend validation.

6. Sensitive Content Moderation

Question: How to handle false positives offline?
Understanding/Hypothesis: Moderation uses dictionaries and pattern rules; appeals queue exists.
Solution / Confirmation: Implement appeals queue with throttling. Confirmed: flagged content can be reviewed and approved offline by staff; changes logged immutably.

7. Cart Auto-Cancel

Question: What happens if cart expires after 30 minutes?
Understanding/Hypothesis: Cart auto-cancels and releases reserved stock.
Solution / Confirmation: Confirmed: user must start a new order; cart cannot resume. Logs record expiration timestamp.

8. Security Lockout

Question: Does the 15-minute lockout reset after successful login?
Understanding/Hypothesis: Likely yes; lockout is for consecutive failed attempts.
Solution / Confirmation: Implement failed attempt counter reset on successful login. Lockout persists only if failed attempts exceed threshold without successful login.

9. After-Sales Ticket Reassignment

Question: Can tickets move between departments mid-process?
Understanding/Hypothesis: Spec mentions triage and routing; reassignment seems allowed.
Solution / Confirmation: Confirmed: ticket reassignment allowed offline; timeline updated; audit logs capture old/new owner and timestamp.

10. Audit Logs

Question: Are logs editable?
Understanding/Hypothesis: Spec says “immutable,” except for rules rollback.
Solution / Confirmation: Implement immutable logs; no edits allowed. Confirmed: rollback affects rules, not historical logs.

11. Offline-Only Constraint

Question: Are internet-based services ever allowed?
Understanding/Hypothesis: Spec explicitly forbids external services.
Solution / Confirmation: All services, updates, and storage must operate locally. Confirmed: no internet calls in system design.

12. Coupons / Points / Tier Benefits

Question: How are conflicting rules resolved?
Understanding/Hypothesis: Rules engine uses priority, serial/parallel evaluation.
Solution / Confirmation: Implement priority-based evaluation; human-readable explanations generated for each decision. Confirmed offline-only execution.

13. Mixed Tender Payments

Question: Are foreign currencies allowed?
Understanding/Hypothesis: Spec only mentions cash + card; likely local currency only.
Solution / Confirmation: Confirmed: local currency only. Any foreign tender rejected.

14. Timeline View

Question: Do failed attempts or manager overrides appear in timeline?
Understanding/Hypothesis: Timeline shows node duration and owner.
Solution / Confirmation: Implement full audit in timeline, including failed pickups and overrides.

15. Maximum Images in Reviews

Question: Are images checked beyond type/size?
Understanding/Hypothesis: Spec mentions SHA-256 and MIME/type checks; offline moderation may also scan banned content.
Solution / Confirmation: Implement offline validation and moderation rules. Confirmed: only 6 images max; each ≤ 5MB; flagged images go to appeals queue.