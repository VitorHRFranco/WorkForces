export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitUntil(check: () => boolean, timeoutMs = 5000, what = "condição"): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`tempo esgotado esperando: ${what}`);
    await sleep(20);
  }
}
