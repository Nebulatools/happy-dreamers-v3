# NFR — Seguridad, Escala, Observabilidad, SLO

## Seguridad por diseño
- Secrets fuera del repo (Vercel env). Enforcer: typed env loader + check en build.
- CORS permitido solo a dominio de producción y previsualizaciones controladas.
- Rate-limiting a rutas públicas/clave (auth, assistant, webhooks).
- Validación Zod en **todas** las entradas. Sanitización y logs sin PII.
- Feature flags para endpoints de admin/debug (`ENABLE_DEBUG_ENDPOINTS=false` en prod).
- Webhooks: firmas HMAC validadas (Zoom **HEX**), idempotencia.

## Escalabilidad
- Pool Mongo: `maxPoolSize=10`, `minPoolSize=2`, `maxIdleTimeMS=30000`.
- Indexes en consultas críticas; agregados offline para analítica.
- Caching de respuestas del asistente por clave semántica + periodo (TTL corto).

## Observabilidad
- Pino + trazas; Sentry/OTel. Redactar PII. Correlación request/request-id.
- Tableros: p95, errores, RPS, plan-success-rate.

## Performance
- p95 <= 1.2s; cold start <= 1.8s. Presupuesto de bundle y `dynamic import` en UI.

## Testing
- P0 seguridad/ingesta/cálculo; mix Unit/Integration/E2E; contract tests webhooks.
