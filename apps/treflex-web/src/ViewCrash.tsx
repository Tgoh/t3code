import { errorText } from "./errorText";
import { StandalonePage, StandalonePageHeader } from "./ui/StandalonePage";

/** The render root's error hook: shows a throw an `<Errored>` caught as an uncaught rejection. */
export function raiseCaughtError(error: unknown): void {
  void Promise.reject(error);
}

/** The root `<Errored>`'s fallback. */
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
