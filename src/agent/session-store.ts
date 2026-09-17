import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LlmHistoryItem } from "@/llm/adapter";
import type { ChatMessage } from "@/tools/types";

export interface AgentSession {
  id: string;
  history: LlmHistoryItem[];
  messages: ChatMessage[];
  model?: string;
  updatedAt: string;
}

function safeSessionId(sessionId: string): string {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(sessionId)) throw new Error("sessionId inválido");
  return sessionId;
}

export class FileSessionStore {
  private readonly directory: string;

  constructor(outputDirectory: string) {
    this.directory = path.join(outputDirectory, "sessions");
  }

  private file(sessionId: string): string {
    return path.join(this.directory, `${safeSessionId(sessionId)}.json`);
  }

  async get(sessionId: string): Promise<AgentSession> {
    try {
      return JSON.parse(await readFile(this.file(sessionId), "utf8")) as AgentSession;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { id: safeSessionId(sessionId), history: [], messages: [], updatedAt: new Date().toISOString() };
    }
  }

  async save(session: AgentSession): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const destination = this.file(session.id);
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(session), "utf8");
    await rename(temporary, destination);
  }
}
