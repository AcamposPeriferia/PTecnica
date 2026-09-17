import { parseCop } from "./normalization";
import type { Cotizacion, Factura } from "./types";

function requiredMatch(text: string, pattern: RegExp, field: string): string {
  const match = text.match(pattern)?.[1]?.trim();
  if (!match) throw new Error(`No fue posible extraer ${field}`);
  return match;
}

export function parseCotizacion(text: string): Cotizacion {
  const unitario = requiredMatch(text, /Precio unitario \(IVA incl\.\):\s*COP\s*([\d.]+)/i, "valor unitario");
  return {
    numero: requiredMatch(text, /COTIZACI[ÓO]N\s+([^\r\n]+)/i, "numero de cotizacion"),
    fecha: requiredMatch(text, /Fecha:\s*(\d{4}-\d{2}-\d{2})/i, "fecha de cotizacion"),
    proveedorNombre: requiredMatch(text, /Proveedor:\s*([^\r\n]+)/i, "proveedor"),
    proveedorNit: requiredMatch(text, /NIT:\s*([\d.-]+)/i, "NIT del proveedor"),
    descripcion: requiredMatch(text, /\d+\.\s*(.*?)\s*\|\s*Cantidad:/i, "descripcion"),
    cantidad: Number(requiredMatch(text, /Cantidad:\s*(\d+(?:[.,]\d+)?)/i, "cantidad").replace(",", ".")),
    valorUnitario: parseCop(unitario),
    subtotal: parseCop(requiredMatch(text, /Subtotal:\s*COP\s*([\d.]+)/i, "subtotal")),
    baseGravable: parseCop(requiredMatch(text, /Base gravable:\s*COP\s*([\d.]+)/i, "base gravable")),
    ivaTasa: Number(requiredMatch(text, /IVA\s*(\d+)%:/i, "tasa de IVA")) / 100,
    ivaValor: parseCop(requiredMatch(text, /IVA\s*\d+%:\s*COP\s*([\d.]+)/i, "valor de IVA")),
    total: parseCop(requiredMatch(text, /TOTAL(?: \(IVA incluido\))?:\s*COP\s*([\d.]+)/i, "total")),
    moneda: /\bCOP\b/.test(text) ? "COP" : "",
    validezDias: Number(requiredMatch(text, /Validez de la oferta:\s*(\d+)\s*d[ií]as/i, "vigencia")),
  };
}

export function parseFactura(text: string): Factura {
  return {
    numero: requiredMatch(text, /No\.\s*([^\r\n]+)/i, "numero de factura"),
    fecha: requiredMatch(text, /Fecha de emisión:\s*(\d{4}-\d{2}-\d{2})/i, "fecha de factura"),
    proveedorNit: requiredMatch(text, /Vendedor:.*?NIT\s*([\d.-]+)/i, "NIT de factura"),
    total: parseCop(requiredMatch(text, /TOTAL:\s*COP\s*([\d.]+)/i, "total de factura")),
  };
}
