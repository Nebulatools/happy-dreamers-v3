# Datos y Esquemas

## Principales
- `users` {_id, email, role, createdAt, ...}
- `children` {_id, parentId, firstName, birthDate, plan, ...}
- `events` (analítico limpio)
  - {_id, childId: **ObjectId**, type, startTime, endTime?, meta{...}}
  - Subevento `night_wake` dentro del bloque de sueño nocturno (enlazado por `parentEventId`).
- `plans` {_id, childId, targets, from, to, status}
- `transcripts` {_id, childId, source, text, meta}
- Índices: events(childId, startTime), children(parentId), plans(childId, status)

## Validaciones críticas
- Zod + transformaciones seguras de fecha.
- Invariantes: `endTime > startTime`, subeventos solo dentro de rango del padre.
- `night_feeding`: solo líquidos cuando `isAsleep == true` (nunca sólidos).

## Migración desde legado
- Convertir `childId` `string -> ObjectId`.
- Deduplicar/normalizar analítico y separar de operacional.
