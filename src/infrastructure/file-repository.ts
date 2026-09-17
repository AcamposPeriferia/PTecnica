import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  aprobacionSchema,
  condicionPagoSchema,
  correoSchema,
  centroCostoSchema,
  indicadorIvaSchema,
  maestrosSchema,
  proveedorSchema,
  solicitudSchema,
  type Maestros,
} from "@/domain/schemas";
import { parseCotizacion, parseFactura } from "@/domain/parsers";
import type { Expediente } from "@/domain/types";
import { z } from "zod";

async function readMaestroJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.join(process.cwd(), "maestros", file), "utf8"));
}

async function readSolicitudJson(folder: string, file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.join(process.cwd(), "solicitudes", folder, file), "utf8"));
}

async function readSolicitudText(folder: string, file: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "solicitudes", folder, file), "utf8");
}

export async function loadMaestros(): Promise<Maestros> {
  const [proveedores, centros, indicadoresIva, condicionesPago] = await Promise.all([
    readMaestroJson("proveedores.json").then((value) => z.array(proveedorSchema).parse(value)),
    readMaestroJson("centros-costo.json").then((value) => z.array(centroCostoSchema).parse(value)),
    readMaestroJson("indicadores-iva.json").then((value) => z.array(indicadorIvaSchema).parse(value)),
    readMaestroJson("condiciones-pago.json").then((value) => z.array(condicionPagoSchema).parse(value)),
  ]);
  return maestrosSchema.parse({ proveedores, centros, indicadoresIva, condicionesPago });
}

export async function loadExpedientes(): Promise<Expediente[]> {
  const solicitudesRoot = path.join(process.cwd(), "solicitudes");
  const folders = (await fs.readdir(solicitudesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    folders.map(async (carpeta) => {
      const invoicePath = path.join(solicitudesRoot, carpeta, "factura.txt");
      const [solicitud, correo, aprobacion, cotizacionText, hasInvoice] = await Promise.all([
        readSolicitudJson(carpeta, "solicitud.json").then((value) => solicitudSchema.parse(value)),
        readSolicitudJson(carpeta, "correo.json").then((value) => correoSchema.parse(value)),
        readSolicitudJson(carpeta, "aprobacion.json").then((value) => aprobacionSchema.parse(value)),
        readSolicitudText(carpeta, "cotizacion.txt"),
        fs.access(invoicePath).then(() => true).catch(() => false),
      ]);
      return {
        carpeta,
        solicitud,
        correo,
        aprobacion,
        cotizacion: parseCotizacion(cotizacionText),
        factura: hasInvoice ? parseFactura(await readSolicitudText(carpeta, "factura.txt")) : undefined,
      };
    }),
  );
}
