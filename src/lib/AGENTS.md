# Offline sales

- Sales offline queues persist before clearing the cart, retain idempotency keys/payment parameters and reconcile the latest queue after uploads so concurrent sales are not lost; rejected sales remain visible.
- Offline app-shell caching uses vite-plugin-pwa generateSW and one preview/dev/iframe-guarded registrar; navigations are NetworkFirst and API/OAuth responses are never cached.
- PDV uses user/tenant-scoped base caches and an idempotent sale wrapper that pins the original cash register, preserving existing stock and authorization checks.
