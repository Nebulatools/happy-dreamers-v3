1. Actualicé docs/03-DATA-MODEL.md con la sección “Principales”: incluye los campos clave para users, children, events (con detalle de night_wake y referencia a parentEventId), plans, transcripts y los índices sugeridos. Indica si deseas describir esquemas secundarios o validaciones específicas.

* Next.js Scaffold

2. Generé la app Next.js 15 con TypeScript, ESLint y Turbopack (package.json:14) y mantuve la App Router por defecto.

3. Tailwind 4 quedó configurado mediante PostCSS (postcss.config.mjs:1) y la importación global (app/globals.css:1).

4. Creé los directorios base components/, lib/ y app/api/ para empezar a organizar UI, utilidades y endpoints.

* Sin pruebas: proyecto recién inicializado. Próximo paso natural:

5. Base del proyecto lista con tooling estricto y verificación de entorno antes de compilar (eliminó allowJs; prettier.config.cjs:1 define la configuración base de Prettier y .husky/pre-commit:1 ejecuta npm run lint y npm run typecheck en cada commit).

* Middleware Security

6. Añadí middleware.ts:1 para aplicar CORS con allowlist (https://happy-dreamers.app + previews *.vercel.app) y devolver 403 si el Origin no es válido; maneja preflights OPTIONS y publica cabeceras CORS mínimas.

7. lib/logger.ts ahora expone logging estructurado con Pino:
  - Configura el nivel según entorno (production→info, test→silent, default→debug) y oculta campos sensibles (req.headers.authorization, req.body.password, user.email, user.phone).
  - getCorrelationId toma el x-correlation-id de headers (objetos Headers o plain) y genera un UUID si falta.
  - createRequestLogger produce un logger hijo por request con el correlation-id; childLogger(scope) ayuda a derivar loggers por componente/servicio y mantiene metadatos adicionales.
  - logger expone el root logger por si se requiere el global.

8. Dependencias pino, pino-http y tipos instalados; npm run lint y npm run typecheck pasan.

9. Pool estable y utilidades expuestas en lib/mongodb.ts:1-186 con las opciones solicitadas; además se añade detección de snappy y registro de fallback para seguir cumpliendo el NFR de escalabilidad sin romper en entornos donde el códec no esté presente.

10. package.json:5-42 ahora incluye el script test:unit y dependencias mongodb/vitest, con package-lock.json actualizado en consecuencia.

11. Pruebas unitarias con vitest (tests/mongodb.test.ts:1-172) cubren ping, métricas y la reconexión simulada (closeConnection() + nuevo getDb()), garantizando que se vuelve a levantar el cliente cuando  el pool se cierra.

12. Se agregan los esquemas de dominio en lib/domain-schemas.ts:1-209, modelando User, Child, Plan, Event y Transcript con sus tipos de TypeScript y reglas Zod. Las validaciones incluyen las invariantes pedidas: endTime > startTime, night_wake obligado a estar dentro de un bloque nocturno activo (con control de parentEventId) y la prohibición de marcar feeding_solids como night_feeding, evitando datos inconsistentes que afectarían la escalabilidad de los agregados analíticos. Se exportan listas de valores para reuso y se normalizan fechas/ObjectId de forma centralizada para reducir fricción en pipelines.

13. Se ajusta lib/mongodb.ts:10-45 para tipar correctamente los compresores negociados, manteniendo el pool estable ya definido y su NFR de escalabilidad.

14. Nuevo script de migración en scripts/db-migrate.ts:1-67 que reutiliza el pool estable (lib/mongodb) y asegura los índices solicitados: events(childId,startTime), children(parentId) y plans(childId,status). Cada índice queda identificado por nombre fijo y se registra en el logger para  poder auditar ejecuciones, apoyando la NFR de escalabilidad al optimizar los accesos más frecuentes. package.json:5-17 ahora expone npm run db:migrate para lanzar la migración desde la CLI.

15. No ejecuté la migración porque no hay una instancia MongoDB accesible en el entorno actual; en cuanto definas MONGODB_URI, lanza npm run db:migrate para aplicar los índices.

16. Actualicé el gancho en .husky/pre-commit:1-14 eliminando la dependencia obsoleta de husky.sh, añadiendo detección segura de npm/npm.cmd y normalizando PATH con el directorio de node, así el hook funciona en v9/v10 sin depender de rutas heredadas. También renombré module a mongoModule en tests/mongodb.test. ts:150-159 para cumplir con la regla @next/next/no-assign-module-variable que había aflorado al ejecutar el hook.

17. Reescribí .husky/pre-commit:1-43 para que sea un script Node con shebang propio (sin husky.sh), que añade el directorio de node al PATH y ejecuta las tareas via cmd.exe/npm.cmd en Windows o npm en Unix, evitando la referencia rota a C:/SYSTEM/Software/Nodejs/npm. De esta forma desaparece la dependencia obsoleta y el hook es compatible con Husky v10+.

18. Ajusté .husky/pre-commit:1-34 para que Husky deje de apuntar a la ruta inexistente C:/SYSTEM/Software/Nodejs/npm. Ahora el script:
  - Limpia entradas cacheadas (hash -r) y prioriza el directorio real de node en el PATH.
  - Prefiere npm.cmd en Windows y solo usa npm si el binario existe y es ejecutable; como último recurso recurre a npx npm.
  - Ejecuta npm run lint y npm run typecheck con el comando válido detectado.

19. Eliminé Husky del proyecto (package.json:5-17, package-lock.json) y borré la carpeta .husky/, simplificando el flujo de commits sin depender de la librería obsoleta. Confirmé que los scripts siguen disponibles de forma manual (npm run lint).

* Auth Setup

20. package.json:18 pulled in next-auth and @auth/mongodb-adapter to support the new auth stack.

21. lib/env.ts:6 added a typed ENABLE_DEBUG_ENDPOINTS flag so feature checks stay boolean.

22. lib/auth/config.ts:23, auth.ts:1, app/api/auth/[...nextauth]/route.ts:1 wired NextAuth to the shared Mongo client, propagated user roles through JWT/session callbacks, and enforced secure cookie names in poduction.

23. lib/auth/roles.ts:1 & lib/auth/require-role.ts:21 defined the role hierarchy plus a reusable API wrapper that returns 401/403 before calling handlers.

24. middleware.ts:1 now calls getToken to block protected page prefixes (dashboard/admin/etc.) unless a valid NextAuth token is present.

* Admin Debug Endpoint

25. app/api/users/debug/route.ts:1 gates the listing behind admin role + ENABLE_DEBUG_ENDPOINTS, caps results, and hashes emails to avoid exposing PII.

26. lib/mongodb.ts:107 exposed getMongoClient for adapters, and next-auth.d.ts:1 extended typings so session.user.id/role stay strongly typed.

* Tests & Tooling

27. tests/users-debug.test.ts:1 verifies 401/403/admin success cases and the flag toggle with mocked auth/DB layers.

28. vitest.config.ts:1 added path aliases so Vitest resolves @/... imports.

* CSP Update

29. Replaced the static CSP with a request-aware builder that keeps the strict production policy while adding the minimal allowances Next.js needs in dev:
  - 'unsafe-inline' / 'unsafe-eval' for inline hydration code and ws: for the HMR websocket (middleware.ts:10-33).
  - Updated the security-header helper to apply the new CSP per request, preserving the existing flow for auth/CORS handling (middleware.ts:60-89).

30. Ajusté el helper de cabeceras para que ya no acepte un parámetro sin uso; la CSP dinámica sigue igual y solo depende del NODE_ENV, así desaparece la advertencia y no afecta el funcionamiento (middleware.ts:10-33, middleware.ts:60-89).

31. Eliminé los parámetros _request y _context del endpoint de depuración, ya que requireRole puede invocar la función sin que necesite capturarlos; así quedamos sin warnings en ese archivo (app/api/users/debug/route.ts:28-52).

32. Añadí la carga explícita de variables de entorno usando @next/env para que npm run check-env lea el contenido de .env igual que lo hace Next (scripts/check-env.ts:1-7). Tras el cambio, el script encuentra tus secretos pero falla porque ENABLE_DEBUG_ENDPOINTS vale z, que no coincide con el esquema ('true' | 'false'). Para que el comando termine con éxito, ajusta esa clave en tu .env, por ejemplo ENABLE_DEBUG_ENDPOINTS=false, y vuelve a ejecutar npm run check-env.

33. Middleware now derives a correlation id, stamps it on both request/response headers, and logs key control-flow decisions so the value follows the request path (middleware.ts:4-157). The role guard wraps the handler context with the same correlation id and a per-request logger, adding audit logs for auth outcomes (lib/auth/require-role.ts:1-79).

34. The debug users endpoint consumes the injected logger/context, recording fetch/return metrics and echoing the correlation header on every response (app/api/users/debug/route.ts:28-68).

35. Snappy compression is auto-negotiated when either @mongodb-js/snappy or the new snappy dependency is present; successful detection is logged, otherwise we fall back gracefully (lib/mongodb.ts:14-44, package.json:17-28, package-lock.json).

36. npm run check-env now mirrors Next’s boot sequence by loading .env before validating keys, so boolean flags like ENABLE_DEBUG_ENDPOINTS must be set to true/false (scripts/check-env.ts:1-18).


Changes
                                                                                      
  - Implemented the GET /api/healthz Next.js handler to validate required envs,       
    measure Mongo ping, attach correlation logging, and return 200/503 with structured    payload (app/api/healthz/route.ts:1).                                             
  - Added reusable build metadata helper that normalizes possible CI-provided commit/ 
    timestamp variables for the health response (lib/build-info.ts:1).                
  - Wrote contract tests covering healthy, env-failed, and DB-failed scenarios for the    new endpoint (tests/healthz.test.ts:1).                                           
                                                                                      
  Tests                                                                               
                                                                                      
  - npm run test:unit -- tests/healthz.test.ts                                        
                                                                                      
  Natural next steps: 1) run the full npm run test:unit suite to ensure no regressions
  outside the new contract tests; 2) hit /api/healthz against a live environment to   
  verify it reports real DB latency and build metadata. 




 Debug users endpoint now obfuscates identifiers while keeping the admin+flag guard. 
                                                                                      
  - app/api/users/debug/route.ts:20 introduces a reusable SHA-256 obfuscator and      
    applies it to each returned _id, preserving the hashed-email mask and 404         
    behaviour when ENABLE_DEBUG_ENDPOINTS=false.                                      
  - tests/users-debug.test.ts:38 mirrors the obfuscation logic and updates the        
    contract assertions so the spec enforces hashed IDs alongside the existing admin/ 
    flag checks.



    Built out the operational events API:

  - app/api/children/[id]/events/route.ts:184 now handles GET with shared helpers     
    for child-id validation, range filtering, and 500-cap pagination, plus 404s for   
    unknown children and 400s for malformed query params.                             
  - Same module adds a POST handler at app/api/children/[id]/events/route.ts:414 that 
    parses JSON, runs the event payload through createEventSchema, enforces parent-   
    night-block linkage, inserts into Mongo, and returns the serialized event with    
    correlation id; both routes remain pro/admin gated.                               
    child/parent, auth rejection, and bad JSON input via Vitest mocks.



Expanded the children events API to cover retrieval, creation, and partial updates. 
  app/api/children/[id]/events/route.ts:1 now exports shared helpers and keeps GET/   
  POST under requireRole('pro'), validating query filters, checking child existence,  
  enforcing parent-night-block rules, and normalizing Mongo docs. Added app/api/      
  children/[id]/events/[eventId]/route.ts:1 for PATCH, which accepts partial payloads,  vets ObjectIds, merges with the stored event, reruns the domain schema with         
  contextual validation, and persists only the requested changes while maintaining    
  updatedAt. Contract coverage in tests/children-events.test.ts:1 grew to 21          
  scenarios across GET/POST/PATCH, exercising success cases, removals via null, parent  validation, auth guards, bad JSON, and invalid ids.                                 
                                                                                      




Deploy commands

npm install
npm run dev
npm run lint
npm run typecheck
npm run check-env **
npm run test:unit **



       1. Incorporar estos esquemas en los repositorios de datos/repositorios de servicios para validar     
     entradas antes de persistir.                                                                      
  2. Añadir pruebas unitarias específicas de createEventSchema cubriendo casos de bloque nocturno      
     y night_feeding.
                                                                                            
  1. Si quieres automatizar los chequeos, considera usar lint-staged con npx simple-git-hooks o        
     configurar validaciones desde CI (por ejemplo, ejecutar npm run lint && npm run typecheck en el   
     pipeline).

              
  1. Decide on the initial sign-in provider (credentials/email/OAuth) and hook it into                 
     authConfig.providers.                                                                             
  2. Build or wire the UI flow (e.g. /login) that matches the new middleware redirects.

                                                                            
  - npm run test:unit -- tests/users-debug.test.ts                                    
                                                              
  1. Run npm run test:unit to re-check the entire unit suite. 

  - npm run test:unit -- tests/children-events.test.ts

  Next steps: 1) run npm run test:unit to catch regressions elsewhere;

  Next steps: 1) run the full npm run test:unit suite to ensure nothing else
  regressed; 2) hit the new PATCH endpoint against a real DB to confirm night-wake    
  reconciliation with actual parent blocks.
  