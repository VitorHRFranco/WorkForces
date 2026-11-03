import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import { isChannelId } from "@workforces/bridge/channel";
import { writeFileAtomic } from "../atomic-write.js";

/** Bem acima dos 5 agentes abertos (spec 6.4): os registros de agentes que terminaram saem no `scan`. */
export const MAX_RECORDS = 50;

/** Um agente que este app abriu: o canal dele e a conta (escritório e nome) que o app usou ao entregar o `start`. */
export interface AgentRecord {
  channelId: string;
  agentId: string;
  office: string;
  user: string;
  at: number;
}

const RecordsFile = z.object({ version: z.literal(1), agents: z.array(z.unknown()) });
const Entry = z.object({
  channelId: z.string().refine(isChannelId),
  agentId: z.uuid(),
  office: z.string().min(1),
  user: z.string().min(1),
  at: z.number(),
});

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * O `local-agents.json`: os canais dos agentes que este app abriu. "Meus agentes" só conecta a eles; um canal com o nome
 * certo, mas sem registro, pode ser de outro usuário do Windows. É só um cache de ids: ilegível, vira lista vazia.
 */
export class AgentRecordStore {
  /** O último problema registrado: o arquivo é relido a cada `scan`, e o mesmo aviso não se repete. */
  private lastProblem: string | null = null;

  constructor(
    private readonly file: string,
    private readonly log: (message: string) => void = () => {},
  ) {}

  /** Lê o arquivo de novo a cada chamada (o E2E e outro processo do mesmo usuário podem gravar nele). */
  list(): AgentRecord[] {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.ok([]);
      return this.problem(`não consegui ler o ${basename(this.file)} (${errorMessage(error)}); Meus agentes fica sem os agentes abertos antes`);
    }
    let data: z.infer<typeof RecordsFile>;
    try {
      data = RecordsFile.parse(JSON.parse(raw));
    } catch (error) {
      return this.problem(`${basename(this.file)} ilegível (${errorMessage(error)}); Meus agentes fica sem os agentes abertos antes`);
    }
    const records: AgentRecord[] = [];
    for (const entry of data.agents) {
      const parsed = Entry.safeParse(entry);
      if (parsed.success) records.push(parsed.data);
    }
    return this.ok(records);
  }

  /** Acrescenta ou substitui pelo channelId; guarda no máximo MAX_RECORDS (saem os mais antigos, por `at`). */
  add(record: AgentRecord): void {
    const others = this.list().filter((entry) => entry.channelId !== record.channelId);
    const all = [...others, { ...record }];
    const oldest = new Set([...all].sort((a, b) => a.at - b.at).slice(0, Math.max(0, all.length - MAX_RECORDS)));
    this.save(all.filter((entry) => !oldest.has(entry)));
  }

  remove(channelIds: readonly string[]): void {
    const before = this.list();
    const kept = before.filter((entry) => !channelIds.includes(entry.channelId));
    if (kept.length !== before.length) this.save(kept);
  }

  private ok(records: AgentRecord[]): AgentRecord[] {
    this.lastProblem = null;
    return records;
  }

  private problem(message: string): AgentRecord[] {
    if (message !== this.lastProblem) this.log(message);
    this.lastProblem = message;
    return [];
  }

  /** Uma falha de gravação vai para o registro e nunca lança: o agente continua na lista até fechar o app. */
  private save(records: AgentRecord[]): void {
    try {
      writeFileAtomic(this.file, JSON.stringify({ version: 1, agents: records }, null, 2));
    } catch (error) {
      this.log(`não consegui gravar o ${basename(this.file)} (${errorMessage(error)})`);
    }
  }
}
