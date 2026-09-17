import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Regenera modulo/ a partir de las mismas fuentes que usa la aplicación
// (agent/prompt.md y src/knowledge/ordenes-compra.md), para que el bonus del
// PRD nunca diverja del comportamiento y conocimiento reales del agente.
// Ejecutar con `npm run build:modulo` después de tocar cualquiera de esas dos fuentes.

const root = process.cwd();

const agentFrontmatter = `---
description: Agente conversacional que prepara y crea órdenes de compra en SAP a partir de un paquete de solicitud, cotización y aprobación.
mode: primary
permission:
  edit: deny
  bash: deny
---

`;

const skillFrontmatter = `---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia IT Group (maestros, bloqueos, confirmaciones y evidencia de auditoría).
---

`;

async function main() {
  const prompt = await readFile(path.join(root, "agent", "prompt.md"), "utf8");
  const knowledge = await readFile(path.join(root, "src", "knowledge", "ordenes-compra.md"), "utf8");

  await mkdir(path.join(root, "modulo", "tools"), { recursive: true });
  await mkdir(path.join(root, "modulo", "skill", "ordenes-compra"), { recursive: true });

  await writeFile(path.join(root, "modulo", "agent.md"), `${agentFrontmatter}${prompt}`, "utf8");
  await writeFile(path.join(root, "modulo", "skill", "ordenes-compra", "SKILL.md"), `${skillFrontmatter}${knowledge}`, "utf8");
  await writeFile(
    path.join(root, "modulo", "tools", "oc.ts"),
    "// Generado por scripts/build-modulo.ts: re-exporta las mismas herramientas que usa el servidor,\n" +
      "// para que este módulo nunca sea una copia divergente de src/tools/oc.ts.\n" +
      'export * from "../../src/tools/oc";\n',
    "utf8",
  );

  console.log("modulo/ regenerado desde agent/prompt.md y src/knowledge/ordenes-compra.md");
}

await main();
