# API v1 (Next.js routes)

## Salud y utilidades
- GET `/api/healthz` → 200 + stats del pool/uptime/build SHA.

## Seguridad y administración
- GET `/api/users/debug` (ADMIN + `ENABLE_DEBUG_ENDPOINTS=true`) → listar usuarios truncados (sin PII).

## Children & Events (operacional)
- GET `/api/children/:id/events?from&to&type`
- POST `/api/children/:id/events` → crea bloque dormir/despertar/alimentación/medicamento/extra.
- PATCH `/api/children/:id/events/:eventId` → actualización parcial, idempotente.
- Validación Zod, rate limit, CORS estricto y logging de auditoría.

## Analytics
- POST `/api/analytics/rebuild` (ADMIN) → recalcular agregados para `events_analytics`.
- GET `/api/children/:id/sleep-metrics` → promedios por **noches reales** y **días con siesta**.

## Integraciones
- POST `/api/integrations/zoom/webhook` → valida `endpoint.url_validation` con HMACSHA256 HEX; eventos `Recording.completed`. :contentReference[oaicite:5]{index=5}
- POST `/api/rag/sync-drive` → sincroniza carpeta autorizada; check de conexión; **keys en .env con escapados**. :contentReference[oaicite:6]{index=6}
