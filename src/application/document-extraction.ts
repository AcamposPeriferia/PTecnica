import "server-only";

import readXlsxFile, { type CellValue, type Row } from "read-excel-file/node";
import { simpleParser, type AddressObject } from "mailparser";
import { extractText } from "unpdf";
import { aprobacionSchema, solicitudSchema, type Aprobacion, type Solicitud } from "@/domain/schemas";
import { parseCotizacion, parseFactura } from "@/domain/parsers";
import { normalizeText, parseCop } from "@/domain/normalization";
import type { Cotizacion, DocumentKind, Factura } from "@/domain/types";
import { extractInvoiceWithLlm, extractQuoteWithLlm, extractRequestWithLlm, isLlmConfigured } from "@/infrastructure/openai-extractor";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_FILE_COUNT = 4;

const aliases: Record<keyof Solicitud, string[]> = {
  solicitud_id: ["solicitudid", "idsolicitud", "numerosolicitud", "solicitud"],
  solicitante: ["solicitante", "nombre solicitante", "requirente"],
  proveedor_nombre: ["proveedornombre", "nombreproveedor", "proveedor"],
  proveedor_nit: ["proveedornit", "nitproveedor", "nit"],
  descripcion: ["descripcion", "concepto", "objetocompra", "detalle"],
  centro_costo: ["centrocosto", "centrodecosto", "ccosto"],
  subarea: ["subarea", "area", "sub area"],
  cantidad: ["cantidad", "unidades"],
  valor_unitario: ["valorunitario", "preciounitario", "unitario"],
  valor_total: ["valortotal", "total", "montototal"],
  moneda: ["moneda", "currency"],
  indicador_iva: ["indicadoriva", "iva", "codigoiva"],
  condiciones_pago: ["condicionespago", "condicionpago", "formapago"],
  fecha_solicitud: ["fechasolicitud", "fecha"],
};

function normalizeHeader(value: unknown): string {
  return normalizeText(String(value ?? ""));
}

function fieldFor(value: unknown): keyof Solicitud | undefined {
  const normalized = normalizeHeader(value);
  return (Object.entries(aliases) as [keyof Solicitud, string[]][]).find(([, names]) =>
    names.some((name) => normalizeText(name) === normalized),
  )?.[0];
}

function dateValue(value: CellValue): string | CellValue {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20_000 && value < 80_000) {
    return new Date(Math.round((value - 25_569) * 86_400_000)).toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const iso = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (iso) return iso;
  }
  return value;
}

function numberValue(value: CellValue): number | CellValue {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseCop(value);
  return value;
}

function normalizeRequestValue(field: keyof Solicitud, value: CellValue): unknown {
  if (field === "cantidad" || field === "valor_unitario" || field === "valor_total") return numberValue(value);
  if (field === "fecha_solicitud") return dateValue(value);
  return typeof value === "string" ? value.trim() : value;
}

export function parseSolicitudRows(rows: Row[]): { solicitud?: Solicitud; rawText: string; errors: string[] } {
  const values: Partial<Record<keyof Solicitud, unknown>> = {};
  const rawText = rows.map((row) => row.filter((cell) => cell !== null).map(String).join(" | ")).filter(Boolean).join("\n");

  for (const row of rows) {
    for (let index = 0; index < row.length - 1; index += 1) {
      const field = fieldFor(row[index]);
      const value = row[index + 1];
      if (field && value !== null && value !== "") values[field] = normalizeRequestValue(field, value);
    }
  }

  for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex += 1) {
    const headers = rows[rowIndex];
    const data = rows[rowIndex + 1];
    const recognizedHeaders = headers.filter((header) => fieldFor(header)).length;
    if (recognizedHeaders < 2) continue;
    headers.forEach((header, columnIndex) => {
      const field = fieldFor(header);
      const value = data[columnIndex];
      if (field && value !== null && value !== "") values[field] = normalizeRequestValue(field, value);
    });
  }

  const parsed = solicitudSchema.safeParse(values);
  return parsed.success
    ? { solicitud: parsed.data, rawText, errors: [] }
    : { rawText, errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
}

export async function extractSolicitud(buffer: Buffer): Promise<{ value?: Solicitud; method?: "deterministico" | "llm"; detail: string }> {
  const sheets = await readXlsxFile(buffer);
  const parsed = parseSolicitudRows(sheets.flatMap((sheet) => sheet.data));
  if (parsed.solicitud) return { value: parsed.solicitud, method: "deterministico", detail: `${sheets.length} hoja(s), campos estructurados` };
  if (isLlmConfigured()) {
    const value = await extractRequestWithLlm(parsed.rawText);
    return { value, method: "llm", detail: "Estructura ambigua resuelta con salida validada" };
  }
  return { detail: `No se reconocieron todos los campos: ${parsed.errors.slice(0, 3).join("; ")}` };
}

export async function extractPdf(buffer: Buffer, kind: "cotizacion" | "factura"): Promise<{
  value?: Cotizacion | Factura;
  method?: "deterministico" | "llm";
  pages: number;
  detail: string;
}> {
  const extracted = await extractText(new Uint8Array(buffer), { mergePages: true });
  const text = extracted.text.trim();
  if (!text) return { pages: extracted.totalPages, detail: "El PDF no contiene texto seleccionable; requiere OCR o LLM multimodal" };
  try {
    const value = kind === "cotizacion" ? parseCotizacion(text) : parseFactura(text);
    return { value, method: "deterministico", pages: extracted.totalPages, detail: `${extracted.totalPages} página(s), texto y campos reconocidos` };
  } catch (error) {
    if (isLlmConfigured()) {
      const value = kind === "cotizacion" ? await extractQuoteWithLlm(text) : await extractInvoiceWithLlm(text);
      return { value, method: "llm", pages: extracted.totalPages, detail: "Formato libre resuelto con salida validada" };
    }
    return { pages: extracted.totalPages, detail: error instanceof Error ? error.message : "Formato PDF no reconocido" };
  }
}

function firstAddress(address?: AddressObject | AddressObject[]): string {
  const item = Array.isArray(address) ? address[0] : address;
  return item?.value[0]?.address ?? "";
}

function allAddresses(address?: AddressObject | AddressObject[]): string[] {
  const items = Array.isArray(address) ? address : address ? [address] : [];
  return items.flatMap((item) => item.value.map((entry) => entry.address).filter((value): value is string => Boolean(value)));
}

export async function extractApproval(buffer: Buffer): Promise<{ value: Aprobacion; method: "deterministico"; detail: string }> {
  const email = await simpleParser(buffer, { skipHtmlToText: false, skipTextToHtml: true });
  const value = aprobacionSchema.parse({
    de: firstAddress(email.from),
    para: firstAddress(email.to),
    cc: allAddresses(email.cc),
    fecha: (email.date ?? new Date(0)).toISOString(),
    asunto: email.subject ?? "Sin asunto",
    cuerpo: email.text?.trim() ?? "",
  });
  return { value, method: "deterministico", detail: "Cabeceras y cuerpo del correo reconocidos" };
}

export function classifyDocument(file: File): DocumentKind {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return "solicitud";
  if (name.endsWith(".eml")) return "aprobacion";
  if (name.endsWith(".pdf") && /factura|invoice/.test(name)) return "factura";
  if (name.endsWith(".pdf")) return "cotizacion";
  return "desconocido";
}

export function validateSignature(kind: DocumentKind, buffer: Buffer): boolean {
  if (kind === "solicitud") return buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (kind === "cotizacion" || kind === "factura") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (kind === "aprobacion") {
    const head = buffer.subarray(0, Math.min(buffer.length, 8192)).toString("utf8");
    return /^(From|De|Date|Fecha|Subject|Asunto):/im.test(head);
  }
  return false;
}
