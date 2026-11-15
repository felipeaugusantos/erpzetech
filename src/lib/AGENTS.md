# Offline sales

- Pin React, React DOM and the mounted-test renderer to the same release and pre-optimize Radix Slot/compose-refs; dependency installs must not introduce a separate hook runtime on lazy navigation.

- Sales offline queues persist before clearing the cart, retain idempotency keys/payment parameters and reconcile the latest queue after uploads so concurrent sales are not lost; rejected sales remain visible.
- Offline app-shell caching uses vite-plugin-pwa generateSW and one preview/dev/iframe-guarded registrar; navigations are NetworkFirst and API/OAuth responses are never cached.
- PDV uses user/tenant-scoped base caches and an idempotent sale wrapper that pins the original cash register, preserving existing stock and authorization checks.
