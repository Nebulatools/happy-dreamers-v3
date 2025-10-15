# PRD  Happy Dreamers (v1)

## Visió
nPlataforma para registrar eventos de sueño/vida diaria de niños, analizar hábitos y generar recomendaciones personalizadas (con IA + RAG) para familias y pediatras.

## Usuarios y roles
- Padre/Madre/Tutor (usuario estándar)
- Pediatra/Asesor (usuario profesional)
- Admin (soporte / debug restringido por flag)

## Funcionalidades clave (MVP+)
1) **Registro de eventos** (rápido, móvil): Dormir/Despertar, Despertar nocturno (subevento), Alimentación (pecho/biberón/sólidos), Medicamentos, Actividades extra. [Campos y UX guiados para latencia de sueño, estados emocionales, notas con placeholder.]  
2) **Estadísticas y panel**: promedios correctos por **noche real** y por **día con siesta**, no diluidos por días sin datos.  
3) **Planes de sueño** (rutinarios) y seguimiento del progreso.  
4) **Asistente (chat) con RAG**: responder preguntas por periodo (7/30/90 días), comparar meses, consejos contextualizados con plan activo.  
5) **Consultas médicas**: transcripción (Zoom/Meet), análisis y reporte.  
6) **Integraciones**: Zoom Webhook (HMACSHA256 **HEX**), Google Drive (RAG).  
7) **Administración**: flags y herramientas internas seguras.

## Historias de usuario (resumen)
- Como padre, quiero registrar Se durmió / Se despertó en un tap para no romper la rutina.  
- Como padre, quiero ver promedios por noche/siesta **cuando realmente ocurren**.  
- Como pediatra, quiero ver ventanas de sueño y latencia para decidir ajustes.  
- Como asesor, quiero generar un plan determinista con datos válidos o que el sistema diga no hay suficiente contexto.

## Requisitos funcionales (claves)
- Clasificación automática de Sueño Nocturno vs Siesta por franja horaria.
- **Despertar nocturno** como subevento dentro del bloque de sueño nocturno.
- Alimentación nocturna solo líquidos crean night_feeding; nunca sólidos.
- Asistente soporta consultas por periodo (7d/30d/90d/meses específicos) y compara progreso del plan.

## Criterios de aceptación (extracto)
- Event flows alternan correctamente (botones y estado) y generan bloques con startTime/endTime.  
- Estadísticas: Promedio nocturno = total minutos nocturnos / número de **noches con sueño**; Promedio siestas = total minutos siesta / **días con siesta**.  
- Zoom CRC: validación responde HMACSHA256 en **HEX** (no base64).  
- Google Drive: sólo carpeta autorizada, private key en .env con n escapados.  
- Planes de sueño: si datos insuficientes, el agente devuelve respuesta negativa conforme a esquema JSON (sin inventar).

## No Funcionales (enlaza a NFR)
- Seguridad por diseño, CORS estricto, ratelimiting, logs estructurados, SLO p95  1.2s, resiliencia.  

## Métricas y éxito
- Tasa de registro diario, tiempo medio de respuesta del chat, adopción de planes, reducción de despertares nocturnos.
