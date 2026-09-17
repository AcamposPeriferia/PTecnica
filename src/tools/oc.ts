import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import { aprobacionSchema, centroCostoSchema, condicionPagoSchema, correoSchema, indicadorIvaSchema, proveedorSchema, solicitudSchema } from "@/domain/schemas";
import { normalizeNit, normalizeText } from "@/domain/normalization";
import { parseCotizacion, parseFactura, type Cotizacion, type Factura } from "@/domain/parsers";
import { extractApproval, extractInvoice, extractQuote, extractSolicitud, validateSignature } from "@/tools/ingest";
import { FileSapAdapter } from "@/sap/mock";
import {
  derivedSchema,
  normalizedPackageSchema,
  orderSchema,
  type DerivedValues,
  type NormalizedPackage,
  type OrdenCompra,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from "./types";

const CASO_PATTERN = /^[a-z][a-z0-9-]{2,39}$/;
const FIXTURE_CASO_PATTERN = /^sol-\d{3}$/;

const caseShape = {
  caso: z.string().regex(CASO_PATTERN).describe("Nombre del caso: sol-001..sol-006 (fixtures) o el identificador devuelto por oc_ingerir_paquete"),
};

function result(data: unknown): string {
  return JSON.stringify({ ok: true, data });
}

function failure(error: unknown): string {
  return JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "Error desconocido al ejecutar la herramienta",
  });
}

function outputRoot(ctx: ToolContext): string {
  return ctx.outputDirectory ?? path.join(ctx.directory, "out");
}

function caseDirectory(directory: string, outputDirectory: string, caso: string): string {
  if (!CASO_PATTERN.test(caso)) throw new Error("El nombre del caso no es válido");
  if (FIXTURE_CASO_PATTERN.test(caso)) return path.join(directory, "fixtures", "solicitudes", caso);
  return path.join(outputDirectory, "casos", caso);
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function readPackage(directory: string, outputDirectory: string, caso: string): Promise<NormalizedPackage> {
  const folder = caseDirectory(directory, outputDirectory, caso);
  const [mailText, requestText, quoteText, quoteJson, approvalText, invoiceText, invoiceJson] = await Promise.all([
    readOptional(path.join(folder, "correo.json")),
    readOptional(path.join(folder, "solicitud.json")),
    readOptional(path.join(folder, "cotizacion.txt")),
    readOptional(path.join(folder, "cotizacion.json")),
    readOptional(path.join(folder, "aprobacion.json")),
    readOptional(path.join(folder, "factura.txt")),
    readOptional(path.join(folder, "factura.json")),
  ]);

  if (!mailText) throw new Error("Falta correo.json; no es posible identificar el paquete");
  if (!requestText) throw new Error("Falta solicitud.json; solicite nuevamente el formato de compra");

  const correo = correoSchema.parse(JSON.parse(mailText));
  const solicitud = solicitudSchema.parse(JSON.parse(requestText));
  const faltantes: string[] = [];

  // cotizacion.json / factura.json existen solo para casos ingeridos desde documentos reales
  // (oc_ingerir_paquete): ya vienen estructurados, así que se usan directo en vez de
  // re-parsear con la expresión regular pensada para el formato de texto de los fixtures.
  let cotizacion: NormalizedPackage["cotizacion"] = null;
  if (quoteJson) {
    const parsed = JSON.parse(quoteJson) as Cotizacion;
    cotizacion = {
      referencia: parsed.numero,
      proveedor: parsed.proveedorNombre,
      nit: parsed.proveedorNit || null,
      total: parsed.total,
      moneda: parsed.moneda,
      validez_hasta: addDays(parsed.fecha, parsed.validezDias),
      texto: quoteText ?? JSON.stringify(parsed),
    };
  } else if (quoteText) {
    const parsed = parseCotizacion(quoteText);
    cotizacion = {
      referencia: parsed.numero,
      proveedor: parsed.proveedorNombre,
      nit: parsed.proveedorNit || null,
      total: parsed.total,
      moneda: parsed.moneda,
      validez_hasta: addDays(parsed.fecha, parsed.validezDias),
      texto: quoteText,
    };
  } else {
    faltantes.push("cotizacion");
  }

  let aprobacion: NormalizedPackage["aprobacion"] = null;
  if (approvalText) {
    const parsed = aprobacionSchema.parse(JSON.parse(approvalText));
    aprobacion = {
      de: parsed.de,
      fecha: parsed.fecha,
      aprobado: /\baprobado(?:a)?\b/i.test(parsed.cuerpo),
      texto: parsed.cuerpo,
    };
  } else {
    faltantes.push("aprobacion");
  }

  let factura: NormalizedPackage["factura"] = null;
  if (invoiceJson) {
    const parsed = JSON.parse(invoiceJson) as Factura;
    factura = { numero: parsed.numero, fecha: parsed.fecha, total: parsed.total };
  } else if (invoiceText) {
    const parsed = parseFactura(invoiceText);
    factura = { numero: parsed.numero, fecha: parsed.fecha, total: parsed.total };
  }

  return normalizedPackageSchema.parse({
    correo: { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha },
    solicitud,
    cotizacion,
    aprobacion,
    factura,
    faltantes,
  });
}

async function loadMasters(directory: string) {
  const masterDirectory = path.join(directory, "fixtures", "maestros");
  const [providers, centers, taxes, payments] = await Promise.all([
    readFile(path.join(masterDirectory, "proveedores.json"), "utf8"),
    readFile(path.join(masterDirectory, "centros-costo.json"), "utf8"),
    readFile(path.join(masterDirectory, "indicadores-iva.json"), "utf8"),
    readFile(path.join(masterDirectory, "condiciones-pago.json"), "utf8"),
  ]);
  return {
    proveedores: z.array(proveedorSchema).parse(JSON.parse(providers)),
    centros: z.array(centroCostoSchema).parse(JSON.parse(centers)),
    indicadoresIva: z.array(indicadorIvaSchema).parse(JSON.parse(taxes)),
    condicionesPago: z.array(condicionPagoSchema).parse(JSON.parse(payments)),
  };
}

export async function validatePackage(paquete: NormalizedPackage, directory: string): Promise<ValidationResult> {
  const masters = await loadMasters(directory);
  const { solicitud, cotizacion, aprobacion, factura } = paquete;
  const bloqueos: ValidationResult["bloqueos"] = [];
  const confirmaciones: ValidationResult["confirmaciones"] = [];

  const candidateNit = solicitud.proveedor_nit ?? cotizacion?.nit ?? undefined;
  const provider = masters.proveedores.find(
    (item) =>
      (candidateNit && normalizeNit(item.nit) === normalizeNit(candidateNit)) ||
      normalizeText(item.nombre) === normalizeText(solicitud.proveedor_nombre),
  );

  if (!provider) {
    bloqueos.push({ codigo: "RC1_PROVEEDOR_NO_EXISTE", detalle: "El proveedor no existe en el maestro por NIT ni por nombre normalizado." });
  } else if (!provider.activo) {
    bloqueos.push({ codigo: "RC1_PROVEEDOR_INACTIVO", detalle: `${provider.nombre} está inactivo en el maestro.` });
  }

  const center = masters.centros.find((item) => item.centro_costo === solicitud.centro_costo);
  if (!center || !center.subareas.includes(solicitud.subarea)) {
    bloqueos.push({ codigo: "RC4_IMPUTACION_INVALIDA", detalle: `${solicitud.subarea} no pertenece al centro ${solicitud.centro_costo}.` });
  }

  const approver = aprobacion && center
    ? center.aprobadores.find((item) => item.email.toLowerCase() === aprobacion.de.toLowerCase())
    : undefined;
  if (!aprobacion || !aprobacion.aprobado) {
    bloqueos.push({ codigo: "RC2_APROBACION_INVALIDA", detalle: "Falta una aprobación explícita con la palabra Aprobado." });
  } else if (!approver) {
    bloqueos.push({ codigo: "RC2_APROBADOR_SIN_AUTORIDAD", detalle: `${aprobacion.de} no es aprobador del centro ${solicitud.centro_costo}.` });
  } else if (solicitud.valor_total > approver.tope) {
    bloqueos.push({ codigo: "RC3_TOPE_EXCEDIDO", detalle: `El total supera el tope de ${approver.tope} autorizado para ${approver.nombre}.` });
  }

  if (Math.abs(solicitud.cantidad * solicitud.valor_unitario - solicitud.valor_total) > 1) {
    bloqueos.push({ codigo: "RC10_ARITMETICA_INVALIDA", detalle: "Cantidad por valor unitario no coincide con el total dentro de la tolerancia de 1 COP." });
  }

  if (!cotizacion) {
    confirmaciones.push({ codigo: "RC5_SIN_COTIZACION", detalle: "No hay cotización; confirme si autoriza continuar sin ella." });
  } else {
    const difference = Math.abs(cotizacion.total - solicitud.valor_total) / Math.max(solicitud.valor_total, 1);
    if (difference > 0.02) {
      confirmaciones.push({
        codigo: "RC5_DIFERENCIA_COTIZACION",
        detalle: `Solicitud: ${solicitud.valor_total} ${solicitud.moneda}; cotización: ${cotizacion.total} ${cotizacion.moneda}; diferencia ${(difference * 100).toFixed(2)} %.`,
      });
    }
  }

  const indicadorIva = solicitud.indicador_iva ?? provider?.indicador_iva_default ?? null;
  if (!solicitud.indicador_iva && indicadorIva) {
    confirmaciones.push({ codigo: "RC6_IVA_DERIVADO", detalle: `El indicador de IVA ausente se derivó como ${indicadorIva}; confirme su uso.` });
  }
  const condicionesPago = solicitud.condiciones_pago ?? provider?.condiciones_pago_default ?? null;

  if (indicadorIva && !masters.indicadoresIva.some((item) => item.codigo === indicadorIva)) {
    bloqueos.push({ codigo: "IVA_DESCONOCIDO", detalle: `${indicadorIva} no existe en el maestro de indicadores de IVA.` });
  }
  if (condicionesPago && !masters.condicionesPago.some((item) => item.codigo === condicionesPago)) {
    bloqueos.push({ codigo: "PAGO_DESCONOCIDO", detalle: `${condicionesPago} no existe en el maestro de condiciones de pago.` });
  }

  const retroactiva = Boolean(factura && factura.fecha < solicitud.fecha_solicitud);
  if (retroactiva) {
    confirmaciones.push({ codigo: "RC8_COMPRA_RETROACTIVA", detalle: `La factura ${factura?.numero} es anterior a la solicitud; confirme la excepción.` });
  }

  if (aprobacion && aprobacion.fecha.slice(0, 10) < solicitud.fecha_solicitud) {
    confirmaciones.push({ codigo: "RC9_APROBACION_ANTERIOR", detalle: "La aprobación es anterior a la fecha de solicitud; confirme la cronología." });
  }

  const derivados: DerivedValues = {
    proveedor_codigo_sap: provider?.codigo_sap ?? null,
    proveedor_nit: provider ? normalizeNit(provider.nit) : candidateNit ? normalizeNit(candidateNit) : null,
    indicador_iva: indicadorIva,
    condiciones_pago: condicionesPago,
  };

  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva };
}

async function appendControl(
  ctx: ToolContext,
  paquete: NormalizedPackage,
  validation: ValidationResult,
  resultado: string,
  numeroOc = "",
) {
  const root = outputRoot(ctx);
  await mkdir(root, { recursive: true });
  const file = path.join(root, "control.csv");
  const header = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n";
  try {
    await readFile(file, "utf8");
  } catch {
    await writeFile(file, header, "utf8");
  }
  const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const row = [
    paquete.solicitud.solicitud_id,
    resultado,
    numeroOc,
    String(validation.retroactiva),
    quoted(validation.bloqueos.map((item) => item.codigo).join("|")),
    quoted(validation.confirmaciones.map((item) => item.codigo).join("|")),
    new Date().toISOString(),
  ].join(",");
  await appendFile(file, `${row}\n`, "utf8");
}

async function evidenceContent(directory: string, outputDirectory: string, caso: string) {
  const raw = await readFile(path.join(caseDirectory(directory, outputDirectory, caso), "aprobacion.json"), "utf8");
  const approval = aprobacionSchema.parse(JSON.parse(raw));
  const content = [
    `De: ${approval.de}`,
    `Para: ${approval.para}`,
    `CC: ${approval.cc.join(", ")}`,
    `Fecha: ${approval.fecha}`,
    `Asunto: ${approval.asunto}`,
    "",
    approval.cuerpo,
  ].join("\n");
  return { content, sha256: createHash("sha256").update(content, "utf8").digest("hex") };
}

function wrapLines(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(" ")) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

async function writeEvidencePdf(content: string, sha256: string, destination: string): Promise<void> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;
  const lineHeight = fontSize * 1.4;
  const margin = 50;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const lines = [...wrapLines(content, 92), "", `SHA-256: ${sha256}`];

  let page = document.addPage([pageWidth, pageHeight]);
  let cursor = pageHeight - margin;
  for (const line of lines) {
    if (cursor < margin) {
      page = document.addPage([pageWidth, pageHeight]);
      cursor = pageHeight - margin;
    }
    page.drawText(line, { x: margin, y: cursor, size: fontSize, font, color: rgb(0, 0, 0) });
    cursor -= lineHeight;
  }
  await writeFile(destination, await document.save());
}

function inferUnit(description: string): "UN" | "H" | "MES" {
  const normalized = normalizeText(description);
  if (normalized.includes("hora")) return "H";
  if (normalized.includes("mes") || normalized.includes("licencia")) return "MES";
  return "UN";
}

async function buildOrder(
  caso: string,
  paquete: NormalizedPackage,
  directory: string,
  outputDirectory: string,
): Promise<{ orden: OrdenCompra; trazabilidad: Record<string, string> }> {
  const validation = await validatePackage(paquete, directory);
  if (!validation.apta) throw new Error(`No se puede construir la OC: ${validation.bloqueos.map((item) => item.detalle).join(" ")}`);
  if (!paquete.aprobacion) throw new Error("No existe evidencia de aprobación");
  const providerName = paquete.solicitud.proveedor_nombre;
  const { sha256 } = await evidenceContent(directory, outputDirectory, caso);
  const order = orderSchema.parse({
    referencia: {
      solicitud_id: paquete.solicitud.solicitud_id,
      correo_id: paquete.correo.id,
      cotizacion_ref: paquete.cotizacion?.referencia ?? null,
    },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: {
      codigo_sap: validation.derivados.proveedor_codigo_sap,
      nit: validation.derivados.proveedor_nit,
      nombre: providerName,
    },
    moneda: paquete.solicitud.moneda,
    condiciones_pago: validation.derivados.condiciones_pago,
    aprobador: {
      email: paquete.aprobacion.de,
      fecha_aprobacion: paquete.aprobacion.fecha,
      evidencia_sha256: sha256,
    },
    posiciones: [
      {
        numero: 10,
        descripcion: paquete.solicitud.descripcion.slice(0, 40),
        cantidad: paquete.solicitud.cantidad,
        unidad: inferUnit(paquete.solicitud.descripcion),
        precio_unitario: paquete.solicitud.valor_unitario,
        centro_costo: paquete.solicitud.centro_costo,
        subarea: paquete.solicitud.subarea,
        indicador_iva: validation.derivados.indicador_iva,
      },
    ],
    excepciones: validation.confirmaciones.map((item) => ({ ...item, confirmado_por: null })),
  });
  const trace = {
    "referencia.solicitud_id": "solicitud.solicitud_id",
    "referencia.correo_id": "correo.id",
    "referencia.cotizacion_ref": "cotizacion.referencia",
    "proveedor.codigo_sap": "maestro.proveedores.codigo_sap",
    "proveedor.nit": paquete.solicitud.proveedor_nit ? "solicitud.proveedor_nit" : "derivado.maestro.proveedores.nit",
    moneda: "solicitud.moneda",
    condiciones_pago: paquete.solicitud.condiciones_pago ? "solicitud.condiciones_pago" : "derivado.maestro.proveedores.condiciones_pago_default",
    "aprobador.email": "aprobacion.de",
    posiciones: "solicitud",
    indicador_iva: paquete.solicitud.indicador_iva ? "solicitud.indicador_iva" : "derivado.maestro.proveedores.indicador_iva_default",
  };
  return { orden: order, trazabilidad: trace };
}

export const leer_paquete: ToolDefinition<typeof caseShape> = {
  description: "Lee y normaliza el correo, solicitud, cotización, aprobación y factura opcional de un caso.",
  args: caseShape,
  async execute({ caso }, ctx) {
    try {
      return result(await readPackage(ctx.directory, outputRoot(ctx), caso));
    } catch (error) {
      return failure(error);
    }
  },
};

const validateShape = {
  caso: caseShape.caso,
  paquete: normalizedPackageSchema.describe("Paquete normalizado devuelto por oc_leer_paquete"),
};

export const validar: ToolDefinition<typeof validateShape> = {
  description: "Aplica RC1 a RC10 y devuelve bloqueos, confirmaciones, derivados y la marca retroactiva.",
  args: validateShape,
  async execute({ paquete }, ctx) {
    try {
      const parsed = normalizedPackageSchema.parse(paquete);
      const validation = await validatePackage(parsed, ctx.directory);
      const status = !validation.apta ? "BLOQUEADO" : validation.confirmaciones.length ? "PENDIENTE_CONFIRMACION" : "APTO";
      await appendControl(ctx, parsed, validation, status);
      return result(validation);
    } catch (error) {
      return failure(error);
    }
  },
};

const payloadShape = {
  caso: caseShape.caso,
  paquete: normalizedPackageSchema.describe("Paquete normalizado y validado"),
  derivados: derivedSchema.describe("Valores derivados devueltos por oc_validar"),
};

export const construir_payload: ToolDefinition<typeof payloadShape> = {
  description: "Construye y valida el payload SAP y escribe la trazabilidad de cada valor.",
  args: payloadShape,
  async execute({ caso, paquete, derivados }, ctx) {
    try {
      normalizedPackageSchema.parse(paquete);
      derivedSchema.parse(derivados);
      const built = await buildOrder(caso, paquete, ctx.directory, outputRoot(ctx));
      const directory = path.join(outputRoot(ctx), caso);
      await mkdir(directory, { recursive: true });
      const tracePath = path.join(directory, "trazabilidad.json");
      await writeFile(tracePath, JSON.stringify(built.trazabilidad, null, 2), "utf8");
      return result({ orden: built.orden, trazabilidad: tracePath });
    } catch (error) {
      return failure(error);
    }
  },
};

export const generar_evidencia: ToolDefinition<typeof caseShape> = {
  description: "Genera la evidencia de aprobación en texto y PDF con encabezados y hash SHA-256.",
  args: caseShape,
  async execute({ caso }, ctx) {
    try {
      const evidence = await evidenceContent(ctx.directory, outputRoot(ctx), caso);
      const directory = path.join(outputRoot(ctx), caso);
      await mkdir(directory, { recursive: true });
      const file = path.join(directory, "aprobacion.txt");
      await writeFile(file, `${evidence.content}\n\nSHA-256: ${evidence.sha256}\n`, "utf8");
      const pdfFile = path.join(directory, "aprobacion.pdf");
      await writeEvidencePdf(evidence.content, evidence.sha256, pdfFile);
      return result({ ruta: file, ruta_pdf: pdfFile, sha256: evidence.sha256 });
    } catch (error) {
      return failure(error);
    }
  },
};

const createShape = {
  caso: caseShape.caso,
  payload: orderSchema.describe("Payload validado de la orden de compra"),
  confirmado: z.boolean().optional().describe("True únicamente si el usuario confirmó todas las excepciones"),
};

export const crear: ToolDefinition<typeof createShape> = {
  description: "Crea idempotentemente la OC en SAP simulado si no hay bloqueos y las excepciones fueron confirmadas.",
  args: createShape,
  async execute({ caso, payload, confirmado }, ctx) {
    try {
      const paquete = await readPackage(ctx.directory, outputRoot(ctx), caso);
      const validation = await validatePackage(paquete, ctx.directory);
      if (!validation.apta) {
        await appendControl(ctx, paquete, validation, "BLOQUEADO");
        return failure(`La OC está bloqueada: ${validation.bloqueos.map((item) => item.detalle).join(" ")}`);
      }
      if (validation.confirmaciones.length && confirmado !== true) {
        await appendControl(ctx, paquete, validation, "PENDIENTE_CONFIRMACION");
        return failure(`Se requiere confirmación humana: ${validation.confirmaciones.map((item) => item.detalle).join(" ")}`);
      }

      const order = orderSchema.parse(payload);
      if (order.referencia.solicitud_id !== paquete.solicitud.solicitud_id) {
        return failure("El payload no corresponde al caso solicitado");
      }
      order.excepciones = order.excepciones.map((item) => ({
        ...item,
        confirmado_por: validation.confirmaciones.length ? ctx.sessionId : item.confirmado_por,
      }));

      const root = outputRoot(ctx);
      const sap = new FileSapAdapter(ctx.directory, root);
      const existing = await sap.buscarOrdenPorReferencia(order.referencia.solicitud_id);
      const created = await sap.crearOrden(order);
      await appendControl(ctx, paquete, validation, "CREADA", created.numero_oc);
      return result({ ...created, idempotente: Boolean(existing), retroactiva: validation.retroactiva });
    } catch (error) {
      return failure(error);
    }
  },
};

async function findUploaded(dir: string, base: string, exts: string[]): Promise<{ buffer: Buffer; ext: string } | null> {
  for (const ext of exts) {
    try {
      // Ruta bajo out/uploads/ (out/tmp en runtime), nunca parte del árbol de código fuente;
      // se excluye del rastreo de archivos de Next para no incluir todo el proyecto.
      const buffer = await readFile(path.join(/* turbopackIgnore: true */ dir, `${base}.${ext}`));
      return { buffer, ext };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return null;
}

const ingestShape = {
  caso: z
    .string()
    .regex(CASO_PATTERN)
    .refine((value) => !FIXTURE_CASO_PATTERN.test(value), "sol-NNN está reservado a los casos de fixtures; use otro identificador")
    .describe("Identificador nuevo para este caso, por ejemplo compra-acme-2026-09"),
  uploadId: z.string().regex(/^[a-f0-9-]{8,64}$/).describe("Identificador devuelto por /api/uploads al subir los documentos del caso"),
  remitente: z.string().email().describe("Correo de quien solicitó la compra, para registrar el correo original"),
  asunto: z.string().min(1).max(200).optional().describe("Asunto de la solicitud original, si se conoce"),
};

export const ingerir_paquete: ToolDefinition<typeof ingestShape> = {
  description:
    "Extrae un caso nuevo (Excel de solicitud, PDF/txt de cotización, correo .eml de aprobación, factura opcional) desde archivos ya subidos con /api/uploads y lo deja listo para oc_leer_paquete.",
  args: ingestShape,
  async execute({ caso, uploadId, remitente, asunto }, ctx) {
    try {
      const rawDir = path.join(outputRoot(ctx), "uploads", uploadId, "raw");

      const solicitudFile = await findUploaded(rawDir, "solicitud", ["xlsx"]);
      if (!solicitudFile) throw new Error("No se encontró solicitud.xlsx en los archivos subidos");
      const cotizacionFile = await findUploaded(rawDir, "cotizacion", ["pdf", "txt"]);
      if (!cotizacionFile) throw new Error("No se encontró cotizacion.pdf ni cotizacion.txt en los archivos subidos");
      const aprobacionFile = await findUploaded(rawDir, "aprobacion", ["eml"]);
      if (!aprobacionFile) throw new Error("No se encontró aprobacion.eml en los archivos subidos");
      const facturaFile = await findUploaded(rawDir, "factura", ["pdf", "txt"]);

      if (!validateSignature("solicitud", false, solicitudFile.buffer)) throw new Error("solicitud.xlsx no tiene una firma de archivo Excel válida");
      if (!validateSignature("cotizacion", cotizacionFile.ext === "pdf", cotizacionFile.buffer)) {
        throw new Error("cotizacion no tiene una firma de archivo válida para su extensión");
      }
      if (!validateSignature("aprobacion", false, aprobacionFile.buffer)) {
        throw new Error("aprobacion.eml no parece un correo (faltan cabeceras De/Fecha/Asunto)");
      }
      if (facturaFile && !validateSignature("factura", facturaFile.ext === "pdf", facturaFile.buffer)) {
        throw new Error("factura no tiene una firma de archivo válida para su extensión");
      }

      const solicitudResult = await extractSolicitud(solicitudFile.buffer);
      const cotizacionResult = await extractQuote(cotizacionFile.buffer, cotizacionFile.ext === "pdf");
      const aprobacionResult = await extractApproval(aprobacionFile.buffer);
      const facturaResult = facturaFile ? await extractInvoice(facturaFile.buffer, facturaFile.ext === "pdf") : null;

      const missing: string[] = [];
      if (!solicitudResult.value) missing.push(`solicitud: ${solicitudResult.detail}`);
      if (!cotizacionResult.value) missing.push(`cotización: ${cotizacionResult.detail}`);
      if (!aprobacionResult.value) missing.push(`aprobación: ${aprobacionResult.detail}`);
      if (facturaFile && facturaResult && !facturaResult.value) missing.push(`factura: ${facturaResult.detail}`);
      if (missing.length) throw new Error(`No fue posible extraer todos los documentos: ${missing.join(" | ")}`);

      const solicitudValue = solicitudResult.value as NonNullable<typeof solicitudResult.value>;
      const cotizacionValue = cotizacionResult.value as NonNullable<typeof cotizacionResult.value>;
      const aprobacionValue = aprobacionResult.value as NonNullable<typeof aprobacionResult.value>;

      const documentos = [
        { archivo: "solicitud.xlsx", metodo: solicitudResult.method, detalle: solicitudResult.detail },
        { archivo: `cotizacion.${cotizacionFile.ext}`, metodo: cotizacionResult.method, detalle: cotizacionResult.detail, paginas: cotizacionResult.pages },
        { archivo: "aprobacion.eml", metodo: aprobacionResult.method, detalle: aprobacionResult.detail },
        ...(facturaFile && facturaResult
          ? [{ archivo: `factura.${facturaFile.ext}`, metodo: facturaResult.method, detalle: facturaResult.detail, paginas: facturaResult.pages }]
          : []),
      ];

      const folder = caseDirectory(ctx.directory, outputRoot(ctx), caso);
      await mkdir(folder, { recursive: true });

      const correo = {
        id: `${caso}-correo`,
        de: remitente,
        para: "compras@periferia-it.com",
        asunto: asunto ?? `Solicitud de compra ${caso}`,
        fecha: `${solicitudValue.fecha_solicitud}T09:00:00-05:00`,
        cuerpo: "Solicitud registrada a partir de documentos cargados por la analista (sin correo original de la solicitud).",
        adjuntos: ["solicitud.xlsx", `cotizacion.${cotizacionFile.ext}`, "aprobacion.eml", ...(facturaFile ? [`factura.${facturaFile.ext}`] : [])],
      };
      correoSchema.parse(correo);

      await writeFile(path.join(folder, "correo.json"), JSON.stringify(correo, null, 2), "utf8");
      await writeFile(path.join(folder, "solicitud.json"), JSON.stringify(solicitudValue, null, 2), "utf8");
      await writeFile(path.join(folder, "cotizacion.txt"), cotizacionResult.text, "utf8");
      await writeFile(path.join(folder, "cotizacion.json"), JSON.stringify(cotizacionValue, null, 2), "utf8");
      await writeFile(path.join(folder, "aprobacion.json"), JSON.stringify(aprobacionValue, null, 2), "utf8");
      if (facturaFile && facturaResult?.value) {
        await writeFile(path.join(folder, "factura.txt"), facturaResult.text, "utf8");
        await writeFile(path.join(folder, "factura.json"), JSON.stringify(facturaResult.value, null, 2), "utf8");
      }

      const paquete = await readPackage(ctx.directory, outputRoot(ctx), caso);
      return result({ caso, paquete, documentos });
    } catch (error) {
      return failure(error);
    }
  },
};

export const ocTools = {
  oc_leer_paquete: leer_paquete,
  oc_validar: validar,
  oc_construir_payload: construir_payload,
  oc_generar_evidencia: generar_evidencia,
  oc_crear: crear,
  oc_ingerir_paquete: ingerir_paquete,
};

export type OcToolName = keyof typeof ocTools;
