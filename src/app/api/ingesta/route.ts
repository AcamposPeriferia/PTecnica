import { evaluarExpediente } from "@/domain/evaluate";
import type { Aprobacion, Solicitud } from "@/domain/schemas";
import type { Cotizacion, Factura, IngestionDocument, IngestionResponse } from "@/domain/types";
import {
  classifyDocument,
  extractApproval,
  extractPdf,
  extractSolicitud,
  MAX_FILE_COUNT,
  MAX_UPLOAD_BYTES,
  validateSignature,
} from "@/application/document-extraction";
import { loadMaestros } from "@/infrastructure/file-repository";
import { isLlmConfigured } from "@/infrastructure/openai-extractor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ParsedPackage {
  solicitud?: Solicitud;
  cotizacion?: Cotizacion;
  aprobacion?: Aprobacion;
  factura?: Factura;
}

function safeMessage(error: unknown): string {
  if (!(error instanceof Error)) return "No fue posible extraer el documento";
  return error.message.replace(/[\r\n]+/g, " ").slice(0, 240);
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("documents").filter((item): item is File => item instanceof File);
    if (!files.length) return Response.json({ error: "Debe adjuntar al menos un documento." }, { status: 400 });
    if (files.length > MAX_FILE_COUNT) return Response.json({ error: `Se permiten máximo ${MAX_FILE_COUNT} documentos.` }, { status: 413 });
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (totalBytes > MAX_UPLOAD_BYTES) return Response.json({ error: "El paquete supera el límite de 4 MB." }, { status: 413 });

    const parsed: ParsedPackage = {};
    const documents: IngestionDocument[] = [];
    const issues: string[] = [];
    const seenKinds = new Set<string>();

    for (const file of files) {
      const kind = classifyDocument(file);
      if (kind === "desconocido") {
        documents.push({ name: file.name, kind, status: "error", detail: "Tipo de archivo no admitido" });
        issues.push(`${file.name}: solo se admiten PDF, XLSX y EML.`);
        continue;
      }
      if (seenKinds.has(kind)) {
        documents.push({ name: file.name, kind, status: "error", detail: `Ya existe otro documento clasificado como ${kind}` });
        issues.push(`${file.name}: tipo documental duplicado.`);
        continue;
      }
      seenKinds.add(kind);

      const buffer = Buffer.from(await file.arrayBuffer());
      if (!validateSignature(kind, buffer)) {
        documents.push({ name: file.name, kind, status: "error", detail: "La firma del archivo no coincide con su extensión" });
        issues.push(`${file.name}: archivo inválido o extensión incorrecta.`);
        continue;
      }

      try {
        if (kind === "solicitud") {
          const result = await extractSolicitud(buffer);
          if (result.value) parsed.solicitud = result.value;
          documents.push({
            name: file.name,
            kind,
            status: result.value ? "extraido" : "requiere_llm",
            method: result.method,
            detail: result.detail,
          });
        } else if (kind === "aprobacion") {
          const result = await extractApproval(buffer);
          parsed.aprobacion = result.value;
          documents.push({ name: file.name, kind, status: "extraido", method: result.method, detail: result.detail });
        } else {
          const result = await extractPdf(buffer, kind);
          if (kind === "cotizacion" && result.value) parsed.cotizacion = result.value as Cotizacion;
          if (kind === "factura" && result.value) parsed.factura = result.value as Factura;
          documents.push({
            name: file.name,
            kind,
            status: result.value ? "extraido" : "requiere_llm",
            method: result.method,
            pages: result.pages,
            detail: result.detail,
          });
        }
      } catch (error) {
        documents.push({ name: file.name, kind, status: "error", detail: safeMessage(error) });
        issues.push(`${file.name}: ${safeMessage(error)}.`);
      }
    }

    const required = [
      ["solicitud", parsed.solicitud],
      ["cotización", parsed.cotizacion],
      ["aprobación", parsed.aprobacion],
    ] as const;
    for (const [label, value] of required) {
      if (!value) issues.push(`No se obtuvo una ${label} válida.`);
    }

    let evaluation;
    if (parsed.solicitud && parsed.cotizacion && parsed.aprobacion) {
      const maestros = await loadMaestros();
      evaluation = evaluarExpediente(
        {
          carpeta: `carga-${parsed.solicitud.solicitud_id.toLowerCase()}`,
          solicitud: parsed.solicitud,
          cotizacion: parsed.cotizacion,
          aprobacion: parsed.aprobacion,
          factura: parsed.factura,
        },
        maestros,
      );
    }

    const response: IngestionResponse = {
      documents,
      evaluation,
      llmConfigured: isLlmConfigured(),
      issues: [...new Set(issues)],
    };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Error de ingesta documental", error);
    return Response.json({ error: "No fue posible procesar el paquete documental." }, { status: 500 });
  }
}
