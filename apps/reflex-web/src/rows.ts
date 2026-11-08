import { merge } from "reflex";

export function byId<T extends { id: string }>(rows: ReadonlyArray<T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const row of rows) out[row.id] = row;
  return out;
}

// Wire rows carry `id`, not `$Id`; the one key applies at every depth, and a row without an id is
// replaced.
export const WIRE_KEY = {
  key: (row: unknown) => {
    const id = (row as { id?: unknown } | null)?.id;
    return typeof id === "string" ? id : undefined;
  },
};

// In place, so a delta writes only the fields it changed and views over the other fields stay put.
export function put<T extends { id: string }>(rows: Record<string, T>, row: T): void {
  const held = rows[row.id];
  if (held === undefined) rows[row.id] = row;
  else merge(held, row, WIRE_KEY);
}
