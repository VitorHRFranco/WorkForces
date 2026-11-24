import type { Appearance } from "@workforces/protocol";
import { useEffect, useState } from "preact/hooks";
import { bridge } from "../bridge";
import { Modal } from "../office/modal";
import { CustomizeScreen } from "./customize-screen";
import { randomAppearance } from "./options";

/** O "Personalizar" num modal, começando do personagem do perfil. `putOffice` manda ao escritório aberto (null fora dele). */
export function CustomizeModal({ putOffice, onClose }: { putOffice: ((appearance: Appearance) => Promise<void>) | null; onClose(): void }) {
  const [initial, setInitial] = useState<Appearance | null>(null);

  useEffect(() => {
    let alive = true;
    bridge.appearance.get().then(
      (appearance) => {
        if (alive) setInitial(appearance ?? randomAppearance());
      },
      () => {
        if (alive) setInitial(randomAppearance());
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Modal title="Personalizar" onClose={onClose}>
      {initial && <CustomizeScreen mode="edit" initial={initial} putOffice={putOffice} onDone={onClose} />}
    </Modal>
  );
}
