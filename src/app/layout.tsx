import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Control de compras | Periferia",
  description: "Validación auditable de solicitudes de orden de compra.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
