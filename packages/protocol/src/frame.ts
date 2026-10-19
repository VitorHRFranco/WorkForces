import { z } from "zod";
import { LIMITS } from "./constants.js";

export const Cursor = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  visible: z.boolean(),
});
export type Cursor = z.infer<typeof Cursor>;

/** Linha de quadro só tem texto e SGR (ESC [ … m); qualquer outro controle é recusado. */
const UNSAFE_IN_LINE = /\x1b(?!\[[0-9;:]*m)|[\x00-\x1a\x1c-\x1f\x7f-\x9f]/;
export const isSafeLine = (text: string): boolean => !UNSAFE_IN_LINE.test(text);

/** Campos de um quadro,reaproveitados por FrameBody e pela mensagem `frame` da ponte. */
export const frameShape = {
  seq: z.number().int().min(1),
  /** true = o destino limpa a tela antes de aplicar as linhas. */
  key: z.boolean(),
  cols: z.number().int().min(1).max(LIMITS.maxCols),
  rows: z.number().int().min(1).max(LIMITS.maxRows),
  cursor: Cursor,
  lines: z.array(z.tuple([z.number().int().min(0), z.string().refine(isSafeLine, "linha com controle fora de SGR")])).max(LIMITS.maxRows),
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
