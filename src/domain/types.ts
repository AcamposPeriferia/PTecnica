import type { Aprobacion, Correo, Solicitud } from "./schemas";

export type Status = "APROBADA" | "BLOQUEADA" | "REQUIERE_REVISION";
export type Severity = "OK" | "INFO" | "ADVERTENCIA" | "BLOQUEANTE";

export interface Cotizacion {
  numero: string;
  fecha: string;
  proveedorNombre: string;
  proveedorNit: string;
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
  subtotal: number;
  baseGravable: number;
  ivaTasa: number;
  ivaValor: number;
  total: number;
  moneda: string;
  validezDias: number;
}

export interface Factura {
  numero: string;
  fecha: string;
  proveedorNit: string;
  total: number;
}

export interface Expediente {
  carpeta: string;
  solicitud: Solicitud;
  correo?: Correo;
  aprobacion: Aprobacion;
  cotizacion: Cotizacion;
  factura?: Factura;
}

export type DocumentKind = "solicitud" | "cotizacion" | "aprobacion" | "factura" | "desconocido";

export interface IngestionDocument {
  name: string;
  kind: DocumentKind;
  status: "extraido" | "requiere_llm" | "error";
  method?: "deterministico" | "llm";
  pages?: number;
  detail: string;
}

export interface IngestionResponse {
  documents: IngestionDocument[];
  evaluation?: Evaluacion;
  llmConfigured: boolean;
  issues: string[];
}

export interface Hallazgo {
  codigo: string;
  titulo: string;
  detalle: string;
  severidad: Severity;
  fuente: string;
}

export interface CampoResuelto {
  campo: string;
  valor: string;
  origen: "solicitud" | "cotizacion" | "maestro";
}

export interface BorradorOrden {
  solicitudId: string;
  proveedorCodigoSap: string;
  proveedorNit: string;
  proveedorNombre: string;
  descripcion: string;
  centroCosto: string;
  subarea: string;
  cantidad: number;
  valorUnitario: number;
  valorTotal: number;
  moneda: string;
  indicadorIva: string;
  condicionesPago: string;
  aprobador: string;
}

export interface Evaluacion {
  carpeta: string;
  solicitudId: string;
  solicitante: string;
  descripcion: string;
  proveedor: string;
  centroCosto: string;
  subarea: string;
  fechaSolicitud: string;
  valorSolicitado: number;
  valorCotizado: number;
  status: Status;
  resumen: string;
  hallazgos: Hallazgo[];
  campos: CampoResuelto[];
  borrador?: BorradorOrden;
  tieneFactura: boolean;
}
