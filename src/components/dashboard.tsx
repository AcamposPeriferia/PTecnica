"use client";

import { useMemo, useState } from "react";
import { formatCop } from "@/domain/normalization";
import type { Evaluacion, Severity, Status } from "@/domain/types";
import { IngestionPanel } from "./ingestion-panel";

const statusLabels: Record<Status, string> = {
  APROBADA: "Aprobadas",
  BLOQUEADA: "Bloqueadas",
  REQUIERE_REVISION: "Por revisar",
};

const severityLabels: Record<Severity, string> = {
  OK: "Cumple",
  INFO: "Informacion",
  ADVERTENCIA: "Revisar",
  BLOQUEANTE: "Bloqueante",
};

function shortId(id: string) {
  return id.replace("SOL-2026-", "SOL-");
}

function StatusBadge({ status }: { status: Status }) {
  return <span className={`status status--${status.toLowerCase()}`}>{statusLabels[status].replace(/s$/, "")}</span>;
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12m0 0 5-5m-5 5-5-5M5 20h14" />
    </svg>
  );
}

export function Dashboard({ evaluations }: { evaluations: Evaluacion[] }) {
  const [view, setView] = useState<"expedientes" | "ingesta">("expedientes");
  const [filter, setFilter] = useState<Status | "TODAS">("TODAS");
  const [selectedId, setSelectedId] = useState(evaluations[0]?.solicitudId ?? "");
  const [copied, setCopied] = useState(false);

  const counts = useMemo(
    () => ({
      APROBADA: evaluations.filter((item) => item.status === "APROBADA").length,
      BLOQUEADA: evaluations.filter((item) => item.status === "BLOQUEADA").length,
      REQUIERE_REVISION: evaluations.filter((item) => item.status === "REQUIERE_REVISION").length,
    }),
    [evaluations],
  );
  const visible = filter === "TODAS" ? evaluations : evaluations.filter((item) => item.status === filter);
  const selected = evaluations.find((item) => item.solicitudId === selectedId) ?? visible[0] ?? evaluations[0];

  function chooseFilter(next: Status | "TODAS") {
    setFilter(next);
    const first = next === "TODAS" ? evaluations[0] : evaluations.find((item) => item.status === next);
    if (first) setSelectedId(first.solicitudId);
  }

  function downloadDraft() {
    if (!selected?.borrador) return;
    const blob = new Blob([JSON.stringify(selected.borrador, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selected.solicitudId.toLowerCase()}-borrador-oc.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function copyDraft() {
    if (!selected?.borrador) return;
    await navigator.clipboard.writeText(JSON.stringify(selected.borrador, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true"><span /></span>
          <div>
            <strong>Control de compras</strong>
            <span>Periferia IT Group</span>
          </div>
        </div>
        <nav className="topnav" aria-label="Secciones principales">
          <button className={view === "expedientes" ? "topnav__active" : ""} onClick={() => setView("expedientes")}>Expedientes</button>
          <button className={view === "ingesta" ? "topnav__active" : ""} onClick={() => setView("ingesta")}>Nueva validación</button>
        </nav>
        <div className="source-state"><span aria-hidden="true" /> Datos verificados · 6 expedientes</div>
      </header>

      {view === "ingesta" ? <IngestionPanel /> : <>

      <section className="heading">
        <div>
          <p className="eyebrow">Bandeja de validación</p>
          <h1>Solicitudes de compra</h1>
          <p>Revisión automática contra proveedores, centros de costo, cotizaciones y niveles de aprobación.</p>
        </div>
        <div className="heading__date">
          <span>Corte de datos</span>
          <strong>29 ago 2026</strong>
        </div>
      </section>

      <section className="metrics" aria-label="Resumen de solicitudes">
        <button className={filter === "TODAS" ? "metric metric--active" : "metric"} onClick={() => chooseFilter("TODAS")}>
          <span className="metric__label">Total recibidas</span>
          <strong>{evaluations.length}</strong>
          <small>expedientes procesados</small>
        </button>
        <button className={filter === "APROBADA" ? "metric metric--approved metric--active" : "metric metric--approved"} onClick={() => chooseFilter("APROBADA")}>
          <span className="metric__label">Listas para OC</span>
          <strong>{counts.APROBADA}</strong>
          <small>sin bloqueos</small>
        </button>
        <button className={filter === "BLOQUEADA" ? "metric metric--blocked metric--active" : "metric metric--blocked"} onClick={() => chooseFilter("BLOQUEADA")}>
          <span className="metric__label">Bloqueadas</span>
          <strong>{counts.BLOQUEADA}</strong>
          <small>requieren corrección</small>
        </button>
        <button className={filter === "REQUIERE_REVISION" ? "metric metric--review metric--active" : "metric metric--review"} onClick={() => chooseFilter("REQUIERE_REVISION")}>
          <span className="metric__label">Decisión manual</span>
          <strong>{counts.REQUIERE_REVISION}</strong>
          <small>excepcion pendiente</small>
        </button>
      </section>

      <section className="workspace">
        <div className="request-list" aria-label="Listado de solicitudes">
          <div className="list-head">
            <div>
              <h2>{filter === "TODAS" ? "Todos los expedientes" : statusLabels[filter]}</h2>
              <span>{visible.length} resultados</span>
            </div>
            {filter !== "TODAS" && <button className="text-button" onClick={() => chooseFilter("TODAS")}>Limpiar filtro</button>}
          </div>
          <div className="list-scroll">
            {visible.map((item) => (
              <button
                key={item.solicitudId}
                className={selected?.solicitudId === item.solicitudId ? "request-card request-card--selected" : "request-card"}
                onClick={() => setSelectedId(item.solicitudId)}
                aria-pressed={selected?.solicitudId === item.solicitudId}
              >
                <div className="request-card__top">
                  <span className="request-card__id">{shortId(item.solicitudId)}</span>
                  <StatusBadge status={item.status} />
                </div>
                <h3>{item.descripcion}</h3>
                <p>{item.proveedor}</p>
                <div className="request-card__bottom">
                  <strong>{formatCop(item.valorSolicitado)}</strong>
                  <span>{item.centroCosto} · {item.subarea}</span>
                </div>
              </button>
            ))}
            {!visible.length && <div className="empty">No hay solicitudes con este estado.</div>}
          </div>
        </div>

        {selected && (
          <article className="detail" aria-live="polite">
            <div className="detail__header">
              <div>
                <div className="detail__title-row">
                  <span className="detail__id">{selected.solicitudId}</span>
                  <StatusBadge status={selected.status} />
                </div>
                <h2>{selected.descripcion}</h2>
                <p>{selected.resumen}</p>
              </div>
              {selected.borrador && (
                <button className="primary-button" onClick={downloadDraft}>
                  <DownloadIcon /> Descargar borrador
                </button>
              )}
            </div>

            <dl className="facts">
              <div><dt>Proveedor</dt><dd>{selected.proveedor}</dd></div>
              <div><dt>Solicitante</dt><dd>{selected.solicitante}</dd></div>
              <div><dt>Valor solicitado</dt><dd>{formatCop(selected.valorSolicitado)}</dd></div>
              <div><dt>Valor cotizado</dt><dd className={selected.valorCotizado !== selected.valorSolicitado ? "value--mismatch" : ""}>{formatCop(selected.valorCotizado)}</dd></div>
              <div><dt>Imputacion</dt><dd>{selected.centroCosto} / {selected.subarea}</dd></div>
              <div><dt>Fecha</dt><dd>{new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${selected.fechaSolicitud}T00:00:00Z`))}</dd></div>
            </dl>

            <section className="checks">
              <div className="section-title">
                  <div><h3>Resultado de controles</h3><p>Cada decisión conserva la regla y su fuente.</p></div>
                <span>{selected.hallazgos.filter((item) => item.severidad === "OK").length} controles aprobados</span>
              </div>
              <div className="check-list">
                {selected.hallazgos.map((item) => (
                  <div className="check" key={item.codigo}>
                    <span className={`check__icon check__icon--${item.severidad.toLowerCase()}`} aria-hidden="true">
                      {item.severidad === "OK" ? "✓" : item.severidad === "INFO" ? "i" : "!"}
                    </span>
                    <div className="check__copy">
                      <div><strong>{item.titulo}</strong><span>{severityLabels[item.severidad]}</span></div>
                      <p>{item.detalle}</p>
                      <small>{item.fuente}</small>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {selected.campos.some((item) => item.origen !== "solicitud") && (
              <section className="provenance">
                <h3>Campos recuperados</h3>
                <p>Estos valores no estaban en la solicitud y fueron completados sin modificar el archivo original.</p>
                <div>
                  {selected.campos.filter((item) => item.origen !== "solicitud").map((item) => (
                    <span key={item.campo}><b>{item.campo}</b>{item.valor}<small>{item.origen}</small></span>
                  ))}
                </div>
              </section>
            )}

            {selected.borrador && (
              <section className="draft">
                <div className="section-title">
                  <div><h3>Borrador de orden de compra</h3><p>Salida estructurada lista para integración.</p></div>
                  <button className="text-button" onClick={copyDraft}>{copied ? "Copiado" : "Copiar JSON"}</button>
                </div>
                <pre>{JSON.stringify(selected.borrador, null, 2)}</pre>
              </section>
            )}
          </article>
        )}
      </section>
      </>}
      <footer>Motor determinístico · Archivos sin persistencia · LLM opcional</footer>
    </main>
  );
}
