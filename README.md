# Validador de solicitudes de compra

Aplicación web para revisar expedientes de compra contra datos maestros, explicar cada incumplimiento y generar un borrador de orden cuando la solicitud está lista.

## Requisitos

- Node.js 22 o superior
- npm 10 o superior

## Ejecución local

```bash
npm ci
npm run validate:data
npm test
npm run dev
```

Abra `http://localhost:3000`. La vista **Expedientes** usa los casos de prueba incluidos; **Nueva validación** recibe los documentos originales.

## Ingreso de documentos

- Solicitud de compra: `.xlsx`.
- Cotización: `.pdf` con texto seleccionable.
- Aprobación: `.eml`.
- Factura: `.pdf` opcional.
- Límite: cuatro archivos y 4 MB por paquete.

Los archivos se validan por extensión y firma, se procesan en memoria y no se persisten. Primero se intenta una extracción determinística. Si el formato es ambiguo y existe una clave configurada, el adaptador de OpenAI solicita una salida estructurada y la valida con Zod antes de entregarla al dominio. El modelo no decide aprobaciones, no calcula reglas de negocio y no reemplaza los datos maestros.

Para activar ese fallback, cree un archivo `.env.local` que no debe versionarse:

```dotenv
OPENAI_API_KEY=su_clave
OPENAI_MODEL=gpt-5.5
```

Sin esa variable, la aplicación sigue funcionando y deriva los documentos no reconocidos a revisión manual. Los PDF escaneados sin capa de texto todavía requieren OCR o extracción multimodal.

## Calidad

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Arquitectura

- `src/domain`: modelos, normalización, parsers y reglas puras de negocio.
- `src/application`: casos de uso de evaluación y extracción documental.
- `src/infrastructure`: repositorios y adaptadores externos, incluido OpenAI.
- `src/app`: interfaz y API HTTP.
- `tests`: validación de datos, reglas y extracción.

Los archivos originales de `maestros` y `solicitudes` se conservan sin cambios. La API documental responde con `Cache-Control: no-store`.

## Despliegue en Vercel

Producción está publicada en [reto-03-pearl.vercel.app](https://reto-03-pearl.vercel.app). `OPENAI_API_KEY` y `OPENAI_MODEL` están configuradas como secretos del entorno Production. Antes de cada despliegue deben pasar `npm test` y `npm run build`.

El estado y los límites de la segunda etapa están detallados en [`docs/ROADMAP.md`](docs/ROADMAP.md).
