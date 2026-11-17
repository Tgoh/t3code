/** The card that sits on top of the composer, tucked under its rounded top. Tint it with `data-tone="warning"` or `data-tone="error"`. */
export const BANNER_FRAME =
  "-mb-4 rounded-t-[16px] border border-b-0 border-(--banner-outline) text-[14px] [background:linear-gradient(var(--banner-tint),var(--banner-tint)),var(--composer-surface)] [--banner-outline:var(--composer-outline)] [--banner-tint:transparent] data-[tone=error]:[--banner-outline:color-mix(in_srgb,var(--error)_28%,transparent)] data-[tone=error]:[--banner-tint:color-mix(in_srgb,var(--error)_8%,transparent)] data-[tone=warning]:[--banner-outline:color-mix(in_srgb,var(--warning)_28%,transparent)] data-[tone=warning]:[--banner-tint:color-mix(in_srgb,var(--warning)_8%,transparent)]";

export const BANNER = `${BANNER_FRAME} px-3.5 pt-2.5 pb-6.5`;

export const BANNER_TITLE =
  "flex items-center gap-2 leading-6 font-medium in-data-[tone=error]:[&>svg]:text-error-foreground in-data-[tone=warning]:[&>svg]:text-warning-foreground [&_strong]:font-medium";

export const BANNER_BODY =
  "mt-0.5 mr-0 mb-1.5 ml-6 max-h-40 overflow-auto [font-family:inherit] text-[14px] leading-[1.625] wrap-anywhere whitespace-pre-wrap text-[color-mix(in_srgb,var(--foreground)_80%,transparent)]";

export const BANNER_ACTIONS = "ml-6 flex flex-wrap gap-2";

export const ERROR_TEXT = "mx-4 my-1 text-[12px] text-error-foreground";
