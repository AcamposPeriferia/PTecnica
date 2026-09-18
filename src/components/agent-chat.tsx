"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage, ToolCallView } from "@/tools/types";

interface ChatResponse {
  reply: string;
  toolCalls: ToolCallView[];
  needsConfirmation: boolean;
  sessionId: string;
  model: string;
  error?: string;
}

const examples = [
  { id: "sol-001", label: "Flujo automático", text: 'Procesa la solicitud "sol-001" y crea la orden si cumple todos los controles.' },
  { id: "sol-004", label: "Diferencia de valor", text: 'Procesa la solicitud "sol-004". Muéstrame las validaciones y no crees la OC hasta que yo confirme.' },
  { id: "sol-005", label: "Compra retroactiva", text: 'Procesa la solicitud "sol-005" y explícame cualquier excepción antes de crear la OC.' },
  { id: "sol-006", label: "IVA derivado", text: 'Procesa la solicitud "sol-006" y dime qué datos fueron derivados.' },
];

function newSessionId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function suggestedCaso() {
  const fecha = new Date().toISOString().slice(0, 10);
  return `caso-${fecha}-${Math.random().toString(36).slice(2, 6)}`;
}

function ToolCall({ call, index }: { call: ToolCallView; index: number }) {
  return (
    <details className={call.ok ? "tool-call tool-call--ok" : "tool-call tool-call--error"}>
      <summary>
        <span className="tool-call__index">{index + 1}</span>
        <div><strong>{call.name}</strong><small>{call.summary}</small></div>
        <span className="tool-call__state">{call.ok ? "Completada" : "Error"}</span>
      </summary>
      <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
    </details>
  );
}

export function AgentChat() {
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState("gpt-5-mini");
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // El id de sesión vive en localStorage (no existe en el servidor), así que el
    // primer render del cliente debe coincidir con el del servidor (sessionId vacío)
    // y solo aquí, tras montar, se sincroniza con el almacenamiento del navegador.
    const existing = localStorage.getItem("oc-agent-session");
    const id = existing ?? newSessionId();
    localStorage.setItem("oc-agent-session", id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza con localStorage, no hay valor SSR posible
    setSessionId(id);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/sessions/${sessionId}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("No se pudo recuperar la sesión"))))
      .then((payload: { messages?: ChatMessage[]; model?: string }) => {
        if (payload.messages?.length) {
          setMessages(payload.messages);
          setNeedsConfirmation(Boolean(payload.messages.at(-1)?.needsConfirmation));
        }
        if (payload.model) setModel(payload.model);
      })
      .catch(() => undefined);
  }, [sessionId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  function resetSession() {
    const id = newSessionId();
    localStorage.setItem("oc-agent-session", id);
    setSessionId(id);
    setMessages([]);
    setNeedsConfirmation(false);
    setMessage("");
    setError("");
  }

  async function send(content = message) {
    const trimmed = content.trim();
    if (!trimmed || !sessionId || thinking) return;
    const userMessage: ChatMessage = { role: "user", content: trimmed, createdAt: new Date().toISOString() };
    setMessages((current) => [...current, userMessage]);
    setMessage("");
    setThinking(true);
    setError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: trimmed }),
      });
      const payload = (await response.json()) as ChatResponse;
      if (!response.ok) throw new Error(payload.error ?? "No fue posible ejecutar el agente.");
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: payload.reply,
          toolCalls: payload.toolCalls,
          needsConfirmation: payload.needsConfirmation,
          createdAt: new Date().toISOString(),
        },
      ]);
      setNeedsConfirmation(payload.needsConfirmation);
      setModel(payload.model);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible ejecutar el agente.");
    } finally {
      setThinking(false);
    }
  }

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploadBusy || thinking) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const caso = String(data.get("caso") ?? "").trim();
    const remitente = String(data.get("remitente") ?? "").trim();
    const asunto = String(data.get("asunto") ?? "").trim();
    setUploadBusy(true);
    setUploadError("");
    try {
      const response = await fetch("/api/uploads", { method: "POST", body: data });
      const payload = (await response.json()) as { uploadId?: string; error?: string };
      if (!response.ok || !payload.uploadId) throw new Error(payload.error ?? "No fue posible subir los documentos.");
      form.reset();
      setShowUpload(false);
      const asuntoText = asunto ? ` El asunto de la solicitud es "${asunto}".` : "";
      await send(
        `Acabo de subir los documentos de un caso nuevo (uploadId: "${payload.uploadId}"). ` +
          `Identifícalo como caso "${caso}". El correo de quien solicitó la compra es ${remitente}.${asuntoText} ` +
          `Ingiérelo con oc_ingerir_paquete, valida y muéstrame la OC antes de crearla.`,
      );
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "No fue posible subir los documentos.");
    } finally {
      setUploadBusy(false);
    }
  }

  const empty = messages.length === 0;

  return (
    <main className="agent-shell">
      <header className="agent-header">
        <div className="agent-brand"><span className="agent-brand__mark"><i /></span><div><strong>Agente de compras SAP</strong><small>Periferia IT Group · Entorno simulado</small></div></div>
        <div className="agent-header__actions"><span><i /> OpenAI · {model}</span><button onClick={resetSession}>Nueva sesión</button></div>
      </header>

      <div className="agent-layout">
        <aside className="agent-sidebar">
          <div className="agent-sidebar__title"><span>OC</span><div><strong>Órdenes de compra</strong><small>RC1–RC10 activos</small></div></div>
          <section>
            <p className="agent-kicker">Casos de demostración</p>
            {examples.map((example) => (
              <button key={example.id} onClick={() => send(example.text)} disabled={thinking || !sessionId}>
                <span>{example.id.slice(-3)}</span><div><strong>{example.id}</strong><small>{example.label}</small></div><b>›</b>
              </button>
            ))}
          </section>

          <button type="button" className="upload-toggle" onClick={() => setShowUpload((current) => !current)} disabled={thinking || !sessionId}>
            {showUpload ? "Cancelar carga de caso nuevo" : "+ Subir caso nuevo (Excel, PDF, correo)"}
          </button>

          {showUpload && (
            <form className="upload-panel" onSubmit={submitUpload}>
              <h3>Documentos del caso nuevo</h3>
              <label>
                Identificador del caso
                <input type="text" name="caso" defaultValue={suggestedCaso()} pattern="[a-z][a-z0-9-]{2,39}" required />
              </label>
              <label>
                Correo del solicitante
                <input type="email" name="remitente" placeholder="nombre@empresa.com" required />
              </label>
              <label>
                Asunto de la solicitud (opcional)
                <input type="text" name="asunto" placeholder="Compra de..." />
              </label>
              <label>
                Solicitud (Excel .xlsx)
                <input type="file" name="solicitud" accept=".xlsx" required />
              </label>
              <label>
                Cotización (PDF o .txt)
                <input type="file" name="cotizacion" accept=".pdf,.txt" required />
              </label>
              <label>
                Aprobación del líder (correo .eml)
                <input type="file" name="aprobacion" accept=".eml" required />
                <small className="hint">Exporta el correo de aprobación como .eml desde tu cliente de correo.</small>
              </label>
              <label>
                Factura (opcional, si ya llegó)
                <input type="file" name="factura" accept=".pdf,.txt" />
              </label>
              {uploadError && <div className="upload-error" role="alert">{uploadError}</div>}
              <div className="upload-panel__actions">
                <button type="submit" disabled={uploadBusy}>{uploadBusy ? "Subiendo…" : "Subir e ingerir"}</button>
                <button type="button" onClick={() => setShowUpload(false)} disabled={uploadBusy}>Cancelar</button>
              </div>
            </form>
          )}

          <div className="agent-assurance"><strong>Controles del agente</strong><p>Valores solo desde herramientas · Confirmación humana · SAP idempotente · Evidencia SHA-256</p></div>
          <small className="agent-session">Sesión<br /><code>{sessionId ? sessionId.slice(0, 18) : "iniciando…"}</code></small>
        </aside>

        <section className="chat-panel" aria-label="Conversación con el agente">
          <div className="chat-scroll">
            {empty && (
              <div className="chat-welcome">
                <span className="chat-welcome__icon">OC</span>
                <p className="agent-kicker">Asistente de administración</p>
                <h1>Preparemos una orden de compra</h1>
                <p>Pídame procesar uno de los seis casos. Leeré el paquete, ejecutaré los controles y crearé la OC en SAP simulado solo cuando corresponda.</p>
                <div className="chat-welcome__examples">
                  <button onClick={() => send(examples[0].text)} disabled={!sessionId}>Procesar sol-001 automáticamente</button>
                  <button onClick={() => send(examples[1].text)} disabled={!sessionId}>Revisar la excepción de sol-004</button>
                </div>
              </div>
            )}

            {messages.map((item, index) => (
              <article className={`chat-message chat-message--${item.role}`} key={`${item.createdAt}-${index}`}>
                <div className="chat-avatar">{item.role === "user" ? "Tú" : "OC"}</div>
                <div className="chat-bubble">
                  <div className="chat-bubble__meta"><strong>{item.role === "user" ? "Analista" : "Agente de compras"}</strong><time>{new Date(item.createdAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</time></div>
                  {item.toolCalls && item.toolCalls.length > 0 && (
                    <div className="tool-stack"><p>{item.toolCalls.length} llamadas a herramientas</p>{item.toolCalls.map((call, callIndex) => <ToolCall call={call} index={callIndex} key={call.id} />)}</div>
                  )}
                  <p className="chat-bubble__text">{item.content}</p>
                  {item.needsConfirmation && <div className="confirmation-card"><span>!</span><div><strong>Confirmación humana requerida</strong><p>Revise las excepciones antes de autorizar la creación en SAP.</p></div></div>}
                </div>
              </article>
            ))}

            {thinking && <div className="chat-thinking"><span>OC</span><div><i /><i /><i /></div><p>El agente está evaluando y ejecutando herramientas…</p></div>}
            {error && <div className="chat-error" role="alert">{error}</div>}
            <div ref={endRef} />
          </div>

          {needsConfirmation && !thinking && (
            <div className="confirmation-bar"><div><strong>El agente espera su decisión</strong><span>Esta acción puede crear una orden en el SAP simulado.</span></div><button onClick={() => send("Confirmo explícitamente todas las excepciones informadas. Puede crear la orden de compra.")}>Confirmar y continuar</button></div>
          )}

          <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder='Ej.: Procesa la solicitud "sol-004" y muéstrame las validaciones…' maxLength={2000} disabled={thinking} rows={2} />
            <button type="submit" disabled={!message.trim() || thinking || !sessionId} aria-label="Enviar mensaje">➜</button>
            <small>Enter para enviar · Shift + Enter para nueva línea</small>
          </form>
        </section>
      </div>
    </main>
  );
}
