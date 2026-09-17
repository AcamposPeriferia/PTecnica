import { rm } from "node:fs/promises";
import path from "node:path";
import { construir_payload, crear, generar_evidencia, leer_paquete, validar } from "./src/tools/oc";
import type { NormalizedPackage, OrdenCompra, ToolContext, ValidationResult } from "./src/tools/types";

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function unwrap<T>(value: string): T {
  const parsed = JSON.parse(value) as Envelope<T>;
  if (!parsed.ok || parsed.data === undefined) throw new Error(parsed.error ?? "La herramienta no devolvió datos");
  return parsed.data;
}

const directory = process.cwd();
const outputDirectory = path.resolve(directory, "out");
if (path.dirname(outputDirectory) !== path.resolve(directory)) throw new Error("Directorio de salida inseguro");
await rm(outputDirectory, { recursive: true, force: true });

const ctx: ToolContext = { directory, outputDirectory, sessionId: "demo-prd-03" };

async function processCase(caso: string) {
  const paquete = unwrap<NormalizedPackage>(await leer_paquete.execute({ caso }, ctx));
  const validation = unwrap<ValidationResult>(await validar.execute({ caso, paquete }, ctx));
  console.log(`\n${caso}: apta=${validation.apta} retroactiva=${validation.retroactiva}`);
  console.log(`  bloqueos: ${validation.bloqueos.map((item) => item.codigo).join(", ") || "ninguno"}`);
  console.log(`  confirmaciones: ${validation.confirmaciones.map((item) => item.codigo).join(", ") || "ninguna"}`);

  if (!validation.apta) {
    console.log(`  resultado: no se crea OC; ${validation.bloqueos.map((item) => item.detalle).join(" ")}`);
    return;
  }

  const built = unwrap<{ orden: OrdenCompra; trazabilidad: string }>(
    await construir_payload.execute({ caso, paquete, derivados: validation.derivados }, ctx),
  );
  await generar_evidencia.execute({ caso }, ctx);
  const confirmado = validation.confirmaciones.length > 0;
  if (caso === "sol-004" && confirmado) console.log("  confirmación explícita de demo: true");
  const created = unwrap<{ numero_oc: string; idempotente: boolean }>(
    await crear.execute({ caso, payload: built.orden, confirmado }, ctx),
  );
  console.log(`  OC: ${created.numero_oc} · idempotente=${created.idempotente}`);
  return { paquete, validation, orden: built.orden, numero: created.numero_oc };
}

let firstCase: Awaited<ReturnType<typeof processCase>>;
for (const caso of ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]) {
  const processed = await processCase(caso);
  if (caso === "sol-001") firstCase = processed;
}

if (!firstCase) throw new Error("sol-001 no produjo una orden");
const repeated = unwrap<{ numero_oc: string; idempotente: boolean }>(
  await crear.execute({ caso: "sol-001", payload: firstCase.orden, confirmado: false }, ctx),
);
console.log(`\nsol-001 repetida: OC ${repeated.numero_oc} · idempotente=${repeated.idempotente}`);
console.log(`\nArchivos de control generados en ${outputDirectory}`);
