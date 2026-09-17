import { z } from "zod";
import { runAgentTurn } from "@/agent/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestSchema = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
  message: z.string().trim().min(1).max(2_000),
});

interface RateEntry {
  count: number;
  resetAt: number;
}

const rateLimit = new Map<string, RateEntry>();
const WINDOW_MS = 10 * 60 * 1_000;
const MAX_REQUESTS = Number(process.env.AGENT_RATE_LIMIT ?? 20);

function allowRequest(request: Request): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const current = rateLimit.get(ip);
  if (!current || current.resetAt <= now) {
    rateLimit.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= MAX_REQUESTS) return false;
  current.count += 1;
  return true;
}

export async function POST(request: Request) {
  if (!allowRequest(request)) {
    return Response.json({ error: "Límite temporal alcanzado. Intente nuevamente en unos minutos." }, { status: 429 });
  }
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Solicitud inválida", detail: z.prettifyError(parsed.error) }, { status: 400 });
    }
    const result = await runAgentTurn(parsed.data.sessionId, parsed.data.message);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Error del agente", error instanceof Error ? error.message : "desconocido");
    return Response.json(
      { error: error instanceof Error ? error.message : "No fue posible procesar el mensaje." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
