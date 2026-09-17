import readXlsxFile, { type CellValue, type Row } from "read-excel-file/node";
import { simpleParser, type AddressObject } from "mailparser";
import { extractText } from "unpdf";
import { aprobacionSchema, solicitudSchema, type Aprobacion, type Solicitud } from "@/domain/schemas";
import { parseCotizacion, parseFactura, type Cotizacion, type Factura } from "@/domain/parsers";
import { normalizeText, parseCop } from "@/domain/normalization";
import { extractInvoiceWithLlm, extractQuoteWithLlm, extractRequestWithLlm, isLlmConfigured } from "./ingest-llm";

// Extracción de documentos reales (Excel/PDF/correo) para dar de alta un caso
// que no viene en fixtures/. Determinístico primero (columnas de Excel, texto de
// PDF con el mismo formato de cotización que ya reconoce parseCotizacion,
// cabeceras de correo); solo si eso falla y hay clave de OpenAI configurada se
// intenta una extracción con LLM, y en cualquiera de los dos casos el resultado
// se vuelve a validar con el mismo zod que usan los casos de fixtures antes de
// aceptarlo — un documento real nunca produce un dato sin pasar por ese filtro.

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export type ExtractionMethod = "deterministico" | "llm";

export interface ExtractionResult<T> {
  value?: T;
  method?: ExtractionMethod;
  detail: string;
}

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

function parseSolicitudRows(rows: Row[]): { solicitud?: Solicitud; rawText: string; errors: string[] } {
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

export async function extractSolicitud(buffer: Buffer): Promise<ExtractionResult<Solicitud>> {
  const sheets = await readXlsxFile(buffer);
  const parsed = parseSolicitudRows(sheets.flatMap((sheet) => sheet.data));
  if (parsed.solicitud) return { value: parsed.solicitud, method: "deterministico", detail: `${sheets.length} hoja(s), campos estructurados` };
  if (isLlmConfigured()) {
    const value = await extractRequestWithLlm(parsed.rawText);
    return { value, method: "llm", detail: "Estructura de Excel ambigua resuelta con salida validada" };
  }
  return { detail: `No se reconocieron todos los campos: ${parsed.errors.slice(0, 3).join("; ")}` };
}

async function documentText(buffer: Buffer, isPdf: boolean): Promise<{ text: string; pages: number }> {
  if (!isPdf) return { text: buffer.toString("utf8").trim(), pages: 1 };
  const extracted = await extractText(new Uint8Array(buffer), { mergePages: true });
  return { text: extracted.text.trim(), pages: extracted.totalPages };
}

export async function extractQuote(buffer: Buffer, isPdf: boolean): Promise<ExtractionResult<Cotizacion> & { pages: number; text: string }> {
  const { text, pages } = await documentText(buffer, isPdf);
  if (!text) return { pages, text, detail: "El archivo no contiene texto legible; si es un PDF escaneado necesita OCR." };
  try {
    return { value: parseCotizacion(text), method: "deterministico", pages, text, detail: `${pages} página(s), campos reconocidos` };
  } catch (error) {
    if (isLlmConfigured()) {
      const value = await extractQuoteWithLlm(text);
      return { value, method: "llm", pages, text, detail: "Formato libre de cotización resuelto con salida validada" };
    }
    return { pages, text, detail: error instanceof Error ? error.message : "Formato de cotización no reconocido" };
  }
}

export async function extractInvoice(buffer: Buffer, isPdf: boolean): Promise<ExtractionResult<Factura> & { pages: number; text: string }> {
  const { text, pages } = await documentText(buffer, isPdf);
  if (!text) return { pages, text, detail: "El archivo no contiene texto legible; si es un PDF escaneado necesita OCR." };
  try {
    return { value: parseFactura(text), method: "deterministico", pages, text, detail: `${pages} página(s), campos reconocidos` };
  } catch (error) {
    if (isLlmConfigured()) {
      const value = await extractInvoiceWithLlm(text);
      return { value, method: "llm", pages, text, detail: "Formato libre de factura resuelto con salida validada" };
    }
    return { pages, text, detail: error instanceof Error ? error.message : "Formato de factura no reconocido" };
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

export async function extractApproval(buffer: Buffer): Promise<ExtractionResult<Aprobacion>> {
  const email = await simpleParser(buffer, { skipHtmlToText: false, skipTextToHtml: true });
  try {
    const value = aprobacionSchema.parse({
      de: firstAddress(email.from),
      para: firstAddress(email.to),
      cc: allAddresses(email.cc),
      fecha: (email.date ?? new Date(0)).toISOString(),
      asunto: email.subject ?? "Sin asunto",
      cuerpo: email.text?.trim() ?? "",
    });
    return { value, method: "deterministico", detail: "Cabeceras y cuerpo del correo reconocidos" };
  } catch (error) {
    return { detail: error instanceof Error ? error.message : "No fue posible leer el correo de aprobación" };
  }
}

export function validateSignature(kind: "solicitud" | "cotizacion" | "factura" | "aprobacion", isPdf: boolean, buffer: Buffer): boolean {
  if (kind === "solicitud") return buffer[0] === 0x50 && buffer[1] === 0x4b; // xlsx = zip
  if ((kind === "cotizacion" || kind === "factura") && isPdf) return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (kind === "aprobacion") {
    const head = buffer.subarray(0, Math.min(buffer.length, 8192)).toString("utf8");
    return /^(From|De|Date|Fecha|Subject|Asunto):/im.test(head);
  }
  return true;
}
