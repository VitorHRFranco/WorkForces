import type { AppBridge } from "@workforces/protocol";

declare global {
  interface Window {
    workforces?: AppBridge;
  }
}

export function hasBridge(): boolean {
  return window.workforces !== undefined;
}

/** O `window.workforces` do preload; o main.tsx garante que existe antes de desenhar o app. */
export const bridge: AppBridge = window.workforces as AppBridge;
