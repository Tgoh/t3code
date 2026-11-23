// @effect-diagnostics nodeBuiltinImport:off -- Writes the report files from a Node script.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface IMismatch {
  Slot: string;
  StockSlot: string;
  Text: string;
  Count: number;
  Diff: Array<{ Property: string; Stock: string; Treflex: string }>;
}

export interface IAccepted {
  Slots: ReadonlyArray<string>;
  /** Every viewport when left out. */
  Viewport?: string;
  /** Only elements whose text (or label, when they have none) starts with this, or only disabled ones. */
  Text?: string;
  Disabled?: true;
  /** Every property when left out. */
  Properties?: ReadonlyArray<string>;
  Reason: string;
}

/** Raises the pixel threshold for one view at one viewport, in both themes. */
export interface IAcceptedPixels {
  View: string;
  Viewport: string;
  MaxScore: number;
  Reason: string;
}

export interface ICapture {
  Key: string;
  View: string;
  Viewport: string;
  Theme: string;
  PixelGate: boolean;
  PixelScore: number | null;
  Mismatches: Array<IMismatch>;
  Errors: Array<string>;
}

const pixelThreshold = (
  capture: ICapture,
  threshold: number,
  acceptedPixels: ReadonlyArray<IAcceptedPixels>,
) =>
  acceptedPixels.find((rule) => rule.View === capture.View && rule.Viewport === capture.Viewport)
    ?.MaxScore ?? threshold;

const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function report(
  dir: string,
  captures: ReadonlyArray<ICapture>,
  threshold: number,
  accepted: ReadonlyArray<IAccepted>,
  acceptedPixels: ReadonlyArray<IAcceptedPixels>,
  runError: string | null,
): Array<ICapture> {
  const isFlagged = (capture: ICapture) =>
    capture.Mismatches.length > 0 ||
    capture.Errors.length > 0 ||
    (capture.PixelGate &&
      (capture.PixelScore ?? 1) > pixelThreshold(capture, threshold, acceptedPixels));
  const flagged = captures.filter(isFlagged);
  NodeFS.writeFileSync(
    NodePath.join(dir, "report.json"),
    `${JSON.stringify({ PixelThreshold: threshold, RunError: runError, Captures: captures }, null, 2)}\n`,
  );
  const pixel = (capture: ICapture) =>
    capture.PixelScore === null
      ? "–"
      : `${(capture.PixelScore * 100).toFixed(2)}%${capture.PixelGate ? "" : " (not gated)"}`;
  const rows = captures
    .map(
      (capture) => `<tr class="${isFlagged(capture) ? "bad" : ""}">
  <td><a href="#${capture.Key}">${capture.View}</a></td><td>${capture.Viewport}</td><td>${capture.Theme}</td>
  <td>${capture.Mismatches.length}</td><td>${pixel(capture)}</td><td>${capture.Errors.length}</td></tr>`,
    )
    .join("\n");
  const sections = captures
    .map((capture) => {
      const mismatches = capture.Mismatches.map(
        (
          mismatch,
        ) => `<li><code>${mismatch.Slot}</code> ×${mismatch.Count} “${escape(mismatch.Text)}”, closest stock <code>${mismatch.StockSlot}</code>
  <table class="diff">${mismatch.Diff.map(
    (diff) =>
      `<tr><td>${diff.Property}</td><td>stock <code>${escape(diff.Stock)}</code></td><td>treflex <code>${escape(diff.Treflex)}</code></td></tr>`,
  ).join("")}</table></li>`,
      ).join("\n");
      const errors = capture.Errors.map((error) => `<li class="error">${escape(error)}</li>`).join(
        "",
      );
      return `<section id="${capture.Key}">
<h2>${capture.View} · ${capture.Viewport} · ${capture.Theme}${isFlagged(capture) ? ' <span class="flag">flagged</span>' : ""}</h2>
<p>Style mismatches: ${capture.Mismatches.length} · Pixel diff: ${pixel(capture)}</p>
<ul>${errors}${mismatches}</ul>
<div class="images">
  <figure><figcaption>stock</figcaption><img src="${capture.Key}/stock.png"></figure>
  <figure><figcaption>treflex</figcaption><img src="${capture.Key}/treflex.png"></figure>
  <figure><figcaption>diff</figcaption><img src="${capture.Key}/diff.png"></figure>
</div>
</section>`;
    })
    .join("\n");
  NodeFS.writeFileSync(
    NodePath.join(dir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Visual drift</title>
<style>
:root { color-scheme: light dark; --bad: #d33; }
body { font: 14px system-ui, sans-serif; margin: 16px; background: Canvas; color: CanvasText; }
table { border-collapse: collapse; }
td, th { padding: 2px 8px; text-align: left; border-bottom: 1px solid #8884; }
tr.bad td:first-child::before { content: "● "; color: var(--bad); }
.flag { color: var(--bad); font-size: 0.7em; }
.error { color: var(--bad); }
.diff { margin: 4px 0 8px; font-size: 12px; }
.images { display: flex; gap: 8px; overflow-x: auto; }
figure { margin: 0; }
img { max-width: 560px; border: 1px solid #8884; }
section { margin-top: 32px; }
</style></head><body>
<h1>Visual drift, stock against treflex</h1>
${runError === null ? "" : `<p class="error">The run stopped early, so nothing below was compared: ${escape(runError)}</p>`}
<p>${flagged.length} of ${captures.length} captures flagged. A style mismatch is a treflex component (by <code>data-slot</code>) whose computed look matches no stock element, of any slot, at the same viewport and theme; it names the closest one. Pixel diffs gate only views with the same structure in both clients (threshold ${(threshold * 100).toFixed(2)}%).</p>
<p>Accepted differences, left out of the comparison:</p>
<ul>${accepted
      .map(
        (rule) =>
          `<li>${rule.Properties?.join(", ") ?? "every property"} of ${rule.Disabled ? "disabled " : ""}${rule.Slots.map((slot) => `<code>${slot}</code>`).join(", ")}${rule.Text === undefined ? "" : ` reading “${escape(rule.Text)}…”`} on ${rule.Viewport ?? "every viewport"}: ${escape(rule.Reason)}</li>`,
      )
      .join("")}${acceptedPixels
      .map(
        (rule) =>
          `<li>pixel diffs up to ${(rule.MaxScore * 100).toFixed(2)}% on ${rule.View} at ${rule.Viewport}: ${escape(rule.Reason)}</li>`,
      )
      .join("")}</ul>
<table><tr><th>View</th><th>Viewport</th><th>Theme</th><th>Style mismatches</th><th>Pixels</th><th>Errors</th></tr>
${rows}
</table>
${sections}
</body></html>
`,
  );
  return flagged;
}
