"use client";

import { useRef, useState } from "react";
import type { IngestionDocument, IngestionResponse } from "@/domain/types";

const kindLabels: Record<IngestionDocument["kind"], string> = {
  solicitud: "Solicitud",
  cotizacion: "Cotización",
  aprobacion: "Aprobación",
  factura: "Factura",
  desconocido: "Sin clasificar",
};

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h7l4 4v14H7zM14 3v5h5M9.5 13h5M9.5 17h5" />
    </svg>
  );
}

export function IngestionPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestionResponse>();
  const [error, setError] = useState("");

  function addFiles(incoming: FileList | File[]) {
    const allowed = Array.from(incoming).filter((file) => /\.(pdf|xlsx|eml)$/i.test(file.name));
    setFiles((current) => {
      const merged = [...current];
      for (const file of allowed) {
        const duplicate = merged.some((item) => item.name === file.name && item.size === file.size);
        if (!duplicate && merged.length < 4) merged.push(file);
      }
      return merged;
    });
    setResult(undefined);
    setError("");
  }

  async function processFiles() {
    if (!files.length) return;
    setLoading(true);
    setError("");
    setResult(undefined);
    try {
      const body = new FormData();
      files.forEach((file) => body.append("documents", file));
      const response = await fetch("/api/ingesta", { method: "POST", body });
      const payload = (await response.json()) as IngestionResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No fue posible procesar los documentos.");
      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible procesar los documentos.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="ingestion" aria-labelledby="ingestion-title">
      <div className="ingestion__intro">
        <div>
          <p className="eyebrow">Ingreso documental</p>
          <h1 id="ingestion-title">Nueva validación</h1>
          <p>Cargue el paquete original. Los documentos se procesan en memoria y no se almacenan.</p>
        </div>
        <div className="privacy-note"><span aria-hidden="true">✓</span><div><strong>Procesamiento efímero</strong><small>Sin base de datos ni retención de archivos</small></div></div>
      </div>

      <div className="ingestion__grid">
        <div className="upload-card">
          <div
            className={dragging ? "dropzone dropzone--active" : "dropzone"}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
          >
            <input ref={inputRef} type="file" multiple accept=".pdf,.xlsx,.eml" onChange={(event) => event.target.files && addFiles(event.target.files)} />
            <span className="dropzone__icon"><FileIcon /></span>
            <h2>Arrastre los documentos aquí</h2>
            <p>Solicitud XLSX, cotización PDF, aprobación EML y factura PDF opcional.</p>
            <button type="button" onClick={() => inputRef.current?.click()}>Seleccionar archivos</button>
            <small>Máximo 4 archivos · 4 MB en total</small>
          </div>

          {files.length > 0 && (
            <div className="file-queue">
              <div className="file-queue__head"><strong>Paquete seleccionado</strong><button onClick={() => { setFiles([]); setResult(undefined); }}>Limpiar</button></div>
              {files.map((file, index) => (
                <div className="queued-file" key={`${file.name}-${file.size}`}>
                  <span><FileIcon /></span>
                  <div><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(0)} KB</small></div>
                  <button aria-label={`Quitar ${file.name}`} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                </div>
              ))}
              <button className="process-button" onClick={processFiles} disabled={loading}>
                {loading ? "Extrayendo información…" : "Validar paquete"}
              </button>
            </div>
          )}
          {error && <p className="ingestion-error" role="alert">{error}</p>}
        </div>

        <aside className="package-guide">
          <div className="package-guide__title"><span>4</span><div><h2>Documentos esperados</h2><p>La factura es opcional.</p></div></div>
          <ol>
            <li><span>XLSX</span><div><strong>Solicitud de compra</strong><small>Datos del solicitante, proveedor e imputación</small></div></li>
            <li><span>PDF</span><div><strong>Cotización</strong><small>Ítems, valores, IVA y vigencia</small></div></li>
            <li><span>EML</span><div><strong>Aprobación</strong><small>Remitente, fecha y contenido de aprobación</small></div></li>
            <li className="optional"><span>PDF</span><div><strong>Factura <em>opcional</em></strong><small>Detección de compras retroactivas</small></div></li>
          </ol>
          <div className="extraction-order"><strong>Orden de extracción</strong><p><b>1</b> Lectura determinística <span>→</span> <b>2</b> LLM si es ambiguo <span>→</span> <b>3</b> Revisión humana</p></div>
        </aside>
      </div>

      {result && (
        <section className="ingestion-result" aria-live="polite">
          <div className="section-title"><div><h2>Resultado de la extracción</h2><p>{result.documents.length} documentos procesados</p></div><span className={result.evaluation ? "result-ready" : "result-pending"}>{result.evaluation ? "Evaluación generada" : "Paquete incompleto"}</span></div>
          <div className="document-results">
            {result.documents.map((document) => (
              <div className="document-result" key={document.name}>
                <span className={`document-result__state document-result__state--${document.status}`}>{document.status === "extraido" ? "✓" : "!"}</span>
                <div><strong>{document.name}</strong><p>{kindLabels[document.kind]} · {document.detail}</p></div>
                <small>{document.method === "llm" ? "LLM" : document.method === "deterministico" ? "Determinístico" : "Pendiente"}</small>
              </div>
            ))}
          </div>
          {result.issues.length > 0 && <div className="result-issues"><strong>Antes de continuar</strong><ul>{result.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>{!result.llmConfigured && <p>El fallback con LLM está desactivado porque no hay una clave configurada.</p>}</div>}
          {result.evaluation && <div className={`evaluation-summary evaluation-summary--${result.evaluation.status.toLowerCase()}`}><div><small>Decisión</small><strong>{result.evaluation.status.replaceAll("_", " ")}</strong></div><p>{result.evaluation.resumen}</p><span>{result.evaluation.hallazgos.filter((item) => item.severidad === "BLOQUEANTE").length} bloqueos</span></div>}
        </section>
      )}
    </section>
  );
}
