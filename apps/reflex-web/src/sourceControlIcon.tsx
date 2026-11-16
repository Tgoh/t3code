import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import type { VcsStatusResult } from "@t3tools/contracts";
import { createUniqueId, For, Show } from "solid-js";

import { GitPullRequest } from "./icons";

/**
 * Follows SourceControlIconArtwork in apps/web/src/components/SourceControlIconArtwork.tsx and
 * sourceControlIcon in apps/web/src/sourceControlPresentation.tsx: the host's mark, or the pull
 * request glyph for a host without one.
 */
export function SourceControlIcon(props: { status: VcsStatusResult | null; class?: string }) {
  const prefix = createUniqueId();
  const icon = () => sourceControlClients.get(props.status?.sourceControlProvider?.kind).icon;
  return (
    <Show when={icon()} fallback={<GitPullRequest class={props.class} />}>
      {(artwork) => {
        type IPaint = ReturnType<typeof artwork>["paths"][number]["fill"];
        const paint = (value: IPaint) =>
          value === undefined
            ? "none"
            : typeof value === "string"
              ? value
              : `url(#${prefix}-${value.gradient})`;
        return (
          <svg aria-hidden="true" class={props.class} viewBox={artwork().viewBox} fill="none">
            <Show when={artwork().gradients}>
              {(gradients) => (
                <defs>
                  <For each={gradients()}>
                    {(gradient) => (
                      <linearGradient
                        id={`${prefix}-${gradient.id}`}
                        x1={gradient.x1}
                        y1={gradient.y1}
                        x2={gradient.x2}
                        y2={gradient.y2}
                        gradientTransform={gradient.transform}
                        gradientUnits="userSpaceOnUse"
                      >
                        <For each={gradient.stops}>
                          {(stop) => (
                            <stop
                              offset={stop.offset}
                              stop-color={stop.color}
                              stop-opacity={stop.opacity}
                            />
                          )}
                        </For>
                      </linearGradient>
                    )}
                  </For>
                </defs>
              )}
            </Show>
            <For each={artwork().paths}>
              {(path) => (
                <path
                  d={path.d}
                  fill={paint(path.fill)}
                  fill-rule={path.fillRule}
                  fill-opacity={path.fillOpacity}
                  stroke={path.stroke}
                  stroke-width={path.strokeWidth}
                />
              )}
            </For>
          </svg>
        );
      }}
    </Show>
  );
}
