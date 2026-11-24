import type { IResourceContext } from "treflex";
import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";

import { composerFiles, type IComposerFilesView } from "./composerFiles";
import type { IStoredAttachment } from "./draftMemory";

vi.mock("./connection", async () => {
  const Exit = await import("effect/Exit");
  return {
    connectionRuntime: {
      runPromiseExit: async () => Exit.succeed({ attachmentId: "minted", relativeUrl: "/upload" }),
    },
  };
});

/** An upload endpoint that accepts every post. */
class AcceptingXhr {
  status = 0;
  timeout = 0;
  upload = { addEventListener: () => undefined };
  #loaded = () => {};
  open() {}
  setRequestHeader() {}
  abort() {}
  addEventListener(type: string, listener: () => void) {
    if (type === "load") this.#loaded = listener;
  }
  send() {
    this.status = 200;
    queueMicrotask(() => this.#loaded());
  }
}

const THREAD = "thread-1";
const STORED_KEY = `reflex-web:draft-files:${THREAD}`;

function memoryStorage(entries: Record<string, string>) {
  const held = new Map(Object.entries(entries));
  return {
    get length() {
      return held.size;
    },
    key: (index: number) => [...held.keys()][index] ?? null,
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  };
}

function keep(files: IStoredAttachment[]) {
  vi.stubGlobal("localStorage", memoryStorage({ [STORED_KEY]: JSON.stringify(files) }));
  onTestFinished(() => void vi.unstubAllGlobals());
}

function openFiles() {
  const abort = new AbortController();
  onTestFinished(() => abort.abort());
  let value: IComposerFilesView | undefined;
  const emitted: unknown[] = [];
  let handlers: Parameters<IResourceContext<"composerFiles">["methods"]>[0] | undefined;
  let supply: Parameters<IResourceContext<"composerFiles">["onSupply"]>[0] | undefined;
  const r = {
    expose: (next: IComposerFilesView) => {
      value = next;
    },
    methods: (next: typeof handlers) => {
      handlers = next;
    },
    onSupply: (next: typeof supply) => {
      supply = next;
    },
    emit: async (message: unknown) => void emitted.push(message),
    signal: abort.signal,
    ownerId: "session-1",
    resumeFrom: undefined,
  } as unknown as IResourceContext<"composerFiles">;
  void composerFiles({ Type: "composerFiles", EnvironmentId: "env-1", ThreadId: THREAD }, r);
  const ctx = { signal: abort.signal };
  return {
    value: () => value!,
    emitted,
    methods: handlers!,
    ctx,
    pick: async (name: string) => {
      const file = new File([name], `${name}.txt`, { type: "text/plain" });
      const answer = await supply!([{ Kind: "file", File: file, PastedText: false }]);
      return answer.Picked[0]!;
    },
  };
}

const storedFile = (id: string, name: string): IStoredAttachment => ({
  Id: id,
  Kind: "file",
  Name: name,
  MimeType: "text/plain",
  SizeBytes: 1,
  PastedText: false,
  AttachmentId: `uploaded-${name}`,
});

describe("composerFiles", () => {
  it("a reopened resource holds its thread's stored files under their ids, and a new pick never reuses one", async () => {
    keep([]);
    const first = await openFiles().pick("a");
    keep([storedFile(first.Id, "a.txt")]);
    const reopened = openFiles();
    const next = await reopened.pick("b");
    expect(next.Id).not.toBe(first.Id);
    const sent = await reopened.methods.upload(reopened.ctx, first.Id);
    expect(sent.id).toBe("uploaded-a.txt");
    const stored = await reopened.methods.stored(reopened.ctx, [first.Id]);
    expect(stored.map((file) => file.Id)).toEqual([first.Id]);
  });

  it("shows a stored image's preview in its value by id, until the uploaded image is removed", async () => {
    vi.stubGlobal("XMLHttpRequest", AcceptingXhr);
    keep([
      {
        Id: "image-1",
        Kind: "image",
        Name: "shot.png",
        MimeType: "image/png",
        SizeBytes: 8,
        PastedText: false,
        DataUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
    ]);
    const files = openFiles();
    const stored = await files.methods.stored(files.ctx, ["image-1"]);
    expect(stored.map((file) => file.Id)).toEqual(["image-1"]);
    expect(files.value().Previews["image-1"]).toMatch(/^blob:/);
    expect((await files.methods.upload(files.ctx, "image-1")).id).toBe("minted");
    expect(files.value().Status["image-1"]).toBeUndefined();
    await files.methods.remove(files.ctx, "image-1");
    expect(files.value().Previews["image-1"]).toBeUndefined();
  });

  it("tells its owner which kept files it couldn't hold again", async () => {
    keep([
      storedFile("kept", "a.txt"),
      {
        Id: "broken",
        Kind: "image",
        Name: "shot.png",
        MimeType: "image/png",
        SizeBytes: 8,
        PastedText: false,
        DataUrl: "data:nonsense",
      },
    ]);
    const files = openFiles();
    expect(await files.methods.stored(files.ctx, ["kept", "broken"])).toHaveLength(1);
    expect(files.emitted).toEqual([{ Lost: ["broken"] }]);
  });
});
