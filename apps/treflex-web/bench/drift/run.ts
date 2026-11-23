// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- A Node script that drives Chrome, outside any Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";

import {
  report,
  type IAccepted,
  type IAcceptedPixels,
  type ICapture,
  type IMismatch,
} from "./report.ts";
import { collectStyles, lookOf, type IStyledElement } from "./styles.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "../../../..");
const serverDir = NodePath.join(repoRoot, "apps/server");
const mainCheckout = NodePath.dirname(
  NodePath.resolve(
    repoRoot,
    NodeChildProcess.execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim(),
  ),
);
const devHome = NodePath.join(NodePath.dirname(mainCheckout), "t3code-dev-home");

const { values } = NodeUtil.parseArgs({
  options: {
    "base-dir": { type: "string", default: devHome },
    stock: { type: "string", default: "http://localhost:5733" },
    treflex: { type: "string", default: "http://localhost:5735" },
    out: { type: "string" },
    project: { type: "string", default: "G:/Sorted/Test" },
    thread: { type: "string", default: "Markdown blocks sample" },
    views: { type: "string" },
    "pixel-threshold": { type: "string", default: "0.01" },
    headed: { type: "boolean", default: false },
  },
});
const baseDir = values["base-dir"];
function localDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
const outDir = values.out ?? NodePath.join(devHome, "screenshots", "drift", localDate());
const pixelThreshold = Number(values["pixel-threshold"]);

type IClient = "stock" | "treflex";
const CLIENTS: ReadonlyArray<IClient> = ["stock", "treflex"];

function t3(args: ReadonlyArray<string>): string {
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    ["src/bin.ts", ...args, "--base-dir", baseDir],
    { cwd: serverDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error(`t3 ${args.join(" ")} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

const environmentId = NodeFS.readFileSync(
  NodePath.join(baseDir, "userdata", "environment-id"),
  "utf8",
).trim();
const threads = JSON.parse(t3(["thread", "list", "--project", values.project, "--json"])) as Array<{
  threadId: string;
  title: string;
}>;
const thread = threads.find((t) => t.threadId === values.thread || t.title === values.thread);
if (thread === undefined) throw new Error(`No thread "${values.thread}" in ${values.project}`);
const projectTitle = NodePath.basename(values.project);

const threadUrl = (client: IClient) =>
  client === "stock"
    ? `${values.stock}/${environmentId}/${encodeURIComponent(thread.threadId)}`
    : `${values.treflex}/?thread=${encodeURIComponent(thread.threadId)}`;
const settingsUrl = (client: IClient, page: string) =>
  client === "stock" ? `${values.stock}/settings/${page}` : `${values.treflex}/?settings=${page}`;

interface IViewport {
  Name: string;
  Width: number;
  Height: number;
}
const VIEWPORTS: ReadonlyArray<IViewport> = [
  { Name: "desktop", Width: 1400, Height: 900 },
  { Name: "phone", Width: 390, Height: 844 },
];
const THEMES = ["light", "dark"] as const;

interface IStep {
  page: Page;
  client: IClient;
  viewport: IViewport;
}

interface IView {
  Name: string;
  PixelGate: boolean;
  open: (step: IStep) => Promise<Locator>;
}

const firstVisible = async (page: Page, selectors: ReadonlyArray<string>): Promise<Locator> => {
  await page
    .locator(selectors.join(", "))
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => undefined);
  for (const selector of selectors) {
    const locator = page.locator(selector).filter({ visible: true }).first();
    if ((await locator.count()) > 0) return locator;
  }
  throw new Error(`None visible: ${selectors.join(", ")}`);
};

/** Waits for finite animations and transitions to end; spinners and other infinite ones are left running. */
async function settle(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every(
            (animation) =>
              animation.playState !== "running" ||
              animation.effect?.getComputedTiming().iterations === Infinity,
          ),
      undefined,
      { timeout: 5000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(150);
}

async function goto(step: IStep, url: string): Promise<void> {
  await step.page.goto(url);
  await (
    step.client === "stock"
      ? step.page.locator("[data-slot=sidebar-inner], [data-slot=sidebar]").first()
      : step.page.locator("nav[data-sidebar]")
  ).waitFor({ state: "attached", timeout: 30_000 });
  await step.page.waitForTimeout(1500);
  await settle(step.page);
}

async function openThread(step: IStep): Promise<void> {
  await goto(step, threadUrl(step.client));
  await (await composerSurface(step)).waitFor({ timeout: 30_000 });
  await step.page.waitForTimeout(1000);
}

const sidebarSelectors = (client: IClient) =>
  client === "stock"
    ? ["[data-slot=sidebar][data-mobile=true]", "[data-slot=sidebar-inner]"]
    : ["nav[data-sidebar]"];

async function openSidebar(step: IStep): Promise<Locator> {
  if (step.viewport.Name === "phone") {
    await step.page
      .getByRole("button", { name: "Toggle main sidebar" })
      .filter({ visible: true })
      .first()
      .click();
    await settle(step.page);
  }
  return firstVisible(step.page, sidebarSelectors(step.client));
}

async function composerSurface(step: IStep): Promise<Locator> {
  if (step.client === "stock") return step.page.locator("[data-slot=composer-shell]").first();
  await step.page.locator(".composer-lane").first().waitFor({ timeout: 30_000 });
  await step.page.evaluate(() => {
    const surface = [...document.querySelectorAll(".composer-lane *")].find(
      (node) => Number.parseFloat(getComputedStyle(node).borderTopWidth) > 0,
    );
    surface?.setAttribute("data-drift-target", "composer");
  });
  return step.page.locator("[data-drift-target=composer]");
}

const settingsView = (page: string): IView => ({
  Name: `settings-${page}`,
  PixelGate: false,
  open: async (step) => {
    await goto(step, settingsUrl(step.client, page));
    return firstVisible(
      step.page,
      step.client === "stock"
        ? ["[data-slot=dialog-popup]", "[data-slot=sidebar-inset]"]
        : ["main"],
    );
  },
});

const VIEWS: ReadonlyArray<IView> = [
  {
    Name: "sidebar",
    PixelGate: false,
    open: async (step) => {
      await openThread(step);
      return openSidebar(step);
    },
  },
  {
    Name: "thread",
    PixelGate: false,
    open: async (step) => {
      await openThread(step);
      return firstVisible(
        step.page,
        step.client === "stock" ? ["[data-slot=sidebar-inset]"] : ["main"],
      );
    },
  },
  {
    Name: "composer",
    PixelGate: false,
    open: async (step) => {
      await openThread(step);
      return composerSurface(step);
    },
  },
  ...["general", "appearance", "chat", "keybindings", "threads", "about"].map(settingsView),
  {
    Name: "command-palette",
    PixelGate: false,
    open: async (step) => {
      await openThread(step);
      await step.page.keyboard.press("Control+k");
      await settle(step.page);
      return firstVisible(step.page, ["[data-slot=command-dialog-popup]"]);
    },
  },
  {
    // Stock's sidebar row menu isn't its `ui/menu` Menu, and its editor picker is disabled
    // without host-editor access; the settings scope menu is a Menu in both.
    Name: "scope-menu",
    PixelGate: false,
    open: async (step) => {
      await goto(step, settingsUrl(step.client, "projects"));
      await step.page
        .getByRole("button", { name: /^Project scope:/ })
        .filter({ visible: true })
        .first()
        .click();
      await settle(step.page);
      return firstVisible(step.page, ["[data-slot=menu-popup]"]);
    },
  },
  {
    // Both clients raise the same toasts from their own module, which needs both dev servers.
    // The front toast sits over each client's own thread, so only the styles are compared.
    Name: "toast",
    PixelGate: false,
    open: async (step) => {
      await openThread(step);
      await step.page.evaluate(async (client) => {
        const path = client === "stock" ? "/src/components/ui/toast.tsx" : "/src/ui/toastStore.ts";
        // The page's own copy, which a dev server serves under a `?t=` query after an edit.
        const loaded = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((name) => new URL(name).pathname === path);
        const { toastManager } = (await import(loaded ?? path)) as {
          toastManager: { add: (options: object) => string; close: () => void };
        };
        // HIDE keeps stray toasts out of every other view; this one closes them and shows its own.
        toastManager.close();
        const shown = document.createElement("style");
        shown.textContent =
          "[data-slot=toast-portal] { display: block !important; } [data-slot=toast-viewport] { display: flex !important; }";
        document.head.append(shown);
        toastManager.add({
          type: "success",
          title: "Cloned details-git-demo",
          description: "G:\\Sorted\\Test\\details-git-demo",
          timeout: 0,
          actionProps: { children: "Open project" },
          data: { actionLayout: "stacked-end", hideCopyButton: true },
        });
        toastManager.add({ type: "info", title: "Your typed text was set aside", timeout: 0 });
        toastManager.add({
          type: "error",
          title: "Action failed",
          description: "nothing to commit, working tree clean",
          timeout: 0,
        });
      }, step.client);
      await settle(step.page);
      // The viewport has no box of its own; its toasts are placed absolutely inside it.
      return firstVisible(step.page, ["[data-slot=toast-viewport] > [role=dialog]"]);
    },
  },
  {
    Name: "select",
    PixelGate: true,
    open: async (step) => {
      await goto(step, settingsUrl(step.client, "general"));
      await step.page.locator("[data-slot=select-trigger][aria-label='Project order']").click();
      await settle(step.page);
      return firstVisible(step.page, ["[data-slot=select-popup]"]);
    },
  },
  {
    Name: "confirm-dialog",
    PixelGate: true,
    open: async (step) => {
      await openThread(step);
      if (step.client === "treflex") {
        const sidebar = await openSidebar(step);
        await sidebar.getByText(projectTitle, { exact: true }).first().click({ button: "right" });
        await settle(step.page);
        await step.page.getByRole("menuitem", { name: "Remove project" }).click();
      } else {
        // Stock disables Remove project without orchestration:operate, so this opens its
        // confirm host directly with the copy treflex showed. Needs stock's dev server.
        await step.page.evaluate(async (message) => {
          const module = (await import("/src/confirmDialog.ts" as string)) as {
            requestConfirmDialog: (
              message: string,
              options: { variant: string },
            ) => Promise<boolean>;
          };
          void module.requestConfirmDialog(message, { variant: "destructive" });
        }, confirmMessage);
      }
      await settle(step.page);
      const popup = await firstVisible(step.page, ["[data-slot=alert-dialog-popup]"]);
      if (step.client === "treflex")
        confirmMessage = await popup.evaluate((element) =>
          [
            element.querySelector("[data-slot=alert-dialog-title]")?.textContent ?? "",
            element.querySelector("[data-slot=alert-dialog-description]")?.textContent ?? "",
          ].join("\n"),
        );
      return popup;
    },
  },
  {
    Name: "model-picker",
    PixelGate: false,
    open: async (step) => {
      await openThread(step);
      const surface = await composerSurface(step);
      const trigger =
        step.client === "stock"
          ? surface
              .locator("[data-slot=popover-trigger]")
              .filter({ visible: true, hasText: /\w/ })
              .first()
          : surface.locator("button[aria-label^='Model:']");
      await trigger.click();
      await settle(step.page);
      return firstVisible(step.page, ["[data-slot=popover-popup]"]);
    },
  },
];

/** Treflex runs first in each pair so its confirm copy is known before stock's dialog opens. */
let confirmMessage = "";
const ORDER: ReadonlyArray<IClient> = ["treflex", "stock"];

const HIDE = `
[data-slot^=toast-viewport], [data-slot^=toast-portal] { display: none !important; }
* { caret-color: transparent !important; }
`;

async function pairedState(browser: Browser) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const { credential } = JSON.parse(
    t3([
      "auth",
      "pairing",
      "create",
      "--scope",
      "orchestration:read",
      "--ttl",
      "5m",
      "--label",
      SESSION_LABEL,
      "--json",
    ]),
  ) as { credential: string };
  const paired = await context.request.post(`${values.stock}/api/auth/browser-session`, {
    data: { credential },
  });
  if (!paired.ok()) throw new Error(`Pairing failed: HTTP ${paired.status()}`);
  const state = await context.storageState();
  await context.close();
  return state;
}

const SESSION_LABEL = "visual drift check";

function revokeSessions(): void {
  const sessions = JSON.parse(t3(["auth", "session", "list", "--json"])) as Array<{
    sessionId: string;
    scopes: ReadonlyArray<string>;
    client?: { label?: string };
  }>;
  for (const session of sessions)
    if (session.client?.label === SESSION_LABEL && session.scopes.join() === "orchestration:read")
      t3(["auth", "session", "revoke", session.sessionId]);
}

async function main() {
  const wanted = values.views?.split(",");
  const unknown = wanted?.filter((name) => !VIEWS.some((view) => view.Name === name)) ?? [];
  if (unknown.length > 0) throw new Error(`Unknown view: ${unknown.join(", ")}`);
  if (!Number.isFinite(pixelThreshold)) throw new Error("--pixel-threshold must be a number");
  const views = VIEWS.filter((view) => wanted === undefined || wanted.includes(view.Name));
  const browser = await chromium.launch({ channel: "chrome", headless: !values.headed });
  NodeFS.mkdirSync(outDir, { recursive: true });
  const captures: Array<ICapture> = [];
  let flagged: Array<ICapture> = [];
  let runError: string | null = null;
  const styles = new Map<string, Record<IClient, Array<IStyledElement>>>();
  try {
    const storageState = await pairedState(browser);
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        const contexts = Object.fromEntries(
          await Promise.all(
            CLIENTS.map(async (client) => {
              const context = await browser.newContext({
                storageState,
                viewport: { width: viewport.Width, height: viewport.Height },
                colorScheme: theme,
                reducedMotion: "reduce",
                serviceWorkers: "block",
              });
              await context.addInitScript((css) => {
                addEventListener("DOMContentLoaded", () => {
                  const style = document.createElement("style");
                  style.textContent = css;
                  document.head.append(style);
                });
              }, HIDE);
              return [client, context] as const;
            }),
          ),
        );
        for (const view of views) {
          const key = `${view.Name}-${viewport.Name}-${theme}`;
          const dir = NodePath.join(outDir, key);
          NodeFS.rmSync(dir, { recursive: true, force: true });
          NodeFS.mkdirSync(dir, { recursive: true });
          const capture: ICapture = {
            Key: key,
            View: view.Name,
            Viewport: viewport.Name,
            Theme: theme,
            PixelGate: view.PixelGate,
            PixelScore: null,
            Mismatches: [],
            Errors: [],
          };
          const found: Record<IClient, Array<IStyledElement>> = { stock: [], treflex: [] };
          for (const client of ORDER) {
            const page = await contexts[client]!.newPage();
            try {
              const target = await view.open({ page, client, viewport });
              await page.mouse.move(viewport.Width - 2, 2);
              // A dialog opened from code focuses its button with a visible ring; one opened by a click doesn't.
              await page.evaluate(() => {
                if (document.activeElement instanceof HTMLButtonElement)
                  document.activeElement.blur();
              });
              await settle(page);
              // Stock's whole page feeds the pool: a control can sit outside the cropped element there.
              found[client] = await (client === "stock" ? page.locator("body") : target).evaluate(
                collectStyles,
              );
              await target.screenshot({
                path: NodePath.join(dir, `${client}.png`),
                animations: "disabled",
              });
            } catch (error) {
              capture.Errors.push(`${client}: ${(error as Error).message.split("\n")[0]}`);
              await page
                .screenshot({ path: NodePath.join(dir, `${client}.png`) })
                .catch(() => undefined);
            } finally {
              await page.close();
            }
          }
          styles.set(key, found);
          NodeFS.writeFileSync(
            NodePath.join(dir, "styles.json"),
            `${JSON.stringify(found, null, 1)}\n`,
          );
          captures.push(capture);
          console.log(
            `captured ${key}${capture.Errors.length > 0 ? ` (errors: ${capture.Errors.join("; ")})` : ""}`,
          );
        }
        await Promise.all(Object.values(contexts).map((context) => context.close()));
      }
    }
    await compareStyles(captures, styles);
    await comparePixels(browser, captures);
  } catch (error) {
    runError = (error as Error).message.split("\n")[0]!;
    throw error;
  } finally {
    await browser.close().catch(() => undefined);
    try {
      flagged = report(outDir, captures, pixelThreshold, ACCEPTED, ACCEPTED_PIXELS, runError);
    } catch (error) {
      console.error(`Writing the report failed: ${(error as Error).message}`);
    }
    try {
      revokeSessions();
    } catch (error) {
      console.error(`Revoking the check's sessions failed: ${(error as Error).message}`);
    }
  }
  console.log(
    `\n${flagged.length} of ${captures.length} captures flagged; report: ${NodePath.join(outDir, "index.html")}`,
  );
  for (const capture of flagged)
    console.log(
      `  ${capture.Key}: ${capture.Mismatches.length} style mismatch(es)${capture.PixelGate && capture.PixelScore !== null ? `, pixels ${(capture.PixelScore * 100).toFixed(2)}%` : ""}${capture.Errors.length > 0 ? `, ${capture.Errors.length} error(s)` : ""}`,
    );
  process.exitCode = flagged.length > 0 ? 1 : 0;
}

const ACCEPTED: ReadonlyArray<IAccepted> = [
  {
    Slots: ["input", "input-control", "combobox-input", "textarea", "textarea-control"],
    Viewport: "phone",
    Properties: ["font-size", "line-height", "height"],
    Reason:
      "styles.css's iOS rule sets fields to 16px under 640px, so Safari doesn't zoom into them",
  },
  {
    Slots: ["input-control"],
    Properties: ["font-size", "font-weight", "line-height", "height"],
    Reason:
      "SidebarInput's unstyled wrapper inherits its row's type, and treflex's settings search row (ours now) leaves out stock's text-sm font-medium; the input inside matches",
  },
  {
    Slots: ["textarea", "textarea-control"],
    Reason:
      "no stock view here draws a Textarea (its composer is a rich editor), so treflex's can only be checked by eye",
  },
  {
    Slots: ["scroll-area-viewport"],
    Properties: ["border-top-left-radius", "border-bottom-right-radius"],
    Reason:
      "treflex's command list scrolls in a native ScrollArea that takes the panel's radius; stock's overlay scrollbars are an open gap in docs/todo.md",
  },
  {
    Slots: ["badge"],
    Text: "Not used here yet",
    Reason: "treflex's marker on settings it ignores; stock has no such badge",
  },
  {
    Slots: ["sidebar-menu-button"],
    Disabled: true,
    Properties: ["opacity"],
    Reason:
      "treflex disables settings pages it hasn't built; both clients' class dims a disabled button to 64%, but no stock view draws one",
  },
  ...["New thread in ", "Project actions"].map((text) => ({
    Slots: ["button"],
    Text: text,
    Properties: ["color"],
    Reason:
      "stock hides its project folder buttons until hover, so treflex's can only be matched against stock's page-header buttons, which sit outside the app sidebar's tokens",
  })),
];

const ACCEPTED_PIXELS: ReadonlyArray<IAcceptedPixels> = [
  {
    View: "confirm-dialog",
    Viewport: "phone",
    MaxScore: 0.035,
    Reason:
      "sub-pixel anti-aliasing on the centred description; its styles match, and the dialog's style check still runs",
  },
];

const acceptedFor = (element: IStyledElement, viewport: string) =>
  ACCEPTED.filter(
    (rule) =>
      rule.Slots.includes(element.Slot) &&
      (rule.Viewport === undefined || rule.Viewport === viewport) &&
      (rule.Text === undefined || element.Text.startsWith(rule.Text)) &&
      (rule.Disabled === undefined || element.Disabled),
  ).flatMap((rule) => rule.Properties ?? Object.keys(element.Style));

const without = (look: Record<string, string>, properties: ReadonlyArray<string>) =>
  Object.fromEntries(Object.entries(look).filter(([property]) => !properties.includes(property)));

async function compareStyles(
  captures: ReadonlyArray<ICapture>,
  styles: ReadonlyMap<string, Record<IClient, Array<IStyledElement>>>,
): Promise<void> {
  const pools = new Map<string, Array<IStyledElement>>();
  for (const capture of captures) {
    const poolKey = `${capture.Viewport}-${capture.Theme}`;
    pools.set(poolKey, [...(pools.get(poolKey) ?? []), ...styles.get(capture.Key)!.stock]);
  }
  const looks = new Map<string, Set<string>>();
  const stockLooks = (poolKey: string, properties: ReadonlyArray<string>) => {
    const key = `${poolKey}|${properties.join(",")}`;
    let held = looks.get(key);
    if (held === undefined) {
      held = new Set(
        pools
          .get(poolKey)!
          .map((element) =>
            JSON.stringify(Object.fromEntries(properties.map((p) => [p, element.Style[p] ?? ""]))),
          ),
      );
      looks.set(key, held);
    }
    return held;
  };
  for (const capture of captures) {
    const poolKey = `${capture.Viewport}-${capture.Theme}`;
    const pool = pools.get(poolKey)!;
    const bySignature = new Map<string, IMismatch>();
    for (const element of styles.get(capture.Key)!.treflex) {
      const look = without(
        lookOf(element.Style, element.Slot),
        acceptedFor(element, capture.Viewport),
      );
      const properties = Object.keys(look);
      const signature = JSON.stringify(look);
      if (stockLooks(poolKey, properties).has(signature)) continue;
      const held = bySignature.get(`${element.Slot}|${signature}`);
      if (held !== undefined) {
        held.Count++;
        continue;
      }
      let nearest: IMismatch | null = null;
      for (const candidate of pool) {
        const diff = properties
          .filter((property) => candidate.Style[property] !== look[property])
          .map((property) => ({
            Property: property,
            Stock: candidate.Style[property] ?? "",
            Treflex: look[property]!,
          }));
        const better =
          nearest === null ||
          diff.length < nearest.Diff.length ||
          (diff.length === nearest.Diff.length && candidate.Slot === element.Slot);
        if (better)
          nearest = {
            Slot: element.Slot,
            StockSlot: candidate.Slot,
            Text: element.Text,
            Count: 1,
            Diff: diff,
          };
      }
      if (nearest !== null) bySignature.set(`${element.Slot}|${signature}`, nearest);
    }
    capture.Mismatches = [...bySignature.values()];
  }
}

async function comparePixels(browser: Browser, captures: Array<ICapture>): Promise<void> {
  const page = await browser.newPage();
  try {
    for (const capture of captures) {
      const dir = NodePath.join(outDir, capture.Key);
      const read = (client: IClient) => {
        const path = NodePath.join(dir, `${client}.png`);
        return NodeFS.existsSync(path) ? NodeFS.readFileSync(path).toString("base64") : null;
      };
      const stock = read("stock");
      const treflex = read("treflex");
      if (stock === null || treflex === null) continue;
      try {
        const result = await page.evaluate(diffImages, { Stock: stock, Treflex: treflex });
        capture.PixelScore = result.Score;
        NodeFS.writeFileSync(NodePath.join(dir, "diff.png"), Buffer.from(result.Diff, "base64"));
      } catch (error) {
        capture.Errors.push(`pixel diff: ${(error as Error).message.split("\n")[0]}`);
      }
    }
  } finally {
    await page.close();
  }
}

/** Runs in the browser. */
async function diffImages(input: { Stock: string; Treflex: string }) {
  const load = (data: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/png;base64,${data}`;
    });
  const [stock, treflex] = await Promise.all([load(input.Stock), load(input.Treflex)]);
  const width = Math.max(stock.width, treflex.width);
  const height = Math.max(stock.height, treflex.height);
  const pixels = (image: HTMLImageElement) => {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, width, height).data;
  };
  const a = pixels(stock);
  const b = pixels(treflex);
  const out = new OffscreenCanvas(width, height);
  const context = out.getContext("2d")!;
  const image = context.createImageData(width, height);
  const close = (from: Uint8ClampedArray, i: number, to: Uint8ClampedArray, j: number) =>
    Math.abs(from[i]! - to[j]!) +
      Math.abs(from[i + 1]! - to[j + 1]!) +
      Math.abs(from[i + 2]! - to[j + 2]!) <=
    48;
  // Sub-pixel popup positions shift text by a pixel; a pixel matches anything within one pixel of it.
  const nearby = (from: Uint8ClampedArray, to: Uint8ClampedArray, x: number, y: number) => {
    const i = (y * width + x) * 4;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (close(from, i, to, (ny * width + nx) * 4)) return true;
      }
    return false;
  };
  const sameSize =
    Math.abs(stock.width - treflex.width) <= 1 && Math.abs(stock.height - treflex.height) <= 1;
  let differing = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inStock = x < stock.width && y < stock.height;
      const inTreflex = x < treflex.width && y < treflex.height;
      const outside = inStock !== inTreflex;
      if (outside ? !sameSize : !nearby(a, b, x, y) || !nearby(b, a, x, y)) {
        differing++;
        image.data.set([255, 0, 64, 255], i);
      } else {
        const grey = 255 - (255 - (a[i]! + a[i + 1]! + a[i + 2]!) / 3) * 0.25;
        image.data.set([grey, grey, grey, 255], i);
      }
    }
  }
  context.putImageData(image, 0, 0);
  const blob = await out.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { Score: differing / (width * height), Diff: btoa(binary) };
}

await main();
