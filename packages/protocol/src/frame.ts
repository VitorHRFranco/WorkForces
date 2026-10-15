import { z } from "zod";
import { LIMITS } from "./constants.js";

export const Cursor = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  visible: z.boolean(),
});
export type Cursor = z.infer<typeof Cursor>;

/** Campos de um quadro, reaproveitados por FrameBody e pela mensagem `frame` da ponte. */
export const frameShape = {
  seq: z.number().int().min(1),
  /** true = o destino limpa a tela antes de aplicar as linhas. */
  key: z.boolean(),
  cols: z.number().int().min(1).max(LIMITS.maxCols),
  rows: z.number().int().min(1).max(LIMITS.maxRows),
  cursor: Cursor,
  lines: z.array(z.tuple([z.number().int().min(0), z.string()])).max(LIMITS.maxRows),
};

interface FrameGeometry {
  cols: number;
  rows: number;
  cursor: Cursor;
  lines: [number, string][];
}

/** Descreve o problema se alguma linha ou o cursor estiverem fora da tela. */
export function frameBoundsError(frame: FrameGeometry): string | null {
  const outside = frame.lines.find(([row]) => row >= frame.rows);
  if (outside) return `linha ${outside[0]} fora da tela de ${frame.rows} linhas`;
  if (frame.cursor.x >= frame.cols || frame.cursor.y >= frame.rows) return "cursor fora da tela";
  return null;
}

export const FrameBody = z.object(frameShape).superRefine((frame, ctx) => {
  const error = frameBoundsError(frame);
  if (error) ctx.addIssue({ code: "custom", message: error });
});
export type FrameBody = z.infer<typeof FrameBody>;
