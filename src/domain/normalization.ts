export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

export function normalizeNit(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? digits.slice(0, -1) : digits;
}

export function parseCop(value: string): number {
  return Number(value.replace(/\D/g, ""));
}

export function formatCop(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
}
