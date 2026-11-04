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

export function App() {
  const path = usePath();
  const generation = useGeneration();
  if (path === "/login") return <LoginPage key={generation} />;
  const invite = /^\/invite\/([^/]+)$/.exec(path);
  if (invite) return <InvitePage key={generation} code={decodeCode(invite[1]!)} />;
  if (path === "/office") return <OfficePage key={generation} />;
  if (path === "/host") return <HostPage key={generation} />;
  return <LauncherPage key={generation} />;
}
