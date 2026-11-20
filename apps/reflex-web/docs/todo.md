# Todo

Work Tam has queued for later. Gaps against stock that nobody has asked for yet go in [issues.md](./issues.md) instead.

## Treflex follow-ups

The friction write-up is at `G:\Sorted\Code\t3code-dev-home\notes\treflex-friction-from-t3code-port.md`. The treflex side's verdicts are in the reflex repo's `docs/wip` (commit 2b37348).

- **Encoded types for the tree.** Type the tree from the codec's encoded side (`toCodecJson(S)` Encoded) instead of the hand-written `Wire<T>`. First check whether that type is precise enough.
- **One writer for timeline items.** Route every timeline-item write through a single helper that also updates `RequestItemIds`.
- **Record the verdicts.** Add treflex's verdicts to the "Feedback for treflex" section of `issues.md`.
- **Treflex 0.2.0.** Once it ships, re-vendor it. Read `docs/wip/done/release-0.2.0-breaking-changes.md` in the reflex repo first. Then move the minute clock to `provideExternal`/`external`.

## Parity

- **Secret and link requests can't be answered in reflex.** Port stock's `SecretRequestCard` and the link-request card. Until then, answer them in stock web on 5733. Also listed in `issues.md` under "Skipped for the prototype".
- **Settings reflex ignores.** Wire up whichever of the 19 settings still marked "Not used here yet" Tam picks. Send shortcut and Time format look easiest.

## Typing

- **Type-to-focus from buttons and links.** A key typed while a button or link has focus stays with it, as in stock (`shouldRedirectInputToComposer` in `src/composerFocusRedirect.ts`). That happens after clicking a sidebar thread or a header button. Tam wants any keypress to reach the composer. When focus is on a button or link, send printable keys to the composer, but keep Space and Enter activating the focused element. Keep the other exceptions: fields, open layers, keys with modifiers, and `aria-keyshortcuts`.

## Phone composer

- **Enter on phone.** The keyboard's Enter should insert a newline, and only the send button should send. Decide whether this is a coarse-pointer default or a setting. Check what stock does on touch.
- **The send button is unreliable on phone.** A tap often just closes the keyboard instead of sending. The likely cause is the textarea blurring on pointerdown: the keyboard collapses, the layout shifts, and the click misses. Likely fix: `preventDefault` on the send button's pointerdown or mousedown so the composer keeps focus. Verify on a real iPhone home-screen app.

## Polish

- **Dialog animations.** The Add project dialog has no open or close animation. Go through reflex's dialogs, popovers and menus, and compare each with stock's transitions.

## Housekeeping

- **Server start time.** On a server restart, check whether the roughly 50 seconds between launch and the first log line comes back. See `G:\Sorted\Code\t3code-dev-home\dev-stack\server.log`.
- **Empty worktree folders.** Delete the leftovers under `G:\Sorted\Code\t3code-dev-home\worktrees\t3code`: `reflex-landscape-header-*`, `reflex-inline-media-*` and `reflex-idle-compaction--c2d629098b4fd778`.
- **Stale worktrees.** Clean up about 50 registered `reflex/*` worktrees whose branches are merged.
