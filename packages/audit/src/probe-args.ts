export function probeArguments(
  _inputSchema: unknown,
): { ok: true; args: Record<string, unknown> } | { ok: false; reason: string } {
  throw new Error("not implemented");
}
