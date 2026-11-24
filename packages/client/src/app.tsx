import { useEffect, useState } from "preact/hooks";
import { bridge } from "./bridge";
import { CustomizeScreen } from "./customize/customize-screen";
import { randomAppearance } from "./customize/options";
import { HostPage } from "./pages/host-page";
import { InvitePage } from "./pages/invite-page";
import { LauncherPage } from "./pages/launcher-page";
import { LoginPage } from "./pages/login-page";
import { OfficePage } from "./pages/office-page";
import { useGeneration, usePath } from "./router";

function decodeCode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function Routes() {
  const path = usePath();
  const generation = useGeneration();
  if (path === "/login") return <LoginPage key={generation} />;
  const invite = /^\/invite\/([^/]+)$/.exec(path);
  if (invite) return <InvitePage key={generation} code={decodeCode(invite[1]!)} />;
  if (path === "/office") return <OfficePage key={generation} />;
  if (path === "/host") return <HostPage key={generation} />;
  return <LauncherPage key={generation} />;
}

/** Na primeira vez (perfil sem personagem), o "Personalizar" vem antes de qualquer tela; depois, a rota de antes. */
export function App() {
  const [firstTime, setFirstTime] = useState<boolean | null>(null);
  const [initial] = useState(() => randomAppearance());

  useEffect(() => {
    bridge.appearance.get().then(
      (appearance) => setFirstTime(appearance === null),
      (error: unknown) => {
        console.warn("não consegui ler o personagem do perfil", error);
        setFirstTime(false);
      },
    );
  }, []);

  if (firstTime === null) return null;
  if (firstTime) return <CustomizeScreen mode="first" initial={initial} putOffice={null} onDone={() => setFirstTime(false)} />;
  return <Routes />;
}
