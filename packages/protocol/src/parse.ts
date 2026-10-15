import type { z } from "zod";

/** JSON.parse seguido de validação; devolve null para qualquer entrada inválida. */
export function parseJson<T>(schema: z.ZodType<T>, raw: string): T | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}
