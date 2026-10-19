import type { DeskInfo, OfficeMap } from "@workforces/protocol";

export interface Person {
  readonly id: number;
  readonly name: string;
}

/** O escritório em memória: dono de cada mesa (espelho do banco). Posições e chat entram nas próximas tarefas. */
export class World {
  private readonly ownerByDesk = new Map<string, Person>();
  private readonly deskByOwner = new Map<number, string>();

  constructor(
    readonly map: OfficeMap,
    owners: ReadonlyMap<string, Person>,
  ) {
    for (const [deskId, owner] of owners) {
      if (map.desks.some((desk) => desk.id === deskId)) this.setDesk(owner, deskId);
    }
  }

  deskIdOf(userId: number): string | null {
    return this.deskByOwner.get(userId) ?? null;
  }

  /** Registra a mesa da pessoa; devolve as mesas que mudaram (para avisar os navegadores). */
  setDesk(person: Person, deskId: string | null): DeskInfo[] {
    const previous = this.deskIdOf(person.id);
    if (previous === deskId) return [];
    const changed: DeskInfo[] = [];
    if (previous !== null) {
      this.ownerByDesk.delete(previous);
      this.deskByOwner.delete(person.id);
      changed.push(this.deskInfo(previous));
    }
    if (deskId !== null) {
      const former = this.ownerByDesk.get(deskId);
      if (former && former.id !== person.id) this.deskByOwner.delete(former.id);
      this.ownerByDesk.set(deskId, person);
      this.deskByOwner.set(person.id, deskId);
      changed.push(this.deskInfo(deskId));
    }
    return changed;
  }

  /** Todas as mesas do mapa, na ordem do mapa. */
  desks(): DeskInfo[] {
    return this.map.desks.map((desk) => this.deskInfo(desk.id));
  }

  private deskInfo(deskId: string): DeskInfo {
    const owner = this.ownerByDesk.get(deskId);
    return { id: deskId, ownerId: owner?.id ?? null, ownerName: owner?.name ?? null };
  }
}
