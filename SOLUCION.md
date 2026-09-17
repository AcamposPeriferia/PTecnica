# SOLUCION.md — Agente de órdenes de compra SAP

## 1. Problema en una frase

Administración digita a mano, por cada factura, los mismos ocho campos de una OC que ya están en el correo de solicitud, la cotización y la aprobación — con el riesgo de error de un centro de costo mal tecleado y sin forma sistemática de saber qué porcentaje de compras se crea después de la factura; le duele a la **analista administrativa** (tiempo y error) y a **auditoría/dirección** (control y medición).

## 2. Arquitectura

```
web (agent-chat.tsx) ── POST /api/chat ──▶ runner.ts (ciclo del agente)
        ▲                                        │
        │ toolCalls, needsConfirmation            ├─▶ src/llm/adapter.ts (interfaz) → src/llm/openai.ts (OpenAI Responses API)
        │                                        │
        └── GET /api/sessions/:id ◀── session-store.ts (out/sessions/*.json)
                                                   │
                                                   └─▶ src/tools/oc.ts (oc_leer_paquete, oc_validar, oc_construir_payload,
                                                        oc_generar_evidencia, oc_crear)
                                                            │              │
                                                            ▼              ▼
                                                  fixtures/ (solo lectura)   src/sap/mock.ts → out/sap/ordenes.jsonl
                                                                             out/<caso>/{aprobacion.txt,.pdf,trazabilidad.json}
                                                                             out/control.csv · out/log.jsonl
```

| Qué | Dónde vive | Por qué separado |
|---|---|---|
| **Comportamiento** (system prompt) | [`agent/prompt.md`](./agent/prompt.md) | Cambiar una regla de conducta del agente no toca código. |
| **Conocimiento** del proceso | [`src/knowledge/ordenes-compra.md`](./src/knowledge/ordenes-compra.md) | Se inyecta junto al prompt (`runner.ts`); un cambio de política de negocio no es un despliegue de código. |
| **Ejecución** (la única fuente de verdad de datos) | [`src/tools/oc.ts`](./src/tools/oc.ts) | El modelo nunca calcula ni corrige un valor: todo dato que aparece en el chat proviene del `data` de una herramienta. |

El front (`src/components/agent-chat.tsx`) es un cliente delgado: manda `{sessionId, message}`, pinta `reply`, la lista de `toolCalls` (nombre, argumentos, resumen, estado) y resalta `needsConfirmation`. No conoce reglas de negocio.

**Extra sobre el alcance del PRD — caso nuevo por documentos reales.** El front también deja subir (`POST /api/uploads`, que solo guarda bytes en `out/uploads/<uploadId>/raw/`) el Excel, PDF y correo `.eml` de un caso que no está en `fixtures/`. Una sexta herramienta, `oc_ingerir_paquete` (`src/tools/oc.ts`), lee esos archivos y los convierte al mismo formato que ya usa `oc_leer_paquete`: extracción determinística primero (`src/tools/ingest.ts`: `read-excel-file` para el Excel, `unpdf` para el PDF, `mailparser` para el correo, reutilizando el mismo `parseCotizacion`/`parseFactura` de los fixtures), y solo si el documento no calza con lo esperado, un paso de extracción con LLM (`src/tools/ingest-llm.ts`) cuya salida se vuelve a validar con los mismos esquemas `zod` antes de aceptarla — un documento real nunca se acepta sin pasar por ese filtro. El resultado se escribe en `out/casos/<caso>/` y de ahí en adelante el caso se comporta exactamente igual que uno de fixtures (mismas RC1–RC10, mismo `oc_crear` idempotente).

## 3. Ciclo del agente

`src/agent/runner.ts` implementa el loop modelo↔herramientas:

1. Carga `agent/prompt.md` + `src/knowledge/ordenes-compra.md` como `instructions` (texto plano, en cada turno).
2. Por iteración (**CA1**: `Math.min(AGENT_MAX_ITERACIONES, 25)` — el tope duro de 25 no se puede subir por variable de entorno): llama `adapter.enviar(...)`; si la respuesta no trae `toolCalls`, ese es el texto final y el loop termina; si trae, ejecuta cada una contra `ocTools`, valida sus argumentos con el mismo `zod` de la herramienta (defensa en profundidad: el JSON Schema que ve el modelo y el `safeParse` que corre el servidor son el mismo esquema) y anexa `tool_result` al historial.
3. **CA2** (el modelo no afirma valores fuera de herramientas) se sostiene en dos capas, no solo en el prompt: (a) el prompt lo prohíbe explícitamente; (b) `oc_crear` **vuelve a leer el paquete del disco y a re-ejecutar `validatePackage` de cero** (`oc.ts` función `crear`, no confía en lo que el modelo dice que ya validó) y solo acepta el `payload` que el modelo construyó si su `referencia.solicitud_id` coincide con el caso re-leído. Un modelo que intentara "arreglar" un monto en el payload no cambia lo que queda persistido, porque los campos numéricos del payload ya sólo pueden salir de `buildOrder`.
4. **CA3** (confirmación humana) también es un candado en la herramienta, no una convención de chat: `oc_crear` devuelve `{ok:false}` si `validation.confirmaciones.length && confirmado !== true` (`oc.ts:463-465`). El prompt le pide al modelo terminar el turno con una pregunta, pero aunque no lo hiciera, la herramienta bloquea la creación igual.
5. **CA4**: cada tool call se guarda en `out/log.jsonl` (`logToolCall`) y se devuelve en `toolCalls[]` para que el front lo pinte.
6. **CA5**: todo el loop está en un único `try/catch`; un error de herramienta o del proveedor se convierte en un mensaje de asistente legible y la sesión se guarda igual — no hay excepción que tumbe la ruta HTTP.

## 4. Elección del modelo

**Proveedor:** OpenAI, API de Responses (`src/llm/openai.ts`), por soporte nativo y maduro de *function calling* con JSON Schema y SDK oficial de TypeScript.
**Modelo:** el configurado en `OPENAI_MODEL` (por defecto `gpt-5.5`).

**Costo estimado por caso**: no hay telemetría de facturación instrumentada en este entorno, así que esto es una estimación por conteo, no un dato medido en producción. El diseño actual reenvía `instructions` + los 5 esquemas de herramientas + todo el historial acumulado en **cada** iteración (no se usa `previous_response_id` ni caché de prompt del lado del servidor), así que el costo real está dominado por ese *overhead* repetido, no por el tamaño del caso: un caso que termina en OC creada dispara 5–6 llamadas al modelo (una por herramienta + la respuesta final), y cada una reenvía de nuevo instructions+tools+historial completo. Orden de magnitud observado en pruebas: **10–25 mil tokens de entrada y 1–3 mil de salida por caso**. Con las tarifas vigentes del modelo configurado (verificar en el panel de precios del proveedor, cambian con frecuencia) esto se traduce típicamente en centavos de dólar por caso — bajo para este volumen, pero el patrón de "reenviar todo el historial siempre" es el primer lugar a optimizar si el volumen crece (ver §8 y §12).

## 5. Matriz de controles (RC1–RC10)

Todas implementadas en `validatePackage` dentro de [`src/tools/oc.ts`](./src/tools/oc.ts):

| Regla | Tipo | Dónde | Resumen |
|---|---|---|---|
| RC1 | Bloqueo | `oc.ts:152-155` | Proveedor por NIT normalizado o nombre normalizado, y `activo`. |
| RC2 | Bloqueo | `oc.ts:163-169` | Aprobación existe, contiene "Aprobado" y el remitente está en `aprobadores` del centro. |
| RC3 | Bloqueo | `oc.ts:170-171` | `valor_total` ≤ tope del aprobador identificado en RC2. |
| RC4 | Bloqueo | `oc.ts:158-160` | `subarea` pertenece al `centro_costo`. |
| RC5 | Confirmación | `oc.ts:178-188` | Sin cotización, o diferencia > 2 % → confirmación con ambos valores. |
| RC6 | Confirmación + derivado | `oc.ts:190-193` | IVA ausente → se deriva del proveedor y se marca para confirmar. |
| RC7 | Derivado | `oc.ts:194` | Condiciones de pago ausentes → se derivan, solo se informan. |
| RC8 | Confirmación | `oc.ts:203-206` | Factura anterior a la solicitud → `retroactiva = true`. |
| RC9 | Confirmación | `oc.ts:208-210` | Aprobación anterior a la fecha de solicitud. |
| RC10 | Bloqueo | `oc.ts:174-176` | `cantidad × valor_unitario` ≈ `valor_total` (±1). |

Se añadieron dos bloqueos no pedidos por el PRD pero necesarios para no construir un payload con un código inválido: `IVA_DESCONOCIDO` y `PAGO_DESCONOCIDO` (el código derivado o informado no existe en su maestro respectivo).

**La más difícil: RC2.** No es una comparación de un solo campo — cruza tres fuentes (`aprobacion.aprobado` por regex sobre texto libre, el `centro_costo` de la solicitud contra el maestro de centros, y el email del aprobador case-insensitive contra la lista de `aprobadores` de ese centro específico) y de su resultado depende directamente si RC3 (el tope) siquiera se puede evaluar. Un aprobador que existe pero no para ese centro, o que aprueba pero sin la palabra exacta, tiene que fallar por la razón correcta y no por una genérica.

## 6. Diseño del adaptador SAP real (documentación, no implementado)

**Opción elegida: OData `API_PURCHASEORDER_PROCESS_SRV`** (S/4HANA), no RFC/BAPI ni SAP Integration Suite, dado que la viabilidad de conexión no está confirmada:
- Es el estándar que SAP recomienda para integraciones externas nuevas; no requiere biblioteca NCo/RFC ni un usuario de diálogo dentro de SAP.
- Autenticación desacoplable (OAuth2 client-credentials) en vez de credenciales RFC embebidas.
- SAP Integration Suite añadiría una capa de middleware que no se justifica para una sola operación (crear OC); se reconsideraría si en el futuro se integran también recepción de mercancía y factura.

**Mapeo (7.4 → OData):**

| Payload (`OrdenCompra`) | Campo OData | Nota |
|---|---|---|
| `sociedad` / `organizacion_compras` | `CompanyCode` / `PurchasingOrganization` | Literales `"1000"` de este ejercicio. |
| `proveedor.codigo_sap` | `Supplier` | |
| `moneda` | `DocumentCurrency` | |
| `condiciones_pago` | `PaymentTerms` | |
| `posiciones[].{numero,descripcion,cantidad,unidad,precio_unitario,centro_costo,subarea,indicador_iva}` | `PurchaseOrderItem` (+ `AccountAssignment`) | `unidad` se traduce con una tabla fija UN→EA, H→HR, MES→MON. |
| `aprobador`, `excepciones[]`, `evidencia_sha256` | Sin campo nativo | Se adjuntan como texto largo del header y como archivo vía el servicio OData de adjuntos; `confirmado_por`/`evidencia_sha256` en un campo Z o en metadatos del adjunto. |

**Autenticación:** usuario de comunicación (Communication User) con OAuth2 *client credentials*, alcance limitado a creación de OC. Credenciales en el vault del proveedor de despliegue (no en variables planas, no en el prompt, no en el repositorio); rotación periódica gestionada fuera del agente.

**Idempotencia y reintentos:** `solicitud_id` sigue siendo la clave, pero SAP no la conoce nativamente — se persiste el mapeo `solicitud_id → numero_oc` en un almacén propio (no en el agente) *antes* de llamar a SAP, y todo reintento primero consulta ese almacén. Si SAP responde con error parcial (header creado, ítem rechazado), **no se reintenta automáticamente**: se marca el caso como "requiere revisión manual" en el control, porque reintentar un POST sin idempotencia nativa en SAP puede duplicar la OC real.

**Plan B (conexión no viable):** el adaptador sigue generando el payload validado y la evidencia; en vez de `crearOrden`, escribe un archivo de carga masiva (o el texto listo para pegar en SAP GUI) en `out/sap-carga/`. El ahorro de tiempo de la analista se mantiene aunque no haya integración en vivo.

## 7. Lectura del proceso: OC retroactivas

A dirección: una OC creada después de la factura casi nunca es "alguien se saltó el control" — normalmente es que el trabajo (o la aprobación informal por chat) ya empezó antes de que administración tuviera el paquete completo para digitar, y la cotización formal llega después. Tratarlo como una falta automática castiga el síntoma, no la causa, y el equipo aprenderá a regularizar el papeleo en vez de a prevenir el desvío real.

Propuesta: (1) medir el % retroactivo mensual por centro de costo con `out/control.csv` como fuente única (ya queda marcado por caso); (2) fijar un umbral de tolerancia y solo escalar por encima de él, no caso por caso; (3) el cambio de proceso de fondo es mover el "reservar número de OC" al momento de la aprobación informal del líder, no al momento en que llega la factura — eso hace que la fecha de OC preceda a la factura por construcción, sin añadir un paso manual nuevo.

## 8. Decisiones y trade-offs

1. **Reenviar el historial completo en cada iteración vs. usar `previous_response_id`.** Se eligió reenviar todo (más simple, sin estado de conversación en el proveedor, sin riesgo de perder contexto si `store:false` invalida un id) sobre encadenar respuestas del lado del proveedor. Costo: más tokens de entrada por turno (ver §4). Se descartó encadenar porque acopla la sesión persistida a un estado que vive en OpenAI, no en `out/`, lo que complicaría portar de proveedor.
2. **`strict:false` en las herramientas de OpenAI vs. JSON Schema 100% estricto.** El modo estricto de OpenAI exige que todo campo opcional de un esquema `zod` aparezca igual en `required` (patrón *nullable*), lo que habría obligado a reescribir los esquemas de dominio (`proveedor_nit`, `indicador_iva`, `condiciones_pago` son genuinamente opcionales, no nulos) solo para complacer a un proveedor. Se descartó adaptar el esquema de negocio al proveedor; en su lugar `src/llm/openai.ts` relaja `strict` — el costo es una garantía de adherencia al esquema ligeramente menor, mitigada porque el servidor vuelve a validar con el mismo `zod` antes de ejecutar cualquier herramienta.
3. **SAP simulado como archivos (`out/sap/ordenes.jsonl`) vs. una base de datos embebida.** El PRD no exige persistencia y el reto se evalúa por lectura de código; archivos JSONL son auditables a simple vista y no añaden una dependencia. Se descartó SQLite por ser una complejidad no pedida (no-objetivo explícito del PRD) que además dificultaría revisar `out/` a ojo durante la evaluación. Costo real: no hay bloqueo de escritura entre solicitudes concurrentes (ver §12).
4. **Confirmación humana como candado en la herramienta (`oc_crear`) vs. solo como instrucción de prompt.** Se decidió no confiar el control más sensible (crear una OC) únicamente al comportamiento del modelo. Costo: una línea de acoplamiento entre `oc_crear` y la forma en que el runner marca `needsConfirmation`, pero es el diseño que sostiene la mitigación de riesgo que el propio PRD pide (§10, "el modelo no puede alterar el payload validado").
5. **Extracción determinística primero, LLM solo como respaldo (`oc_ingerir_paquete`) vs. extraer todo con el modelo.** Para el caso nuevo por documentos reales (bonus, §2) se priorizó `read-excel-file`/`unpdf`/`mailparser` sobre pedirle al modelo que leyera el documento completo. Costo: más código (tres parsers determinísticos) que un solo prompt de extracción. Se descartó "todo con LLM" porque un documento con formato conocido (que es el caso común) no debería depender de una llamada no determinística ni de latencia/costo adicional; el LLM entra solo cuando el documento no calza, y aun así su salida se valida con el mismo `zod`.

## 9. Supuestos

- Los maestros de `fixtures/maestros/` son completos y correctos para efectos del ejercicio (en producción se leerían de SAP en tiempo real, ver §6).
- La palabra "Aprobado" en el cuerpo del correo es evidencia suficiente para este ejercicio; auditoría real podría exigir firma digital (riesgo ya señalado en el PRD, §10).
- Cada `centro_costo` tiene una sola lista plana de aprobadores con un tope fijo cada uno (no hay niveles de aprobación ni delegaciones).
- `moneda` en los fixtures es siempre `COP`; el esquema soporta `USD` pero no se ejerció ese camino con datos reales.
- Un único proceso de backend escribe en `out/` a la vez (no hay más de una instancia concurrente en este ejercicio).
- El nombre de carpeta de cada caso (`sol-00N`) es también su identificador de negocio a efectos de rutas; el `solicitud_id` real (`SOL-2026-00N`) es un campo de datos distinto y así se trata en el código.

## 10. Cobertura

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 · Leer el paquete | Hecho | El P1 opcional `oc_leer_excel` no existe como tal, pero su necesidad (leer un `.xlsx` real) sí quedó cubierta por `oc_ingerir_paquete` (extra fuera de las HU, ver §2) para el caso de un caso nuevo no precargado. |
| HU-2 · Validar maestros y controles | Hecho | Maestros se leen de archivo, no de SAP en vivo (§6, §9); no hay suite de tests automatizada que fije RC1–RC10 contra regresiones (solo `demo.ts` como verificación manual). |
| HU-3 · Construir el payload | Hecho | Ninguna brecha más allá de la integración real a SAP (§6, fuera de alcance por diseño). |
| HU-4 · Generar evidencia de aprobación | Hecho | `.txt` (P0) y `.pdf` (P1) ambos generados con `sha256`. |
| HU-5 · Crear la OC en SAP simulado | Hecho | Idempotencia por `solicitud_id` y `out/control.csv` verificados en `demo.ts`; en producción necesitaría el adaptador real de §6. |
| HU-6 · Manejo de errores | Hecho | `{ok:false,error}` en todas las herramientas; falta probar explícitamente contra un paquete con JSON malformado como caso de test dedicado (hoy se apoya en el `try/catch` genérico). |

## 11. Uso de IA

Esta sesión (Claude Code, Claude Sonnet 5) partió de un repositorio que mezclaba dos ejercicios: un proyecto ya confirmado en el historial de git ("Validador de solicitudes de compra", con dashboard e ingestión de documentos) y una implementación sin confirmar de este mismo agente (herramientas, adaptador SAP, adaptador LLM, runner y front de chat) que ya existía en el árbol de trabajo. Lo que hice en esta sesión, de forma verificable en el diff:

- Diagnostiqué la brecha contra el PRD y eliminé el código y tests del proyecto no relacionado (`src/domain/evaluate.ts`, `src/application/`, `src/infrastructure/`, `src/components/dashboard.tsx`, `src/components/ingestion-panel.tsx`, las rutas `api/ingesta` y `api/solicitudes`, y sus tests).
- Moví `maestros/` y `solicitudes/` a `fixtures/` para ajustarme a la estructura del §6.5 del PRD, y corregí las rutas en `oc.ts`, `sap/mock.ts` y `next.config.ts`.
- Corregí que `demo.ts` no corriera (`package.json` no declaraba `"type": "module"`, y el `await` de nivel superior fallaba).
- Refactoricé `src/llm/adapter.ts` para que sea una interfaz realmente neutral al proveedor (antes reexportaba tipos del SDK de OpenAI hasta en `runner.ts` y `session-store.ts`, lo que violaba el requisito de "cambiar de proveedor no debe tocar el ciclo del agente"); la traducción a la API de OpenAI ahora vive solo en `src/llm/openai.ts`.
- Encontré y corregí, probando la aplicación real con una clave de OpenAI real, dos fallas en tiempo de ejecución que no aparecían en el código en reposo: (a) el modo `strict` de OpenAI rechazaba el esquema de `oc_validar` por sus campos opcionales, y (b) un error de hidratación de React introducido al intentar corregir un *lint warning* de `agent-chat.tsx` sin probarlo en el navegador primero.
- Añadí evidencia en PDF (P1) con `pdf-lib`, el paquete `modulo/` del bonus (§9.4, generado por `scripts/build-modulo.ts` a partir de las mismas fuentes para que nunca diverja) y este archivo.
- A petición del usuario, agregué la carga de un caso nuevo por documentos reales (§2, `oc_ingerir_paquete`, `src/tools/ingest.ts`, `src/tools/ingest-llm.ts`, `POST /api/uploads`). La extracción determinística (Excel/PDF/correo) y su respaldo por LLM no las escribí desde cero: adapté el código que ya existía —bien escrito— en el commit del proyecto que había borrado (`git show <commit-anterior>:src/application/document-extraction.ts` y `.../openai-extractor.ts`), ajustando únicamente sus imports y su punto de entrada para que viviera como herramienta del agente (`oc_ingerir_paquete`) en vez de como ruta HTTP de un dashboard. Verifiqué el resultado con un Excel, un PDF y un correo `.eml` reales (no fixtures) generados para la prueba, incluyendo el camino que fuerza el respaldo por LLM (un PDF de cotización con redacción libre que no calza con el parser determinístico).
- El usuario reportó que el chat crecía sin límite y deformaba la página; corregí la cadena de alturas de `globals.css` (`html/body` a 100 % con `overflow: hidden`, `.agent-shell` como columna flex de `100vh`) para que solo `.chat-scroll` y `.agent-sidebar` scrollen internamente. Lo verifiqué inyectando decenas de mensajes sintéticos en el DOM y confirmando que `document.body.scrollHeight` no crece más allá del viewport.

Qué descarté: mantener `strict:true` en las herramientas de OpenAI reescribiendo los esquemas `zod` del dominio para volverlos "nullable" — lo rechacé porque acoplaría el modelo de datos de negocio a una limitación de un proveedor específico (ver §8, decisión 2).

*Nota para quien entregue este reto:* si en una sesión anterior a esta usaste otro asistente (Codex, ChatGPT, Cursor, Copilot, etc.) para construir la implementación original de `src/tools/`, `src/agent/`, `src/llm/` o `agent-chat.tsx` antes de que esta sesión los encontrara, complementa este punto con esa herramienta y para qué la usaste — esta sesión solo puede dar fe de su propio trabajo.

## 12. Riesgos de producción

| Riesgo | Mitigación propuesta |
|---|---|
| `src/sap/mock.ts` hace lectura-modificación-escritura de `ordenes.jsonl` sin bloqueo; dos creaciones concurrentes podrían intercalarse. | Reemplazar por una base transaccional (o el SAP real de §6) antes de cualquier uso multiusuario. |
| CA2 (el modelo no inventa valores) depende del prompt para el *texto* de la respuesta final; los tool calls sí están forzados por esquema, pero el resumen en prosa no se re-verifica contra los datos. | Generar el resumen final de forma determinística a partir de los datos de las herramientas en vez de dejarlo enteramente al modelo, o añadir un paso de verificación automática que compare cifras citadas contra `data`. |
| El límite de tasa (`AGENT_RATE_LIMIT`) vive en un `Map` en memoria del proceso — no sobrevive un reinicio ni se comparte entre instancias serverless. | Mover a un store compartido (Redis/Upstash) si se despliega con más de una instancia. |
| La evidencia de aprobación es solo la palabra "Aprobado" en un correo sin verificación de remitente (DKIM/SPF) ni firma. | Ya señalado como riesgo en el PRD; mitigar con firma digital o verificación de remitente antes de aceptar la aprobación como válida. |
| No hay suite de tests automatizada sobre `oc_validar` (RC1–RC10); un cambio de regla de negocio podría romper una regla en silencio. | Añadir tests unitarios por regla antes de tocar `validatePackage` en producción. |
| Secretos hoy son una variable de entorno simple sin rotación gestionada. | Mover a un vault gestionado por la plataforma de despliegue antes de ir a producción real. |
| **Confirmado en el despliegue de Vercel**: todo el estado en `out/` (sesiones, `out/uploads/`, `out/casos/`, `out/sap/ordenes.jsonl`, `control.csv`) vive en `/tmp`, que Vercel no garantiza compartir entre invocaciones de función separadas. En pruebas contra el link de producción, el flujo de confirmación en dos turnos sobrevivió (reutilizó la misma instancia tibia), pero subir un caso nuevo y luego pedirle al agente que lo ingiriera —dos requests separados— falló una vez porque cayeron en instancias distintas. No es un bug de la lógica: es una limitación de fondo de usar disco local en serverless, aceptable para este ejercicio (el PRD no exige persistencia durable) pero **no apta para el uso real en producción** tal como está desplegado. | Mover ese estado a un almacenamiento compartido entre invocaciones (Vercel Blob para los archivos subidos y el caso ingerido, o directamente una base de datos/KV para sesiones, SAP simulado y control) antes de depender de la carga de documentos o de conversaciones largas en el link público. |
| La extracción por LLM de un documento real (`oc_ingerir_paquete`) puede fallar o ser menos precisa que la determinística en formatos muy atípicos o PDFs escaneados sin texto seleccionable (no hay OCR). | El fallo es explícito (`ok:false` con el detalle de qué documento no se pudo leer), no silencioso; para producción, añadir OCR y ampliar las pruebas con documentos ambiguos reales antes de confiar en el camino LLM para volumen alto. |
