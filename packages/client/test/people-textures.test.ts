import { describe, expect, it } from "vitest";
import { LEGACY, appearanceKey, type Appearance } from "@workforces/protocol";
import { PeopleTextures } from "../src/game/people-textures";

function textures() {
  const composed: string[] = [];
  const registered: string[] = [];
  const unregistered: string[] = [];
  const peopleTextures = new PeopleTextures<string>({
    compose: (appearance) => {
      const sheet = `folha de ${appearanceKey(appearance)}`;
      composed.push(sheet);
      return sheet;
    },
    register: (key) => registered.push(key),
    unregister: (key) => unregistered.push(key),
  });
  return { peopleTextures, composed, registered, unregistered };
}

describe("PeopleTextures", () => {
  it("monta e registra cada aparência uma vez só, mesmo com as chaves em outra ordem", () => {
    const { peopleTextures, composed, registered } = textures();
    const appearance: Appearance = LEGACY[0];
    const reordered = Object.fromEntries(Object.entries(appearance).reverse()) as Appearance;
    const key = peopleTextures.acquire(appearance);
    expect(peopleTextures.acquire(reordered)).toBe(key);
    expect(peopleTextures.acquire(appearance)).toBe(key);
    expect(key).toBe(`person:${appearanceKey(appearance)}`);
    expect(composed).toHaveLength(1);
    expect(registered).toEqual([key]);
  });

  it("outra aparência monta de novo, com outra chave", () => {
    const { peopleTextures, composed, registered } = textures();
    const first = peopleTextures.acquire(LEGACY[0]);
    const second = peopleTextures.acquire(LEGACY[1]);
    expect(second).not.toBe(first);
    expect(composed).toHaveLength(2);
    expect(registered).toEqual([first, second]);
  });

  it("conta os usos: só solta no último release, e depois monta de novo", () => {
    const { peopleTextures, composed, unregistered } = textures();
    const key = peopleTextures.acquire(LEGACY[2]);
    peopleTextures.acquire(LEGACY[2]);
    expect(composed).toHaveLength(1);
    peopleTextures.release(key);
    expect(unregistered).toEqual([]);
    peopleTextures.release(key);
    expect(unregistered).toEqual([key]);
    expect(peopleTextures.acquire(LEGACY[2])).toBe(key);
    expect(composed).toHaveLength(2);
  });
});
