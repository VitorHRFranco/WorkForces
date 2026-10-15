/** Remove sequências CSI e OSC, para comparar só o texto. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
}
