export function readStored<T>(key: string, fallback: T): T {
  try {
    const held = localStorage.getItem(key);
    return held === null ? fallback : (JSON.parse(held) as T);
  } catch {
    return fallback;
  }
}

export function readStoredIds(key: string): string[] {
  const held = readStored<unknown>(key, []);
  return Array.isArray(held) ? held.filter((id) => typeof id === "string") : [];
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and blocked storage just forget the choice.
  }
}
