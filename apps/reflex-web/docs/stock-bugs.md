# Stock bugs

Bugs found in stock T3 Code (`apps/web`, `packages/client-runtime`, the server) while porting or comparing. Some may be worth reporting or fixing upstream. Each entry says where the bug is, what goes wrong, whether it was reproduced, and whether reflex has the same bug.

## History: a snapshot re-enables Load earlier while a fetch is running

- **Where:** `packages/client-runtime/src/state/threads.ts`, `loadEarlier` and the `snapshot` case of `applyItem`.
- **What goes wrong:** every socket snapshot writes `history.loading: false`, even when its cursor matches the fetch still running. The running fetch stays current, because `isActiveHistoryRequestCursor` still matches, so it lands. But the button is enabled again in the meantime, so a second fetch of the same cursor can start alongside the first.
- **Impact:** probably only a wasted request, since the second page has the same rows.
- **Status:** found by reading the code, not reproduced.
- **Reflex:** not affected. It keeps an unchanged window entity, so the fetch's busy mark survives the snapshot.

## Requests: answer buttons can re-enable while the answer is in flight

- **Where:** `apps/web/src/components/chat/usePendingThreadRequests.ts`.
- **What goes wrong:** `respondingRequestIds` and `respondingUserInputRequestIds` are `useState` in the hook. If the component remounts while a response command runs, the mark is lost and the buttons enable again. Approvals also have no guard against a repeat beyond the button re-rendering as disabled. User input has one (`userInputResponsesInFlight`).
- **Impact:** a second answer to the same request, which the server most likely rejects.
- **Status:** found by reading the code, not reproduced.
- **Reflex:** not affected. Each request is an entity with a `leading` answer action.
