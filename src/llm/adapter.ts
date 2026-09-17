export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type LlmHistoryItem =
  | { type: "user"; content: string }
  | { type: "assistant"; content: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | { type: "tool_result"; id: string; output: string };

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LlmRequest {
  instructions: string;
  history: LlmHistoryItem[];
  tools: LlmToolDefinition[];
}

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
  historyAppend: LlmHistoryItem[];
  model: string;
}

export interface LlmAdapter {
  enviar(request: LlmRequest): Promise<LlmResponse>;
}
