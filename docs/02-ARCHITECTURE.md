# Arquitectura

- Next.js (App Router) + TypeScript + MongoDB + Vercel.
- Capa Operacional de eventos (registro en tiempo real, UI) y Capa Analítica (agregados).
- Autenticación con NextAuth, RBAC simple, JWT.
- RAG para el asistente y pipelines de transcripción.

## Dualidad de eventos (resumen)
- Operacional: children.events[] (interacción y latencia baja).
- Analítica: colección eventsevents_analytics limpia, con childId: ObjectId, ventanas y agregados.  
  (Ver detalles en 03-DATA-MODEL.md)

## Integraciones
- Zoom Webhook (HMAC HEX).
- Google Drive RAG (Service Account, carpeta limitada).

## Referencias del repo original (para validación conceptual)
- Guía de componentes y módulo de eventos/estadísticas. :contentReference[oaicite:1]{index=1}
- Arquitectura del sistema de eventos (dualidad). :contentReference[oaicite:2]{index=2}
- Reglas de HMAC Zoom HEX para webhook. :contentReference[oaicite:3]{index=3}
- Corrección de métricas de sueño promedio por noche/siesta.
