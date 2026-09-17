import { describe, expect, it } from "vitest";
import { loadExpedientes, loadMaestros } from "@/infrastructure/file-repository";

describe("fixtures entregados", () => {
  it("carga y valida los cuatro maestros", async () => {
    const maestros = await loadMaestros();
    expect(maestros.proveedores).toHaveLength(5);
    expect(maestros.centros).toHaveLength(3);
    expect(maestros.indicadoresIva).toHaveLength(3);
    expect(maestros.condicionesPago).toHaveLength(4);
  });

  it("carga los seis expedientes y la factura opcional", async () => {
    const expedientes = await loadExpedientes();
    expect(expedientes).toHaveLength(6);
    expect(expedientes.filter((item) => item.factura)).toHaveLength(1);
    expect(expedientes.find((item) => item.carpeta === "sol-005")?.factura?.numero).toBe("FC-88231");
  });
});
