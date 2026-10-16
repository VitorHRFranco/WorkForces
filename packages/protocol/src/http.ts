import { z } from "zod";

/** 2 a 32 letras, números, ponto, sublinhado ou hífen. */
export const USER_NAME_PATTERN = /^[\p{L}\p{N}._-]{2,32}$/u;
export const MIN_PASSWORD_LENGTH = 10;

/** Cadastro (aceitar convite). */
export const Credentials = z.object({
  name: z.string().regex(USER_NAME_PATTERN),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});
export type Credentials = z.infer<typeof Credentials>;

/** Login: não revela as regras de cadastro. */
export const LoginRequest = z.object({ name: z.string().min(1).max(64), password: z.string().min(1).max(200) });
export type LoginRequest = z.infer<typeof LoginRequest>;

export const CreateTokenRequest = z.object({ name: z.string().trim().min(1).max(40) });
export type CreateTokenRequest = z.infer<typeof CreateTokenRequest>;

export interface TokenInfo {
  id: number;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface TokenCreated {
  id: number;
  name: string;
  /** Mostrado uma única vez. */
  token: string;
}

export interface InviteCreated {
  url: string;
  expiresAt: number;
}

export interface InviteStatus {
  valid: boolean;
}

export interface WhoAmI {
  name: string;
}

export interface ApiErrorBody {
  error: string;
}
