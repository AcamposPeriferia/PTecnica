import { z } from "zod";

export interface ToolContext {
  directory: string;
  sessionId: string;
  outputDirectory?: string;
}

export interface ToolDefinition<TArgs extends z.ZodRawShape = z.ZodRawShape> {
  description: string;
  args: TArgs;
  execute(args: z.infer<z.ZodObject<TArgs>>, ctx: ToolContext): Promise<string>;
}

export const normalizedRequestSchema = z.object({
  solicitud_id: z.string(),
  solicitante: z.string(),
  proveedor_nombre: z.string(),
  proveedor_nit: z.string().optional(),
  descripcion: z.string(),
  centro_costo: z.string(),
  subarea: z.string(),
  cantidad: z.number(),
  valor_unitario: z.number(),
  valor_total: z.number(),
  moneda: z.string(),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: z.string(),
});

export const normalizedPackageSchema = z.object({
  correo: z.object({
    id: z.string(),
    de: z.string(),
    asunto: z.string(),
    fecha: z.string(),
  }),
  solicitud: normalizedRequestSchema,
  cotizacion: z
    .object({
      referencia: z.string(),
      proveedor: z.string(),
      nit: z.string().nullable(),
      total: z.number(),
      moneda: z.string(),
      validez_hasta: z.string().nullable(),
      texto: z.string(),
    })
    .nullable(),
  aprobacion: z
    .object({
      de: z.string(),
      fecha: z.string(),
      aprobado: z.boolean(),
      texto: z.string(),
    })
    .nullable(),
  factura: z
    .object({
      numero: z.string(),
      fecha: z.string(),
      total: z.number(),
    })
    .nullable(),
  faltantes: z.array(z.string()),
});

export type NormalizedPackage = z.infer<typeof normalizedPackageSchema>;

export const issueSchema = z.object({
  codigo: z.string(),
  detalle: z.string(),
});

export const derivedSchema = z.object({
  proveedor_codigo_sap: z.string().nullable(),
  proveedor_nit: z.string().nullable(),
  indicador_iva: z.string().nullable(),
  condiciones_pago: z.string().nullable(),
});

export type DerivedValues = z.infer<typeof derivedSchema>;

export const validationSchema = z.object({
  apta: z.boolean(),
  bloqueos: z.array(issueSchema),
  confirmaciones: z.array(issueSchema),
  derivados: derivedSchema,
  retroactiva: z.boolean(),
});

export type ValidationResult = z.infer<typeof validationSchema>;

export const orderSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({
    codigo_sap: z.string(),
    nit: z.string(),
    nombre: z.string(),
  }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({
    email: z.string(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string(),
  }),
  posiciones: z.array(
    z.object({
      numero: z.number().int().positive(),
      descripcion: z.string().max(40),
      cantidad: z.number().positive(),
      unidad: z.enum(["UN", "H", "MES"]),
      precio_unitario: z.number().nonnegative(),
      centro_costo: z.string(),
      subarea: z.string(),
      indicador_iva: z.string(),
    }),
  ),
  excepciones: z.array(
    z.object({
      codigo: z.string(),
      detalle: z.string(),
      confirmado_por: z.string().nullable(),
    }),
  ),
});

export type OrdenCompra = z.infer<typeof orderSchema>;

export interface ToolCallView {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  toolCalls?: ToolCallView[];
  needsConfirmation?: boolean;
}
