import { entity, type IActionGenerator, type IWithId } from "treflex";

export function byId<T extends { id: string }>(rows: ReadonlyArray<T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const row of rows) out[row.id] = row;
  return out;
}

type IFields = Record<string, unknown>;

const isFields = (value: unknown): value is IFields =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const rowId = (value: unknown): string | undefined => {
  const id = isFields(value) ? value.id : undefined;
  return typeof id === "string" && id !== "" ? id : undefined;
};

function reconcileFields(target: IFields, next: IFields): void {
  for (const key of Object.keys(next)) {
    // JSON.parse makes "__proto__" an own key, and writing it would retarget the node's prototype.
    if (key === "__proto__") continue;
    const held = target[key];
    const value = next[key];
    if (Array.isArray(held) && Array.isArray(value)) reconcileArray(held, value);
    else if (isFields(held) && isFields(value) && rowId(held) === rowId(value))
      reconcileFields(held, value);
    else if (held !== value) target[key] = value;
  }
  for (const key of Object.keys(target)) {
    if (key !== "$Id" && !Object.hasOwn(next, key)) delete target[key];
  }
}

function reconcileArray(target: unknown[], next: unknown[]): void {
  const held = new Map<string, IFields>();
  for (const row of target) {
    const id = rowId(row);
    if (id !== undefined && !held.has(id)) held.set(id, row as IFields);
  }
  const seated = next.map((value) => {
    const id = rowId(value);
    const match = id === undefined ? undefined : held.get(id);
    if (match === undefined) return value;
    held.delete(id!);
    reconcileFields(match, value as IFields);
    return match;
  });
  seated.forEach((row, index) => {
    if (target[index] !== row) target[index] = row;
  });
  if (target.length > seated.length) target.length = seated.length;
}

/**
 * Folds a plain payload into a live node in place: changed scalars are assigned, keys the payload
 * no longer carries are deleted except an entity's `$Id`, and nested rows keep their nodes, so a
 * write over a held node notifies only the views of what changed. Assigning the payload instead
 * would replace the node.
 */
export function reconcile<T extends object>(target: T, next: T): void {
  if (Array.isArray(target)) reconcileArray(target, next as unknown[]);
  else reconcileFields(target as IFields, next as IFields);
}

export function put<T extends { id: string }>(rows: Record<string, T>, row: T): void {
  const held = rows[row.id];
  if (held === undefined) rows[row.id] = row;
  else reconcile(held, row);
}

export function* putEntity<T extends { id: string }>(
  rows: Record<string, IWithId<T>>,
  row: T,
): IActionGenerator {
  const held = rows[row.id];
  if (held === undefined) rows[row.id] = (yield* entity(row as object)) as IWithId<T>;
  else reconcile<object>(held, row);
}

/** `reconcile` over a record of entities by wire id: a held row keeps its node, a new one is minted. */
export function* reconcileEntities<T extends { id: string }>(
  rows: Record<string, IWithId<T>>,
  next: ReadonlyArray<T>,
): IActionGenerator {
  const minted: Record<string, IWithId<T>> = {};
  for (const row of next) {
    if (rows[row.id] === undefined) minted[row.id] = (yield* entity(row as object)) as IWithId<T>;
  }
  reconcile<object>(rows, { ...byId(next), ...minted });
}
