import "server-only";

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { LlmAdapter, LlmToolCall, LlmToolDefinition } from "@/llm/adapter";
import { OpenAiLlmAdapter } from "@/llm/openai";
import { ocTools, type OcToolName } from "@/tools/oc";
import type { ChatMessage, ToolCallView, ToolContext } from "@/tools/types";
import { FileSessionStore } from "./session-store";

interface ToolEnvelope {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface AgentTurnResult {
  reply: string;
  toolCalls: ToolCallView[];
  needsConfirmation: boolean;
  sessionId: string;
  model: string;
}

export function runtimeOutputDirectory(): string {
  return process.env.VERCEL ? path.join(tmpdir(), "ordenes-compra") : path.join(process.cwd(), "out");
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toolEnvelope(output: string): ToolEnvelope {
  try {
    const parsed = record(JSON.parse(output));
    return {
      ok: parsed.ok === true,
      data: parsed.data,
      error: typeof parsed.error === "string" ? parsed.error : undefined,
    };
  } catch {
    return { ok: false, error: "La herramienta devolvió una respuesta no válida" };
  }
}

function summarize(name: string, envelope: ToolEnvelope): string {
  if (!envelope.ok) return envelope.error ?? "La herramienta falló";
  const data = record(envelope.data);
  if (name === "oc_leer_paquete") {
    const request = record(data.solicitud);
    const missing = Array.isArray(data.faltantes) ? data.faltantes : [];
    return `${String(request.solicitud_id ?? "Paquete leído")}; faltantes: ${missing.length ? missing.join(", ") : "ninguno"}.`;
  }
  if (name === "oc_validar") {
    const blockers = Array.isArray(data.bloqueos) ? data.bloqueos.length : 0;
    const confirmations = Array.isArray(data.confirmaciones) ? data.confirmaciones.length : 0;
    return `${data.apta === true ? "Apta" : "No apta"}; ${blockers} bloqueos y ${confirmations} confirmaciones.`;
  }
  if (name === "oc_construir_payload") return `Payload SAP validado; trazabilidad: ${String(data.trazabilidad ?? "generada")}.`;
  if (name === "oc_generar_evidencia") return `Evidencia creada; SHA-256 ${String(data.sha256 ?? "").slice(0, 12)}…`;
  if (name === "oc_crear") return `OC ${String(data.numero_oc ?? "")} creada${data.idempotente === true ? " (idempotente)" : ""}.`;
  return "Herramienta ejecutada correctamente.";
}

function needsHumanConfirmation(name: string, envelope: ToolEnvelope): boolean {
  if (name === "oc_validar" && envelope.ok) {
    const confirmations = record(envelope.data).confirmaciones;
    return Array.isArray(confirmations) && confirmations.length > 0;
  }
  return !envelope.ok && Boolean(envelope.error?.toLowerCase().includes("confirmación"));
}

function toolDefinitions(): LlmToolDefinition[] {
  return Object.entries(ocTools).map(([name, tool]) => {
    const schema = z.toJSONSchema(z.object(tool.args), { target: "draft-7" });
    delete schema.$schema;
    return { name, description: tool.description, parameters: schema };
  });
}

async function executeTool(call: LlmToolCall, ctx: ToolContext): Promise<{ output: string; view: ToolCallView; confirmation: boolean }> {
  const name = call.name as OcToolName;
  const tool = ocTools[name];
  if (!tool) {
    const output = JSON.stringify({ ok: false, error: `Herramienta desconocida: ${call.name}` });
    return {
      output,
      confirmation: false,
      view: { id: call.id, name: call.name, arguments: {}, ok: false, summary: `Herramienta desconocida: ${call.name}` },
    };
  }

  let rawArguments: unknown;
  try {
    rawArguments = JSON.parse(call.arguments);
  } catch {
    rawArguments = {};
  }
  const args = record(rawArguments);
  const schema = z.object(tool.args);
  const parsed = schema.safeParse(args);
  const output = parsed.success
    ? await (tool.execute as (args: never, ctx: ToolContext) => Promise<string>)(parsed.data as never, ctx)
    : JSON.stringify({ ok: false, error: `Argumentos inválidos: ${z.prettifyError(parsed.error)}` });
  const envelope = toolEnvelope(output);
  return {
    output,
    confirmation: needsHumanConfirmation(name, envelope),
    view: {
      id: call.id,
      name: call.name,
      arguments: args,
      ok: envelope.ok,
      summary: summarize(name, envelope),
    },
  };
}

async function logToolCall(outputDirectory: string, sessionId: string, view: ToolCallView) {
  await mkdir(outputDirectory, { recursive: true });
  await appendFile(
    path.join(outputDirectory, "log.jsonl"),
    `${JSON.stringify({ ts: new Date().toISOString(), sessionId, ...view })}\n`,
    "utf8",
  );
}

function createAdapter(): LlmAdapter {
  return new OpenAiLlmAdapter();
}

export async function runAgentTurn(sessionId: string, message: string): Promise<AgentTurnResult> {
  const outputDirectory = runtimeOutputDirectory();
  const store = new FileSessionStore(outputDirectory);
  const session = await store.get(sessionId);
  const maxTurns = Number(process.env.AGENT_MAX_SESSION_TURNS ?? 30);
  const userTurns = session.messages.filter((item) => item.role === "user").length;
  if (userTurns >= maxTurns) throw new Error(`La sesión alcanzó el límite de ${maxTurns} turnos. Inicie una nueva sesión.`);

  const prompt = await readFile(path.join(process.cwd(), "agent", "prompt.md"), "utf8");
  const knowledge = await readFile(path.join(process.cwd(), "src", "knowledge", "ordenes-compra.md"), "utf8");
  const instructions = `${prompt}\n\n## Conocimiento del proceso\n${knowledge}`;
  const now = new Date().toISOString();
  const userMessage: ChatMessage = { role: "user", content: message, createdAt: now };
  session.messages.push(userMessage);
  session.history.push({ type: "user", content: message });

  const adapter = createAdapter();
  const tools = toolDefinitions();
  const visibleCalls: ToolCallView[] = [];
  let confirmation = false;
  let finalReply = "";
  let model = process.env.OPENAI_MODEL ?? "gpt-5.5";
  const maxIterations = Math.min(Number(process.env.AGENT_MAX_ITERATIONS ?? 25), 25);
  const ctx: ToolContext = { directory: process.cwd(), sessionId, outputDirectory };

  try {
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const response = await adapter.enviar({ instructions, history: session.history, tools });
      model = response.model;
      session.history.push(...response.historyAppend);
      if (!response.toolCalls.length) {
        finalReply = response.text.trim() || "Terminé el análisis, pero el modelo no devolvió un resumen.";
        break;
      }

      for (const call of response.toolCalls) {
        const executed = await executeTool(call, ctx);
        visibleCalls.push(executed.view);
        confirmation ||= executed.confirmation;
        await logToolCall(outputDirectory, sessionId, executed.view);
        session.history.push({ type: "tool_result", id: call.id, output: executed.output });
      }
    }
    if (!finalReply) {
      finalReply = "Alcancé el límite de iteraciones del agente. Revise las herramientas ejecutadas y continúe en un nuevo turno.";
    }
  } catch (error) {
    finalReply = `No pude completar el turno: ${error instanceof Error ? error.message : "error del proveedor de IA"}. La sesión se conserva; puede reintentar.`;
  }

  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: finalReply,
    createdAt: new Date().toISOString(),
    toolCalls: visibleCalls,
    needsConfirmation: confirmation,
  };
  session.messages.push(assistantMessage);
  session.model = model;
  session.updatedAt = assistantMessage.createdAt;
  await store.save(session);

  return { reply: finalReply, toolCalls: visibleCalls, needsConfirmation: confirmation, sessionId, model };
}
