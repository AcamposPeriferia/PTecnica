import "server-only";

import OpenAI from "openai";
import type { FunctionTool, ResponseInputItem, ResponseOutputItem } from "openai/resources/responses/responses";
import type { LlmAdapter, LlmHistoryItem, LlmRequest, LlmResponse, LlmToolDefinition } from "./adapter";

function toInputItem(item: LlmHistoryItem): ResponseInputItem {
  switch (item.type) {
    case "user":
      return { role: "user", content: item.content };
    case "assistant":
      return { role: "assistant", content: item.content };
    case "tool_call":
      return { type: "function_call", call_id: item.id, name: item.name, arguments: item.arguments };
    case "tool_result":
      return { type: "function_call_output", call_id: item.id, output: item.output };
  }
}

function toTool(tool: LlmToolDefinition): FunctionTool {
  // strict:false porque el modo estricto de OpenAI exige que todo campo opcional
  // de los esquemas zod aparezca igualmente en "required" (patrón nullable);
  // aquí se conserva la semántica original de opcional/requerido de cada herramienta.
  return { type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: false };
}

function toHistoryAppend(output: ResponseOutputItem[]): LlmHistoryItem[] {
  return output.flatMap((item): LlmHistoryItem[] => {
    if (item.type === "function_call") {
      return [{ type: "tool_call", id: item.call_id, name: item.name, arguments: item.arguments }];
    }
    if (item.type === "message") {
      const text = item.content.map((part) => (part.type === "output_text" ? part.text : "")).join("");
      return text ? [{ type: "assistant", content: text }] : [];
    }
    return [];
  });
}

export class OpenAiLlmAdapter implements LlmAdapter {
  private readonly client: OpenAI;

  constructor() {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no está configurada");
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: Number(process.env.OPENAI_TIMEOUT_MS ?? 30_000),
      maxRetries: 1,
    });
  }

  async enviar(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.client.responses.create({
      model: process.env.OPENAI_MODEL ?? "gpt-5.5",
      store: false,
      instructions: request.instructions,
      input: request.history.map(toInputItem),
      tools: request.tools.map(toTool),
      tool_choice: "auto",
      parallel_tool_calls: false,
      max_output_tokens: Number(process.env.AGENT_MAX_OUTPUT_TOKENS ?? 2_000),
      include: ["reasoning.encrypted_content"],
    });
    const toolCalls = response.output
      .filter((item): item is Extract<ResponseOutputItem, { type: "function_call" }> => item.type === "function_call")
      .map((item) => ({ id: item.call_id, name: item.name, arguments: item.arguments }));
    return {
      text: response.output_text,
      toolCalls,
      historyAppend: toHistoryAppend(response.output),
      model: response.model,
    };
  }
}
