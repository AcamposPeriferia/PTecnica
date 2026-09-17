import "server-only";

import { tmpdir } from "node:os";
import path from "node:path";

export function runtimeOutputDirectory(): string {
  return process.env.VERCEL ? path.join(tmpdir(), "ordenes-compra") : path.join(process.cwd(), "out");
}
