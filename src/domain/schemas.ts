import { z } from "zod";

// Los fixtures contienen direcciones internacionalizadas (p. ej. sofía@...).
// Se valida su estructura sin restringir el local-part a ASCII.
const emailSchema = z.string().trim().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u, "Correo electronico invalido");

export const proveedorSchema = z.object({
  codigo_sap: z.string().min(1),
  nit: z.string().min(1),
  nombre: z.string().min(1),
  condiciones_pago_default: z.string().min(1),
  indicador_iva_default: z.string().min(1),
  activo: z.boolean(),
});

export const centroCostoSchema = z.object({
  centro_costo: z.string().min(1),
  nombre: z.string().min(1),
  subareas: z.array(z.string().min(1)),
  aprobadores: z.array(
    z.object({
      email: emailSchema,
      nombre: z.string().min(1),
      tope: z.number().int().nonnegative(),
    }),
  ),
});

export const indicadorIvaSchema = z.object({
  codigo: z.string().min(1),
  descripcion: z.string().min(1),
  tasa: z.number().min(0).max(1),
});

export const condicionPagoSchema = z.object({
  codigo: z.string().min(1),
  descripcion: z.string().min(1),
  dias: z.number().int().nonnegative(),
});

export const solicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().min(1).optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: z.number().positive(),
  valor_unitario: z.number().int().nonnegative(),
  valor_total: z.number().int().nonnegative(),
  moneda: z.string().length(3),
  indicador_iva: z.string().min(1).optional(),
  condiciones_pago: z.string().min(1).optional(),
  fecha_solicitud: z.iso.date(),
});

export const aprobacionSchema = z.object({
  de: emailSchema,
  para: emailSchema,
  cc: z.array(emailSchema),
  fecha: z.iso.datetime({ offset: true }),
  asunto: z.string().min(1),
  cuerpo: z.string().min(1),
});

export const correoSchema = z.object({
  id: z.string().min(1),
  de: emailSchema,
  para: emailSchema,
  asunto: z.string().min(1),
  fecha: z.iso.datetime({ offset: true }),
  cuerpo: z.string().min(1),
  adjuntos: z.array(z.string().min(1)),
  nota_fixture: z.string().optional(),
});

export const maestrosSchema = z.object({
  proveedores: z.array(proveedorSchema),
  centros: z.array(centroCostoSchema),
  indicadoresIva: z.array(indicadorIvaSchema),
  condicionesPago: z.array(condicionPagoSchema),
});

export type Proveedor = z.infer<typeof proveedorSchema>;
export type CentroCosto = z.infer<typeof centroCostoSchema>;
export type IndicadorIva = z.infer<typeof indicadorIvaSchema>;
export type CondicionPago = z.infer<typeof condicionPagoSchema>;
export type Solicitud = z.infer<typeof solicitudSchema>;
export type Aprobacion = z.infer<typeof aprobacionSchema>;
export type Correo = z.infer<typeof correoSchema>;
export type Maestros = z.infer<typeof maestrosSchema>;
