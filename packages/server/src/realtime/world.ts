import { inZone, type DeskInfo, type Direction, type OfficeMap, type PlayerInfo, type Point } from "@workforces/protocol";

export interface Person {
  readonly id: number;
  readonly name: string;
}

/** O escritório em memória: dono de cada mesa (espelho do banco) e quem está online, com a posição. */
export class World {
  private readonly ownerByDesk = new Map<string, Person>();
  private readonly deskByOwner = new Map<number, string>();
  private readonly players = new Map<number, PlayerInfo>();
  /** Onde cada um estava ao sair (só enquanto o servidor estiver no ar). */
  private readonly lastSeen = new Map<number, PlayerInfo>();

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

  isOnline(userId: number): boolean {
    return this.players.has(userId);
  }

  /** Entra no mapa: na última posição conhecida ou na entrada. Quem já está online continua onde está. */
  join(person: Person): PlayerInfo {
    const current = this.players.get(person.id);
    if (current) return current;
    const last = this.lastSeen.get(person.id);
    const player: PlayerInfo = last
      ? { ...last, name: person.name, moving: false }
      : { id: person.id, name: person.name, x: this.map.spawn.x, y: this.map.spawn.y, dir: "down", moving: false };
    this.players.set(person.id, player);
    return player;
  }

  leave(userId: number): void {
    const player = this.players.get(userId);
    if (!player) return;
    this.lastSeen.set(userId, { ...player, moving: false });
    this.players.delete(userId);
  }

  /** Nova posição, limitada aos limites do mapa (colisão com paredes é conferida só no navegador). */
  move(userId: number, x: number, y: number, dir: Direction, moving: boolean): PlayerInfo | null {
    const player = this.players.get(userId);
    if (!player) return null;
    const moved: PlayerInfo = { ...player, x: clamp(x, 0, this.map.widthPx), y: clamp(y, 0, this.map.heightPx), dir, moving };
    this.players.set(userId, moved);
    return moved;
  }

  online(): PlayerInfo[] {
    return [...this.players.values()];
  }

  position(userId: number): Point | null {
    const player = this.players.get(userId);
    return player ? { x: player.x, y: player.y } : null;
  }

  private deskInfo(deskId: string): DeskInfo {
    const owner = this.ownerByDesk.get(deskId);
    return { id: deskId, ownerId: owner?.id ?? null, ownerName: owner?.name ?? null };
  }

  /** Quem assiste precisa estar na zona da mesa do dono, com folga de 1 tile; dono sem mesa no mapa não pode ser assistido. */
  canWatch(viewerId: number, ownerId: number): boolean {
    const deskId = this.deskIdOf(ownerId);
    const desk = deskId === null ? undefined : this.map.desks.find((candidate) => candidate.id === deskId);
    const viewer = this.position(viewerId);
    return desk !== undefined && viewer !== null && inZone(desk.zone, viewer, this.map.tileSize);
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
