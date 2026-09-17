import { describe, expect, it } from "vitest";
import { normalizeNit, parseCop } from "@/domain/normalization";

describe("normalizacion", () => {
  it("normaliza NIT con puntuacion y digito de verificacion", () => {
    expect(normalizeNit("900.555.111-2")).toBe("900555111");
  });

  it("convierte importes COP en enteros", () => {
    expect(parseCop("COP 26.500.000")).toBe(26_500_000);
  });
});
