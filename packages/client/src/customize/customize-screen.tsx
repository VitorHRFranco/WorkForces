import { BEARDS, BROWS, FEET, GLASSES, HAIR_STYLES, LEGS, SKINS, TOPS, RAMPS, type Appearance } from "@workforces/protocol";
import { useEffect, useRef, useState } from "preact/hooks";
import { bridge } from "../bridge";
import type { Family } from "../game/compose";
import { CharacterPreview } from "./character-preview";
import { BODY_LABELS, LABELS, randomAppearance, swatches, withBody } from "./options";
import { SAVE_MESSAGES, saveAppearance, type SaveResult } from "./save";

export interface CustomizeScreenProps {
  mode: "first" | "edit";
  initial: Appearance;
  /** Manda ao escritório aberto; null fora de um escritório. */
  putOffice: ((appearance: Appearance) => Promise<void>) | null;
  onDone(): void;
  /** Avisa quando um salvar começa (true) e termina (false): o modal não fecha no meio. */
  onBusyChange?(busy: boolean): void;
}

/** O valor que o `<input type="color">` mostra: a cor livre, ou o tom do meio da cor pronta. */
function hexOf(family: Family, color: string): string {
  if (color.startsWith("#")) return color;
  const ramp = (RAMPS[family].named as Record<string, readonly string[]>)[color];
  return ramp ? ramp[Math.floor(ramp.length / 2)]! : "#000000";
}

function ColorField({ label, family, value, onChange }: { label: string; family: Family; value: string; onChange(color: string): void }) {
  return (
    <div class="color-field">
      <div class="swatches">
        {swatches(family).map(({ name, hex }) => (
          <button
            key={name}
            type="button"
            class="swatch"
            title={name}
            aria-label={`${label}: ${name}`}
            aria-pressed={value === name}
            style={{ background: hex }}
            onClick={() => onChange(name)}
          />
        ))}
      </div>
      <label class="free-color">
        Outra cor{" "}
        <input type="color" aria-label={`Outra cor: ${label}`} value={hexOf(family, value)} onInput={(event) => onChange((event.target as HTMLInputElement).value.toLowerCase())} />
      </label>
    </div>
  );
}

function PieceSelect<T extends string>({ label, options, value, onChange, none }: { label: string; options: readonly T[]; value: T | null; onChange(value: T | null): void; none?: string }) {
  return (
    <label class="piece">
      {label}{" "}
      <select aria-label={label} value={value ?? ""} onChange={(event) => onChange(((event.target as HTMLSelectElement).value || null) as T | null)}>
        {none !== undefined && <option value="">{none}</option>}
        {options.map((id) => (
          <option key={id} value={id}>
            {LABELS[id] ?? id}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Uma peça opcional de roupa (cardigã, suspensório, gravata): marcada, ganha uma cor. */
function OptionalPiece({ label, value, onChange }: { label: string; value: string | null; onChange(value: string | null): void }) {
  return (
    <fieldset class="customize-group">
      <legend>
        <label>
          <input type="checkbox" checked={value !== null} onChange={(event) => onChange((event.target as HTMLInputElement).checked ? "Charcoal" : null)} /> {label}
        </label>
      </legend>
      {value !== null && <ColorField label={label} family="clothing" value={value} onChange={onChange} />}
    </fieldset>
  );
}

/**
 * A tela "Personalizar": prévia andando, as escolhas de cada parte, "Aleatório", "Pronto" e (fora da primeira vez) "Cancelar".
 * Se o perfil não grava, a tela continua editável para tentar de novo (e, na primeira vez, deixa continuar assim mesmo).
 * Se o escritório recusou ou não respondeu, o personagem já está no perfil: a tela trava com o aviso, e a saída é o "Fechar" do modal.
 */
export function CustomizeScreen({ mode, initial, putOffice, onDone, onBusyChange }: CustomizeScreenProps) {
  const [look, setLook] = useState<Appearance>(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Exclude<SaveResult, "saved"> | null>(null);
  const set = (patch: Partial<Appearance>) => setLook((current) => ({ ...current, ...patch }));
  /** O escritório recusou ou não respondeu: o salvar já aconteceu no perfil, não há mais o que editar. */
  const settled = result === "office-refused" || result === "office-unreachable";
  // Um salvar que termina depois de a tela sair de cena não faz nada: o `onDone` dele fecharia o modal que estiver aberto agora.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const save = async () => {
    setBusy(true);
    onBusyChange?.(true);
    const saved = await saveAppearance(look, { setProfile: (appearance) => bridge.appearance.set(appearance), putOffice });
    if (!mounted.current) return;
    setBusy(false);
    onBusyChange?.(false);
    if (saved === "saved") onDone();
    else setResult(saved);
  };

  return (
    <div class={`customize customize-${mode}`}>
      {mode === "first" && (
        <>
          <h1>Seu personagem</h1>
          <p>Escolha como você aparece nos escritórios. Dá para mudar depois em Personalizar.</p>
        </>
      )}
      <CharacterPreview appearance={look} />
      {/* Um <fieldset> desabilitado desabilita tudo o que está dentro: é a tela travada depois do aviso do escritório. */}
      <fieldset class="customize-form" disabled={settled}>
        <fieldset class="customize-group">
          <legend>Corpo</legend>
          {(["feminine", "masculine"] as const).map((body) => (
            <label key={body}>
              <input type="radio" name="body" checked={look.body === body} onChange={() => setLook((current) => withBody(current, body))} /> {BODY_LABELS[body]}
            </label>
          ))}
        </fieldset>
        <fieldset class="customize-group">
          <legend>Pele</legend>
          <div class="swatches">
            {SKINS.map((skin, i) => (
              <button
                key={skin}
                type="button"
                class="swatch"
                aria-label={`Tom de pele ${i + 1}`}
                aria-pressed={look.skin === skin}
                style={{ background: hexOf("skin", skin) }}
                onClick={() => set({ skin })}
              />
            ))}
          </div>
        </fieldset>
        <fieldset class="customize-group">
          <legend>Cabelo</legend>
          <PieceSelect label="Penteado" options={HAIR_STYLES} value={look.hair.style} onChange={(style) => style && set({ hair: { ...look.hair, style } })} />
          <ColorField label="Cabelo" family="hair" value={look.hair.color} onChange={(color) => set({ hair: { ...look.hair, color } })} />
        </fieldset>
        <fieldset class="customize-group">
          <legend>Sobrancelha</legend>
          <PieceSelect label="Sobrancelha" options={BROWS} value={look.brows} none="Nenhuma" onChange={(brows) => set({ brows })} />
        </fieldset>
        {look.body === "masculine" && (
          <fieldset class="customize-group">
            <legend>Barba e bigode</legend>
            <PieceSelect label="Barba e bigode" options={BEARDS} value={look.beard} none="Nenhum" onChange={(beard) => set({ beard })} />
          </fieldset>
        )}
        <fieldset class="customize-group">
          <legend>Em cima</legend>
          <PieceSelect label="Camisa" options={TOPS} value={look.top.style} onChange={(style) => style && set({ top: { ...look.top, style } })} />
          <ColorField label="Camisa" family="clothing" value={look.top.color} onChange={(color) => set({ top: { ...look.top, color } })} />
        </fieldset>
        <OptionalPiece label="Cardigã" value={look.cardigan} onChange={(cardigan) => set({ cardigan })} />
        <OptionalPiece label="Suspensório" value={look.suspenders} onChange={(suspenders) => set({ suspenders })} />
        <OptionalPiece label="Gravata" value={look.bowtie} onChange={(bowtie) => set({ bowtie })} />
        <fieldset class="customize-group">
          <legend>Embaixo</legend>
          <PieceSelect label="Peça de baixo" options={LEGS} value={look.legs.style} onChange={(style) => style && set({ legs: { ...look.legs, style } })} />
          <ColorField label="Peça de baixo" family="clothing" value={look.legs.color} onChange={(color) => set({ legs: { ...look.legs, color } })} />
        </fieldset>
        <fieldset class="customize-group">
          <legend>Pés</legend>
          <PieceSelect label="Pés" options={FEET} value={look.feet.style} onChange={(style) => style && set({ feet: { ...look.feet, style } })} />
          <ColorField label="Pés" family="clothing" value={look.feet.color} onChange={(color) => set({ feet: { ...look.feet, color } })} />
        </fieldset>
        <fieldset class="customize-group">
          <legend>Óculos</legend>
          <PieceSelect
            label="Óculos"
            options={GLASSES}
            value={look.glasses?.style ?? null}
            none="Nenhum"
            onChange={(style) => set({ glasses: style ? { style, color: look.glasses?.color ?? "Steel" } : null })}
          />
          {look.glasses && <ColorField label="Óculos" family="metal" value={look.glasses.color} onChange={(color) => set({ glasses: { ...look.glasses!, color } })} />}
        </fieldset>
      </fieldset>
      {result && (
        <p class="customize-status" role="status">
          {SAVE_MESSAGES[result]}
          {mode === "first" && result === "invalid" && " Você pode tentar de novo ou continuar; o WorkForces pergunta de novo na próxima vez que abrir."}
        </p>
      )}
      {!settled && (
        <div class="customize-actions">
          <button type="button" disabled={busy} onClick={() => setLook(randomAppearance())}>
            Aleatório
          </button>
          {mode === "edit" && (
            <button type="button" disabled={busy} onClick={onDone}>
              Cancelar
            </button>
          )}
          {mode === "first" && result === "invalid" && (
            <button type="button" disabled={busy} onClick={onDone}>
              Continuar assim mesmo
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void save()}>
            Pronto
          </button>
        </div>
      )}
    </div>
  );
}
