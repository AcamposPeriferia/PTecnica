import "server-only";

import { evaluarExpediente } from "@/domain/evaluate";
import type { Evaluacion } from "@/domain/types";
import { loadExpedientes, loadMaestros } from "@/infrastructure/file-repository";

export async function getEvaluations(): Promise<Evaluacion[]> {
  const [expedientes, maestros] = await Promise.all([loadExpedientes(), loadMaestros()]);
  return expedientes.map((expediente) => evaluarExpediente(expediente, maestros));
}

export async function getEvaluation(folder: string): Promise<Evaluacion | undefined> {
  const evaluations = await getEvaluations();
  return evaluations.find((item) => item.carpeta === folder || item.solicitudId === folder);
}
