# Evolución del validador

## Etapa 2: ingreso documental — implementada

Esta etapa nació como una recomendación de evolución, no como un requisito explícito de los archivos entregados. Se implementó manteniendo separadas la extracción y la decisión de negocio.

Capacidades terminadas:

- carga de PDF, XLSX y EML originales desde la interfaz;
- extracción determinística como primera opción;
- fallback opcional a OpenAI para texto o estructuras ambiguas;
- salida estructurada validada con Zod;
- reglas monetarias, autorizaciones y decisión ejecutadas solo por el dominio;
- protección básica contra instrucciones incluidas en documentos;
- límites de tipo, firma, cantidad, tamaño, tiempo y reintentos;
- procesamiento efímero, sin persistencia de los archivos;
- fallback a revisión humana cuando no es posible extraer con confianza.

Validación realizada:

- un paquete XLSX + PDF + EML se procesa de extremo a extremo;
- los tres documentos se extraen de forma determinística;
- el resultado alimenta el motor original y genera la decisión y el borrador de orden.
- el adaptador se validó con una llamada real, credenciales locales y salida estructurada.

Pendiente antes de considerar cerrada una integración de IA en producción:

- ampliar el conjunto de pruebas con documentos ambiguos representativos del negocio;
- añadir OCR o entrada multimodal para PDF escaneado;
- definir métricas de calidad, costo, latencia y tasa de revisión humana;
- decidir una política organizacional de retención y auditoría, aunque la aplicación actual no almacena archivos;
- ejecutar pruebas de abuso con archivos comprimidos y documentos adversariales.

## Etapa 3: operación en nube — desplegada

- versión de producción desplegada en Vercel;
- secretos configurados únicamente en el entorno Production;
- página y API verificadas desde la URL pública;
- añadir observabilidad sin registrar contenido sensible;
- documentar rollback y responsables operativos.
