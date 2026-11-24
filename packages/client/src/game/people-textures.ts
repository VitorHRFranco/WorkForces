import { appearanceKey, type Appearance } from "@workforces/protocol";

/** Começo da chave da textura de uma aparência: `person:<appearanceKey>`. */
export const PERSON_TEXTURE_PREFIX = "person:";

/** Como montar a folha de uma aparência, registrá-la no jogo (a folha e as animações) e tirá-la de lá. Injetado, para o teste não precisar do Phaser. */
export interface PeopleTexturesDeps<Sheet> {
  compose(appearance: Appearance): Sheet;
  register(key: string, sheet: Sheet): void;
  unregister(key: string): void;
}

/** As folhas das pessoas: cada aparência diferente é montada e registrada uma vez, reaproveitada por quem tem a mesma e solta quando ninguém mais a usa. */
export class PeopleTextures<Sheet> {
  /** Quantos usam cada folha registrada. */
  private readonly uses = new Map<string, number>();

  constructor(private readonly deps: PeopleTexturesDeps<Sheet>) {}

  /** A chave da textura da aparência, contando mais um uso; na primeira vez, monta e registra. */
  acquire(appearance: Appearance): string {
    const key = PERSON_TEXTURE_PREFIX + appearanceKey(appearance);
    const uses = this.uses.get(key) ?? 0;
    if (uses === 0) this.deps.register(key, this.deps.compose(appearance));
    this.uses.set(key, uses + 1);
    return key;
  }

  /** Desconta um uso; no último, tira a folha do jogo. */
  release(key: string): void {
    const uses = this.uses.get(key);
    if (uses === undefined) return;
    if (uses > 1) {
      this.uses.set(key, uses - 1);
      return;
    }
    this.uses.delete(key);
    this.deps.unregister(key);
  }
}
