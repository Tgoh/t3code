# Visual drift check

Compares this client's shared components (`src/ui/`) with stock's `components/ui`, in Chrome, against the driver's server and data. Run it after an upstream sync or a style change.

## Running it

1. Stock web on 5733, the dev server `dev-stack.ps1` starts. It has to be the dev server: the confirm dialog view imports stock's `src/confirmDialog.ts`.
2. A treflex client on 5735, from your worktree's `apps/treflex-web`: `$env:TREFLEX_WEB_PORT = 5735; vp run dev`.
3. From `apps/treflex-web`: `vp run drift`. It exits 1 when anything is flagged.

The report is `t3code-dev-home\screenshots\drift\<date>\index.html`, with `report.json` beside it. Each capture's folder holds `stock.png`, `treflex.png`, `diff.png` (differing pixels in red over a faded stock image) and `styles.json`, the computed styles both sides were compared on.

Options: `--views sidebar,select,…` for some views, `--thread <title or id>` and `--project <path>` for the thread the views open, `--out <dir>`, `--pixel-threshold 0.01`, `--headed`, `--stock`/`--treflex` for other ports on `localhost` (one pairing cookie covers both), `--base-dir` for another T3 home.

## What it does

It pairs a browser with a 5-minute token scoped to `orchestration:read` alone, so the server refuses anything that would change state, and revokes the session when it ends. It opens menus and dialogs but never confirms them. It opens each view in both clients at 1400×900 and 390×844, light and dark:

- the sidebar, an open thread and its composer
- the General, Appearance, Chat, Keybindings, Threads and About settings pages
- the command palette, the Projects page's scope menu, the Project order select, the remove-project confirm dialog and the model picker
- a stack of toasts, raised from each client's own toast module, so it needs both dev servers

## How it decides

Treflex's sidebar, timeline, settings layout and the other "ours now" views differ from stock on purpose, so a whole-view pixel diff is always red. The check compares the components instead.

- **Styles flag.** Each visible treflex element with a `data-slot` must match the computed look of some stock element, at the same viewport and theme, in any view. The look covers font, colour, background, border, radius, padding, gap, shadow, opacity and backdrop filter, plus height for fixed-height controls. Matching any stock slot, not just the same one, is deliberate: Base UI renames most stock slots, so a `Button` used as a tooltip trigger is `tooltip-trigger`. Layout, text and structure don't enter it. Colours are compared as 8-bit sRGB, since the two clients write the same token in different syntaxes.
- **Pixels flag only where the structure matches:** the select popup and the confirm dialog. Elsewhere the pixel score is shown for review. A pixel counts as different only if nothing within one pixel of it in the other image matches, because popups land on sub-pixel positions.
- **Accepted differences** are listed in `run.ts`, each with its reason: `ACCEPTED` leaves style properties out of the comparison, and `ACCEPTED_PIXELS` raises one view's pixel threshold at one viewport. Add one only for a difference made on purpose, or one the check can't judge, such as a component stock hides or sub-pixel anti-aliasing.

A flagged component with no stock match names the closest stock element and the properties that differ. A component stock never draws in these views can't be matched, so it's flagged against its closest look: check that before calling it drift.
