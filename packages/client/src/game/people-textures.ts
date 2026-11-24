import { appearanceKey, type Appearance } from "@workforces/protocol";

/** Como montar a folha de uma aparência e registrá-la no jogo (a folha e as animações). Injetado, para o teste não precisar do Phaser. */
export interface PeopleTexturesDeps<Sheet> {
  compose(appearance: Appearance): Sheet;
  register(key: string, sheet: Sheet): void;
}

/** As folhas das pessoas: cada aparência diferente é montada e registrada uma vez, e reaproveitada por quem tem a mesma. */
export class PeopleTextures<Sheet> {
  private readonly known = new Set<string>();

  constructor(private readonly deps: PeopleTexturesDeps<Sheet>) {}

  /** A chave da textura da aparência; na primeira vez, monta e registra. */
  ensure(appearance: Appearance): string {
    const key = `person:${appearanceKey(appearance)}`;
    if (!this.known.has(key)) {
      this.deps.register(key, this.deps.compose(appearance));
      this.known.add(key);
    }
    return key;
  }
}
