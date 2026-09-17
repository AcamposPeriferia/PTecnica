import { FileSessionStore } from "@/agent/session-store";
import { runtimeOutputDirectory } from "@/lib/output-dir";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/sessions/[id]">) {
  try {
    const { id } = await context.params;
    const session = await new FileSessionStore(runtimeOutputDirectory()).get(id);
    return Response.json(
      { sessionId: session.id, messages: session.messages, model: session.model, updatedAt: session.updatedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No fue posible leer la sesión." }, { status: 400 });
  }
}
