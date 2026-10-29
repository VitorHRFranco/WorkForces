/** Apelido de pasta liberada (spec 5.2). O servidor nunca conhece apelidos nem caminhos. */
export const ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** Quantas pastas uma ponte (ou o app) libera. */
export const MAX_ALIASES = 50;
