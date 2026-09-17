import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runtimeOutputDirectory } from "@/lib/output-dir";
import { MAX_UPLOAD_BYTES } from "@/tools/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface RoleSpec {
  role: "solicitud" | "cotizacion" | "aprobacion" | "factura";
  required: boolean;
  extensions: string[];
}

const ROLES: RoleSpec[] = [
  { role: "solicitud", required: true, extensions: ["xlsx"] },
  { role: "cotizacion", required: true, extensions: ["pdf", "txt"] },
  { role: "aprobacion", required: true, extensions: ["eml"] },
  { role: "factura", required: false, extensions: ["pdf", "txt"] },
];

function extensionOf(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const saved: { role: string; name: string; sizeBytes: number }[] = [];
    const errors: string[] = [];
    let totalBytes = 0;

    for (const spec of ROLES) {
      const file = form.get(spec.role);
      if (!(file instanceof File)) {
        if (spec.required) errors.push(`Falta el archivo de ${spec.role} (${spec.extensions.join("/")}).`);
        continue;
      }
      const extension = extensionOf(file.name);
      if (!spec.extensions.includes(extension)) {
        errors.push(`${spec.role}: extensión ".${extension}" no admitida, use ${spec.extensions.map((item) => `.${item}`).join(" o ")}.`);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        errors.push(`${spec.role}: supera el límite de ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`);
        continue;
      }
      totalBytes += file.size;
      saved.push({ role: spec.role, name: `${spec.role}.${extension}`, sizeBytes: file.size });
    }

    if (totalBytes > MAX_UPLOAD_BYTES * 4) errors.push("El paquete completo supera el límite total permitido.");
    if (errors.length) return Response.json({ error: errors.join(" ") }, { status: 400 });

    const uploadId = randomUUID();
    const rawDir = path.join(runtimeOutputDirectory(), "uploads", uploadId, "raw");
    await mkdir(rawDir, { recursive: true });

    for (const spec of ROLES) {
      const file = form.get(spec.role);
      if (!(file instanceof File)) continue;
      const extension = extensionOf(file.name);
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(rawDir, `${spec.role}.${extension}`), buffer);
    }

    return Response.json({ uploadId, files: saved }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Error al subir documentos", error instanceof Error ? error.message : "desconocido");
    return Response.json({ error: "No fue posible recibir los archivos." }, { status: 500 });
  }
}
