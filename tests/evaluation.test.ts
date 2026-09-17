import { beforeAll, describe, expect, it } from "vitest";
import { getEvaluations } from "@/application/evaluations";
import type { Evaluacion } from "@/domain/types";

describe("motor de evaluacion", () => {
  let evaluations: Evaluacion[];

  beforeAll(async () => {
    evaluations = await getEvaluations();
  });

  function byFolder(folder: string) {
    const result = evaluations.find((item) => item.carpeta === folder);
    if (!result) throw new Error(`No se encontro ${folder}`);
    return result;
  }

  it("aprueba el expediente completamente consistente", () => {
    expect(byFolder("sol-001").status).toBe("APROBADA");
    expect(byFolder("sol-001").borrador?.proveedorCodigoSap).toBe("100234");
  });

  it("bloquea un proveedor no registrado", () => {
    const result = byFolder("sol-002");
    expect(result.status).toBe("BLOQUEADA");
    expect(result.hallazgos.map((item) => item.codigo)).toContain("PROVEEDOR_NO_REGISTRADO");
  });

  it("bloquea una aprobacion de otro centro", () => {
    const result = byFolder("sol-003");
    expect(result.status).toBe("BLOQUEADA");
    expect(result.hallazgos.map((item) => item.codigo)).toContain("APROBADOR_NO_AUTORIZADO");
  });

  it("detecta diferencias monetarias con la cotizacion", () => {
    const result = byFolder("sol-004");
    expect(result.status).toBe("BLOQUEADA");
    expect(result.hallazgos.find((item) => item.codigo === "COTIZACION_NO_COINCIDE")?.detalle).toContain("valor unitario, valor total");
  });

  it("envia a revision manual una compra retroactiva", () => {
    const result = byFolder("sol-005");
    expect(result.status).toBe("REQUIERE_REVISION");
    expect(result.hallazgos.map((item) => item.codigo)).toContain("COMPRA_RETROACTIVA");
  });

  it("enriquece y aprueba campos ausentes cuando la fuente es inequivoca", () => {
    const result = byFolder("sol-006");
    expect(result.status).toBe("APROBADA");
    expect(result.borrador).toMatchObject({
      proveedorNit: "900555111",
      indicadorIva: "C1",
      condicionesPago: "Z030",
    });
    expect(result.campos.filter((item) => item.origen !== "solicitud")).toHaveLength(3);
  });
});
