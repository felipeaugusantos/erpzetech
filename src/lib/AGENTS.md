# Offline sales

- PDF imports use explicit collection dates first, falling back to report attendance dates for the exam date; conflicting dates require manual review. References stay on the exam snapshot and issuance is never inferred from exam, consultation, upload or validation dates, preserving source meaning. Patient charts reuse clinical RPCs and audited private attachment access.

- Consultation date corrections resolve through the clinical JSON helper; closed charts retain immutable dated addenda instead of changing original clinical content.
- Legacy subscription schema compatibility stays in one explicitly typed client adapter because older installations may retain tables absent from generated types; it never provisions or seeds billing data.

- Pin React, React DOM and the mounted-test renderer to the same release and pre-optimize Radix Slot/compose-refs; dependency installs must not introduce a separate hook runtime on lazy navigation.

- Sales offline queues persist before clearing the cart, retain idempotency keys/payment parameters and reconcile the latest queue after uploads so concurrent sales are not lost; rejected sales remain visible.
- Offline app-shell caching uses vite-plugin-pwa generateSW and one preview/dev/iframe-guarded registrar; navigations are NetworkFirst and API/OAuth responses are never cached.
- PDV uses user/tenant-scoped base caches and an idempotent sale wrapper that pins the original cash register, preserving existing stock and authorization checks. Select the operator's newest open register before the tenant-wide fallback, matching the server; version cached base data when changing register selection to discard stale offline selections.
