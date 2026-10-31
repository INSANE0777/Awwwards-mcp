// Subresource Integrity string shared by the registry gate and the artifact
// verifier. Both must reject before a registry value reaches the shell.
export const SRI_PATTERN = /^sha(1|256|384|512)-[A-Za-z0-9+/]+={0,2}$/;

export function isSRI(value) {
  return typeof value === "string" && SRI_PATTERN.test(value);
}
