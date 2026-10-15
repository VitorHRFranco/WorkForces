export const PROTOCOL_VERSION = 1;

export const LIMITS = {
  maxCols: 500,
  maxRows: 200,
  maxFrameBytes: 256 * 1024,
  maxLabelLength: 64,
} as const;

/** Códigos de fechamento de WebSocket usados pelo servidor (spec, seção 7). */
export const CLOSE_CODES = {
  invalidMessage: 4000,
  unauthorized: 4001,
  protocolMismatch: 4002,
  originNotAllowed: 4003,
  rateLimited: 4008,
  replacedByNewTab: 4009,
} as const;
