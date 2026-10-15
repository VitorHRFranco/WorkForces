import type { MaskPattern } from "./mask.js";

const KEY_NAMES = "password|passwd|pwd|senha|secret|token|api[_-]?key|access[_-]?key|accountkey";

/** Padrões embutidos (spec 5.6). O servidor não consegue desligar nem alterar esta lista. */
export const BUILTIN_PATTERNS: readonly MaskPattern[] = [
  { name: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}/dg },
  { name: "github-pat", regex: /\bgithub_pat_[A-Za-z0-9_]{20,}/dg },
  { name: "gitlab-pat", regex: /\bglpat-[A-Za-z0-9_-]{20,}/dg },
  { name: "anthropic-key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/dg },
  { name: "openai-key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/dg },
  { name: "aws-access-key", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/dg },
  { name: "slack-token", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/dg },
  { name: "google-api-key", regex: /\bAIza[0-9A-Za-z_-]{35}/dg },
  { name: "npm-token", regex: /\bnpm_[A-Za-z0-9]{36}/dg },
  { name: "workforces-token", regex: /\bwf_[A-Za-z0-9_-]{20,}/dg },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*)?/dg },
  { name: "bearer", regex: /\bBearer\s+([A-Za-z0-9._~+\/=-]{16,})/dgi, group: 1 },
  { name: "url-password", regex: /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/@]+:([^\s@/]+)@/dgi, group: 1 },
  {
    name: "key-value",
    regex: new RegExp(`(?:${KEY_NAMES})[A-Za-z0-9_.-]{0,32}["']?\\s*[:=]\\s*["']?([^\\s"',;]{4,})`, "dgi"),
    group: 1,
  },
];
