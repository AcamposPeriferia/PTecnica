import { getEvaluation } from "@/application/evaluations";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const evaluation = await getEvaluation(id);
    if (!evaluation) return Response.json({ error: "Solicitud no encontrada." }, { status: 404 });
    return Response.json({ data: evaluation });
  } catch (error) {
    console.error("No fue posible evaluar el expediente", error);
    return Response.json({ error: "No fue posible evaluar el expediente." }, { status: 500 });
  }
}
