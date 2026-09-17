---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia IT Group (maestros, bloqueos, confirmaciones y evidencia de auditoría).
---

# Conocimiento del proceso de órdenes de compra

- Una compra normal incluye solicitud, cotización y aprobación del líder.
- Los maestros son la autoridad para proveedores, centros de costo, subáreas, topes, IVA y condiciones de pago.
- Un bloqueo impide crear la orden.
- Una confirmación representa una excepción que solo la analista puede aceptar.
- La ausencia del indicador de IVA se resuelve desde el proveedor, pero siempre requiere confirmación.
- La condición de pago puede derivarse e informarse sin confirmación.
- Una factura anterior a la solicitud identifica una compra retroactiva; debe medirse y confirmarse.
- La evidencia de aprobación y la trazabilidad forman parte del soporte de auditoría.
- La creación en SAP debe ser idempotente por `solicitud_id`.
- Un caso nuevo (no precargado) se ingiere desde sus documentos reales: Excel de solicitud, PDF o texto de cotización, correo de aprobación exportado como `.eml`, y factura opcional. La extracción determinística tiene prioridad; solo se recurre al modelo cuando el documento no calza con el formato esperado, y aun así el resultado se valida con las mismas reglas que un caso de fixtures antes de aceptarlo.
