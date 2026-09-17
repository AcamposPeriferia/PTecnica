import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Proveedor } from "@/domain/schemas";
import type { OrdenCompra } from "@/tools/types";
import type { SapAdapter } from "./adapter";

interface StoredOrder {
  numero_oc: string;
  fecha: string;
  orden: OrdenCompra;
}

async function readJsonLines(file: string): Promise<StoredOrder[]> {
  try {
    const content = await readFile(file, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StoredOrder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export class FileSapAdapter implements SapAdapter {
  private readonly sapDirectory: string;
  private readonly ordersFile: string;

  constructor(
    private readonly projectDirectory: string,
    outputDirectory: string,
  ) {
    this.sapDirectory = path.join(outputDirectory, "sap");
    this.ordersFile = path.join(this.sapDirectory, "ordenes.jsonl");
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const content = await readFile(path.join(this.projectDirectory, "fixtures", "maestros", "proveedores.json"), "utf8");
    const providers = JSON.parse(content) as Proveedor[];
    const normalized = nit.replace(/\D/g, "").slice(0, 9);
    const provider = providers.find((item) => item.nit.replace(/\D/g, "").slice(0, 9) === normalized);
    return provider ? { codigo_sap: provider.codigo_sap, activo: provider.activo } : null;
  }

  async buscarOrdenPorReferencia(solicitudId: string): Promise<{ numero_oc: string } | null> {
    const orders = await readJsonLines(this.ordersFile);
    const existing = orders.find((item) => item.orden.referencia.solicitud_id === solicitudId);
    return existing ? { numero_oc: existing.numero_oc } : null;
  }

  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    await mkdir(this.sapDirectory, { recursive: true });
    const orders = await readJsonLines(this.ordersFile);
    const existing = orders.find((item) => item.orden.referencia.solicitud_id === orden.referencia.solicitud_id);
    if (existing) return { numero_oc: existing.numero_oc, fecha: existing.fecha };

    const numero = String(4_500_000_001 + orders.length);
    const fecha = new Date().toISOString();
    const next: StoredOrder = { numero_oc: numero, fecha, orden };
    const serialized = [...orders, next].map((item) => JSON.stringify(item)).join("\n") + "\n";
    await writeFile(this.ordersFile, serialized, "utf8");
    return { numero_oc: numero, fecha };
  }
}
