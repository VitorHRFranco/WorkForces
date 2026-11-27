import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../atomic-write.js";

/** De quem é a identidade: a conta (escritório e nome), a pasta (o caminho, não o apelido) e o nome do agente. */
export interface AgentKey {
  office: string;
  user: string;
  folder: string;
  label: string;
}

/** Bem acima do que uma pessoa usa: os mais antigos saem primeiro. */
export const MAX_AGENT_IDS = 200;

const Entry = z.object({ office: z.string(), user: z.string(), folder: z.string(), label: z.string(), agentId: z.uuid(), at: z.number() });
type StoredId = z.infer<typeof Entry>;
const IdsFile = z.object({ version: z.literal(1), ids: z.array(z.unknown()) });

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const same = (a: AgentKey, b: AgentKey) => a.office === b.office && a.user === b.user && a.folder === b.folder && a.label === b.label;

/**
 * O `agent-ids.json`: a identidade do último agente de cada pasta, nome e conta. Chamar a pasta de novo com esse agente
 * fechado reaproveita a identidade, e o escritório mostra o mesmo agente. É só um cache: ilegível, vira lista vazia.
 * A ordem do arquivo é a da última gravação (o mais antigo primeiro).
 */
export class AgentIdStore {
  private lastProblem: string | null = null;

  constructor(
    private readonly file: string,
    private readonly log: (message: string) => void = () => {},
  ) {}

  get(key: AgentKey): string | null {
    return this.list().find((entry) => same(entry, key))?.agentId ?? null;
  }

  set(key: AgentKey, agentId: string): void {
    const kept = this.list().filter((entry) => !same(entry, key));
    const all = [...kept, { office: key.office, user: key.user, folder: key.folder, label: key.label, agentId, at: Date.now() }];
    this.save(all.slice(Math.max(0, all.length - MAX_AGENT_IDS)));
  }

  private list(): StoredId[] {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.ok([]);
      return this.problem(`não consegui ler o ${basename(this.file)} (${errorMessage(error)}); os agentes chamados de novo ganham identidade nova`);
    }
    let data: z.infer<typeof IdsFile>;
    try {
      data = IdsFile.parse(JSON.parse(raw));
    } catch (error) {
      return this.problem(`${basename(this.file)} ilegível (${errorMessage(error)}); os agentes chamados de novo ganham identidade nova`);
    }
    const ids: StoredId[] = [];
    for (const entry of data.ids) {
      const parsed = Entry.safeParse(entry);
      if (parsed.success) ids.push(parsed.data);
    }
    return this.ok(ids);
  }

  private ok(ids: StoredId[]): StoredId[] {
    this.lastProblem = null;
    return ids;
  }

  private problem(message: string): StoredId[] {
    if (message !== this.lastProblem) this.log(message);
    this.lastProblem = message;
    return [];
  }

  /** Uma falha de gravação vai para o registro e nunca lança: a chamada do agente segue, só sem lembrar a identidade. */
  private save(ids: StoredId[]): void {
    try {
      writeFileAtomic(this.file, JSON.stringify({ version: 1, ids }, null, 2));
    } catch (error) {
      this.log(`não consegui gravar o ${basename(this.file)} (${errorMessage(error)})`);
    }
  }
}
