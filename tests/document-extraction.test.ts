import { describe, expect, it } from "vitest";
import { classifyDocument, extractApproval, parseSolicitudRows, validateSignature } from "@/application/document-extraction";

describe("ingesta documental", () => {
  it("extrae una solicitud desde una hoja de pares campo-valor", () => {
    const result = parseSolicitudRows([
      ["Solicitud ID", "SOL-2026-099"],
      ["Solicitante", "Laura Gómez"],
      ["Proveedor", "TecnoSuministros S.A.S."],
      ["NIT", "900555111"],
      ["Descripción", "Renovación de equipos"],
      ["Centro de costo", "CC-1010"],
      ["Subárea", "Infraestructura"],
      ["Cantidad", 2],
      ["Valor unitario", 100_000],
      ["Valor total", 200_000],
      ["Moneda", "COP"],
      ["Indicador IVA", "C1"],
      ["Condición de pago", "Z030"],
      ["Fecha solicitud", "2026-09-17"],
    ]);
    expect(result.errors).toEqual([]);
    expect(result.solicitud).toMatchObject({ solicitud_id: "SOL-2026-099", valor_total: 200_000 });
  });

  it("extrae cabeceras y cuerpo desde un EML", async () => {
    const eml = Buffer.from([
      "From: Mariana Lopez <mlopez@periferia-ficticia.com>",
      "To: Laura Gomez <laura@periferia-ficticia.com>",
      "Cc: compras@periferia-ficticia.com",
      "Date: Thu, 17 Sep 2026 10:00:00 -0500",
      "Subject: RE: Solicitud SOL-099",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Aprobado. Proceder con la orden.",
    ].join("\r\n"));
    const result = await extractApproval(eml);
    expect(result.value.de).toBe("mlopez@periferia-ficticia.com");
    expect(result.value.cuerpo).toContain("Aprobado");
  });

  it("clasifica por extensión y valida firmas binarias", () => {
    expect(classifyDocument(new File([], "solicitud.xlsx"))).toBe("solicitud");
    expect(classifyDocument(new File([], "factura.pdf"))).toBe("factura");
    expect(validateSignature("cotizacion", Buffer.from("%PDF-1.7"))).toBe(true);
    expect(validateSignature("solicitud", Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(validateSignature("aprobacion", Buffer.from("From: a@b.com\r\nSubject: Aprobado"))).toBe(true);
  });
});
