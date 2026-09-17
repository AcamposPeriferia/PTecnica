# Agente conversacional — Órdenes de compra SAP

Agente de chat que lee el paquete de una solicitud de compra (correo, solicitud, cotización, aprobación y, si aplica, factura), lo valida contra los maestros de Periferia (RC1–RC10), construye el payload de la OC, genera la evidencia de aprobación y crea la orden en un SAP simulado. Las excepciones no se resuelven solas: se le devuelven a la analista con una recomendación y esperan su confirmación explícita.

Construido para el reto técnico [`PRD-03-agente-ordenes-compra-sap`](../PRD-03-agente-ordenes-compra-sap%203.md). El planteamiento completo de la solución está en [`SOLUCION.md`](./SOLUCION.md).

## Arranque en local (un comando)

Requisitos: Node 20+ (probado en Node 22/24) y una clave de OpenAI.

```bash
npm install
cp .env.example .env.local   # completar OPENAI_API_KEY
npm run dev
```

Abre `http://localhost:3000`. El mismo comando levanta el front (chat) y el backend (API del agente); no hay procesos separados que orquestar.

## Variables de entorno

Ver [`.env.example`](./.env.example). Solo `OPENAI_API_KEY` es obligatoria; el resto tiene valores por defecto razonables.

| Variable | Obligatoria | Descripción |
|---|---|---|
| `OPENAI_API_KEY` | Sí | Clave del proveedor LLM. Solo se lee en el backend; nunca se expone al front, al repo ni a los logs. |
| `OPENAI_MODEL` | No | Modelo a usar (por defecto `gpt-5.5`). |
| `OPENAI_TIMEOUT_MS` | No | Timeout de la llamada al proveedor (por defecto 30000). |
| `AGENT_MAX_ITERATIONS` | No | Tope de iteraciones herramienta→modelo por turno (por defecto 25, tope duro 25). |
| `AGENT_MAX_OUTPUT_TOKENS` | No | Tokens máximos de salida por llamada al modelo (por defecto 2000). |
| `AGENT_MAX_SESSION_TURNS` | No | Tope de turnos de usuario por sesión (por defecto 30). |
| `AGENT_RATE_LIMIT` | No | Máximo de solicitudes por IP cada 10 minutos (por defecto 20). |

No hay autenticación: el link puede ser público (no-objetivo explícito del PRD).

## `demo.ts` — verificación sin front ni sesión de chat

Procesa los 6 casos de `fixtures/solicitudes/` llamando directamente a las herramientas (`src/tools/oc.ts`), sin pasar por el modelo ni por ninguna clave de proveedor:

```bash
npm run demo
```

Imprime por caso si es apta, sus bloqueos, sus confirmaciones y si es retroactiva; crea la OC cuando corresponde y termina repitiendo `sol-001` para mostrar la idempotencia (mismo `numero_oc`, `idempotente=true`). El resultado es determinístico salvo los timestamps; `out/` se limpia al inicio del script.

## Comandos disponibles

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta front + backend en local. |
| `npm run build` / `npm start` | Build y arranque en modo producción. |
| `npm run demo` | Corre los 6 casos sin modelo (ver arriba). |
| `npm test` | Corre las pruebas unitarias (vitest). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm run build:modulo` | Regenera `modulo/` a partir de `agent/prompt.md` y `src/knowledge/ordenes-compra.md` (ver más abajo). |

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation, sessionId, model }`. Ejecuta un turno completo del agente (loop modelo↔herramientas). |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión (para recargar el chat). |
| `GET` | `/api/health` | `{ ok, provider, model, configured }`, sin exponer la clave. |

## Estructura

```
agent/prompt.md              # system prompt (comportamiento)
src/knowledge/                # conocimiento del proceso de negocio
src/tools/oc.ts               # las 5 herramientas del contrato (oc_*)
src/sap/                      # interfaz SapAdapter + mock sobre out/sap/
src/llm/                      # adaptador LLM propio (adapter.ts) + implementación OpenAI
src/agent/                    # ciclo del agente (runner.ts) y sesiones en archivo
src/domain/                   # esquemas zod y normalización de los fixtures
src/components/agent-chat.tsx # front de chat (Next.js/React)
fixtures/                     # entregado por Periferia, no se modifica
out/                          # generado en ejecución (control.csv, log.jsonl, sap/, evidencia)
modulo/                       # bonus: agente empaquetado, reutilizable sin el servidor
demo.ts                       # ver arriba
```

## `modulo/` — agente reutilizable (bonus)

`modulo/agent.md`, `modulo/tools/oc.ts` y `modulo/skill/ordenes-compra/SKILL.md` son las **mismas** piezas que usa la aplicación, no copias: `modulo/tools/oc.ts` reexporta `src/tools/oc.ts`, y `modulo/agent.md` / `modulo/skill/.../SKILL.md` se regeneran desde `agent/prompt.md` y `src/knowledge/ordenes-compra.md` con `npm run build:modulo`. Ejecútalo de nuevo después de tocar cualquiera de esas dos fuentes.

## Link de prueba

Pendiente de despliegue — ver la sección de riesgos en `SOLUCION.md`. Mientras tanto, `npm run dev` deja la aplicación disponible en `http://localhost:3000` en menos de un minuto.
