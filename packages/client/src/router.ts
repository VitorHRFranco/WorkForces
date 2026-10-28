import type { AppRoute } from "@workforces/protocol";
import { useEffect, useState } from "preact/hooks";
import { currentGeneration, onGeneration } from "./generation";

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (location.pathname !== path) {
    if (options.replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
  }
  dispatchEvent(new PopStateEvent("popstate"));
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    addEventListener("popstate", update);
    return () => removeEventListener("popstate", update);
  }, []);
  return path;
}

export function useGeneration(): number {
  const [value, setValue] = useState(currentGeneration());
  useEffect(() => onGeneration(() => setValue(currentGeneration())), []);
  return value;
}

/** O caminho de cada rota do app. */
export function routePath(route: AppRoute): string {
  switch (route.page) {
    case "login":
      return "/login";
    case "invite":
      return `/invite/${encodeURIComponent(route.code)}`;
    case "office":
      return "/office";
    default:
      return "/";
  }
}
