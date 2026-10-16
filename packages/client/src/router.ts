import { useEffect, useState } from "preact/hooks";

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
