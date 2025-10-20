# Seguridad Baseline

- `.env` tipado; verificación en build; **prohibido** commitear credenciales.
- CORS: allowlist estricta (prod + previews).
- Rate limiting (token bucket) → 429 con headers estándar.
- Sanitización de logs; sin PII en errores; IDs ofuscados para debug.
- Webhooks con firma + idempotencia; rechazar si reloj desfasado > 5 min.
- Headers: `Strict-Transport-Security`, `X-Content-Type-Options`, `Content-Security-Policy` mínimo.
