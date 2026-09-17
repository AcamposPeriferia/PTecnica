import { formatCop, normalizeNit, normalizeText } from "./normalization";
import type { Maestros, Proveedor } from "./schemas";
import type { CampoResuelto, Evaluacion, Expediente, Hallazgo, Severity } from "./types";

function finding(codigo: string, titulo: string, detalle: string, severidad: Severity, fuente: string): Hallazgo {
  return { codigo, titulo, detalle, severidad, fuente };
}

function findProvider(expediente: Expediente, maestros: Maestros): Proveedor | undefined {
  const candidateNits = [expediente.solicitud.proveedor_nit, expediente.cotizacion.proveedorNit]
    .filter(Boolean)
    .map((value) => normalizeNit(value!));
  return maestros.proveedores.find(
    (provider) =>
      candidateNits.includes(normalizeNit(provider.nit)) ||
      normalizeText(provider.nombre) === normalizeText(expediente.solicitud.proveedor_nombre),
  );
}

export function evaluarExpediente(expediente: Expediente, maestros: Maestros): Evaluacion {
  const { solicitud, cotizacion, aprobacion, correo, factura } = expediente;
  const hallazgos: Hallazgo[] = [];
  const campos: CampoResuelto[] = [];
  const proveedor = findProvider(expediente, maestros);
  const centro = maestros.centros.find((item) => item.centro_costo === solicitud.centro_costo);

  if (!proveedor) {
    hallazgos.push(
      finding("PROVEEDOR_NO_REGISTRADO", "Proveedor no registrado", "No existe una coincidencia inequívoca en el maestro de proveedores.", "BLOQUEANTE", "maestros/proveedores.json"),
    );
  } else if (!proveedor.activo) {
    hallazgos.push(finding("PROVEEDOR_INACTIVO", "Proveedor inactivo", `${proveedor.nombre} no esta habilitado para compras.`, "BLOQUEANTE", "maestros/proveedores.json"));
  } else {
    hallazgos.push(finding("PROVEEDOR_VALIDO", "Proveedor habilitado", `${proveedor.nombre} esta activo con codigo SAP ${proveedor.codigo_sap}.`, "OK", "maestros/proveedores.json"));
  }

  const nitResuelto = solicitud.proveedor_nit ?? (proveedor ? proveedor.nit : cotizacion.proveedorNit);
  campos.push({ campo: "NIT del proveedor", valor: normalizeNit(nitResuelto), origen: solicitud.proveedor_nit ? "solicitud" : cotizacion.proveedorNit ? "cotizacion" : "maestro" });
  const ivaResuelto = solicitud.indicador_iva ?? proveedor?.indicador_iva_default;
  const pagoResuelto = solicitud.condiciones_pago ?? proveedor?.condiciones_pago_default;
  if (ivaResuelto) campos.push({ campo: "Indicador de IVA", valor: ivaResuelto, origen: solicitud.indicador_iva ? "solicitud" : "maestro" });
  if (pagoResuelto) campos.push({ campo: "Condicion de pago", valor: pagoResuelto, origen: solicitud.condiciones_pago ? "solicitud" : "maestro" });

  const enriched = campos.filter((item) => item.origen !== "solicitud");
  if (enriched.length) {
    hallazgos.push(finding("DATOS_ENRIQUECIDOS", "Datos completados", `${enriched.map((item) => item.campo).join(", ")} se recuperaron de fuentes verificables.`, "INFO", "cotizacion y maestros"));
  }

  if (!centro) {
    hallazgos.push(finding("CENTRO_INVALIDO", "Centro de costo inexistente", `${solicitud.centro_costo} no aparece en el maestro.`, "BLOQUEANTE", "maestros/centros-costo.json"));
  } else if (!centro.subareas.includes(solicitud.subarea)) {
    hallazgos.push(finding("SUBAREA_INVALIDA", "Subarea no autorizada", `${solicitud.subarea} no pertenece a ${centro.nombre}.`, "BLOQUEANTE", "maestros/centros-costo.json"));
  } else {
    hallazgos.push(finding("IMPUTACION_VALIDA", "Imputacion valida", `${solicitud.subarea} pertenece al centro ${centro.nombre}.`, "OK", "solicitud.json"));
  }

  if (solicitud.cantidad * solicitud.valor_unitario !== solicitud.valor_total) {
    hallazgos.push(finding("ARITMETICA_INVALIDA", "Total inconsistente", "Cantidad por valor unitario no coincide con el total solicitado.", "BLOQUEANTE", "solicitud.json"));
  }

  const mismatches: string[] = [];
  if (solicitud.cantidad !== cotizacion.cantidad) mismatches.push("cantidad");
  if (solicitud.valor_unitario !== cotizacion.valorUnitario) mismatches.push("valor unitario");
  if (solicitud.valor_total !== cotizacion.total) mismatches.push("valor total");
  if (solicitud.moneda !== cotizacion.moneda) mismatches.push("moneda");
  if (solicitud.proveedor_nit && normalizeNit(solicitud.proveedor_nit) !== normalizeNit(cotizacion.proveedorNit)) mismatches.push("NIT");
  if (mismatches.length) {
    hallazgos.push(finding("COTIZACION_NO_COINCIDE", "Solicitud y cotizacion difieren", `Campos diferentes: ${mismatches.join(", ")}. Solicitado ${formatCop(solicitud.valor_total)}; cotizado ${formatCop(cotizacion.total)}.`, "BLOQUEANTE", "solicitud.json / cotizacion.txt"));
  } else {
    hallazgos.push(finding("COTIZACION_COINCIDE", "Cotizacion consistente", "Cantidad, valores, moneda y proveedor coinciden con la solicitud.", "OK", "cotizacion.txt"));
  }

  if (!ivaResuelto || !maestros.indicadoresIva.some((item) => item.codigo === ivaResuelto)) {
    hallazgos.push(finding("IVA_INVALIDO", "Indicador de IVA invalido", "No se pudo resolver un indicador registrado.", "BLOQUEANTE", "maestros/indicadores-iva.json"));
  }
  if (!pagoResuelto || !maestros.condicionesPago.some((item) => item.codigo === pagoResuelto)) {
    hallazgos.push(finding("PAGO_INVALIDO", "Condicion de pago invalida", "No se pudo resolver una condicion registrada.", "BLOQUEANTE", "maestros/condiciones-pago.json"));
  }

  const approver = centro?.aprobadores.find((item) => item.email.toLowerCase() === aprobacion.de.toLowerCase());
  if (!/\baprobado(?:a)?\b/i.test(aprobacion.cuerpo)) {
    hallazgos.push(finding("APROBACION_NO_EXPLICITA", "Aprobación no explícita", "El mensaje no contiene una declaración inequívoca de aprobación.", "BLOQUEANTE", "aprobacion.eml"));
  } else if (!approver) {
    hallazgos.push(finding("APROBADOR_NO_AUTORIZADO", "Aprobador no autorizado", `${aprobacion.de} no es aprobador de ${solicitud.centro_costo}.`, "BLOQUEANTE", "aprobacion.json / centros-costo.json"));
  } else if (cotizacion.total > approver.tope) {
    hallazgos.push(finding("TOPE_EXCEDIDO", "Monto fuera del tope", `${approver.nombre} puede aprobar hasta ${formatCop(approver.tope)}.`, "BLOQUEANTE", "maestros/centros-costo.json"));
  } else {
    hallazgos.push(finding("APROBACION_VALIDA", "Aprobacion autorizada", `${approver.nombre} tiene facultad suficiente para este monto.`, "OK", "aprobacion.json"));
  }

  const expiry = new Date(`${cotizacion.fecha}T00:00:00-05:00`);
  expiry.setDate(expiry.getDate() + cotizacion.validezDias);
  if (new Date(`${solicitud.fecha_solicitud}T00:00:00-05:00`) > expiry) {
    hallazgos.push(finding("COTIZACION_VENCIDA", "Cotizacion vencida", `La oferta tenia ${cotizacion.validezDias} dias de vigencia.`, "BLOQUEANTE", "cotizacion.txt"));
  }

  if (factura && new Date(factura.fecha) < new Date(solicitud.fecha_solicitud)) {
    hallazgos.push(finding("COMPRA_RETROACTIVA", "Factura anterior a la solicitud", `La factura ${factura.numero} fue emitida el ${factura.fecha}; requiere validar la politica de excepciones.`, "ADVERTENCIA", "factura.txt"));
  }

  if (correo && new Date(aprobacion.fecha) > new Date(correo.fecha) && correo.adjuntos.includes("aprobacion.eml")) {
    hallazgos.push(finding("CRONOLOGIA_ADJUNTO", "Cronologia del correo", "La aprobacion tiene fecha posterior al correo que la enumera como adjunto. Se conserva como observacion del fixture.", "INFO", "correo.json / aprobacion.json"));
  }

  const hasBlocker = hallazgos.some((item) => item.severidad === "BLOQUEANTE");
  const needsReview = hallazgos.some((item) => item.severidad === "ADVERTENCIA");
  const status = hasBlocker ? "BLOQUEADA" : needsReview ? "REQUIERE_REVISION" : "APROBADA";
  const resumen = status === "APROBADA" ? "Lista para generar la orden de compra." : status === "BLOQUEADA" ? "Tiene incumplimientos que impiden crear la orden." : "Necesita una decision humana antes de continuar.";

  const borrador = status === "APROBADA" && proveedor && ivaResuelto && pagoResuelto && approver
    ? {
        solicitudId: solicitud.solicitud_id,
        proveedorCodigoSap: proveedor.codigo_sap,
        proveedorNit: normalizeNit(proveedor.nit),
        proveedorNombre: proveedor.nombre,
        descripcion: solicitud.descripcion,
        centroCosto: solicitud.centro_costo,
        subarea: solicitud.subarea,
        cantidad: solicitud.cantidad,
        valorUnitario: cotizacion.valorUnitario,
        valorTotal: cotizacion.total,
        moneda: solicitud.moneda,
        indicadorIva: ivaResuelto,
        condicionesPago: pagoResuelto,
        aprobador: approver.email,
      }
    : undefined;

  return {
    carpeta: expediente.carpeta,
    solicitudId: solicitud.solicitud_id,
    solicitante: solicitud.solicitante,
    descripcion: solicitud.descripcion,
    proveedor: proveedor?.nombre ?? solicitud.proveedor_nombre,
    centroCosto: solicitud.centro_costo,
    subarea: solicitud.subarea,
    fechaSolicitud: solicitud.fecha_solicitud,
    valorSolicitado: solicitud.valor_total,
    valorCotizado: cotizacion.total,
    status,
    resumen,
    hallazgos,
    campos,
    borrador,
    tieneFactura: Boolean(factura),
  };
}
