import { getEvaluations } from "@/application/evaluations";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ data: await getEvaluations() });
  } catch (error) {
    console.error("No fue posible evaluar los expedientes", error);
    return Response.json({ error: "No fue posible evaluar los expedientes." }, { status: 500 });
  }
}
