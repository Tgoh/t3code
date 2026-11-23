import { errorText } from "./errorText";
import { StandalonePage, StandalonePageHeader } from "./ui/StandalonePage";

const raised = new WeakSet<object>();

/** Reports a view's throw once per error object, as an uncaught rejection the console shows. */
export function raiseViewCrash(error: unknown): void {
  if (error !== null && (typeof error === "object" || typeof error === "function")) {
    if (raised.has(error)) return;
    raised.add(error);
  }
  void Promise.reject(error);
}

/** The root `<Errored>`'s fallback. Solid swaps it back for the app once the throwing view recovers. */
export function ViewCrash(props: { error: unknown }) {
  return (
    <StandalonePage>
      <StandalonePageHeader
        title="Something went wrong"
        description={`A view failed: ${errorText(props.error)}. Reload the page to continue.`}
      />
    </StandalonePage>
  );
}
