import type {
  OrchestrationV2DomainEvent,
  OrchestrationV2ShellStreamItem,
  OrchestrationV2ThreadHistoryPage,
  OrchestrationV2ThreadStreamItem,
} from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";

export type Wire<T> = unknown extends T
  ? T
  : T extends string | number | boolean | null | undefined
    ? T
    : T extends DateTime.Utc
      ? string
      : T extends ReadonlyArray<infer Item>
        ? Array<Wire<Item>>
        : { -readonly [Key in keyof T]: Wire<T[Key]> };

export type IWireShellItem = Wire<OrchestrationV2ShellStreamItem>;
export type IWireShellSnapshot = Extract<IWireShellItem, { kind: "snapshot" }>["snapshot"];
export type IWireProject = IWireShellSnapshot["projects"][number];
export type IWireThreadShell = IWireShellSnapshot["threads"][number];

export type IWireThreadItem = Wire<OrchestrationV2ThreadStreamItem>;
export type IWireThreadSnapshot = Extract<IWireThreadItem, { kind: "snapshot" }>;
export type IWireProjection = IWireThreadSnapshot["projection"];
export type IWireThreadEvent = Wire<OrchestrationV2DomainEvent>;
export type IWireTurnItem = IWireProjection["turnItems"][number];
export type IWireHistoryPage = Wire<OrchestrationV2ThreadHistoryPage>;
