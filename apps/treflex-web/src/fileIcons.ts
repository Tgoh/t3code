import {
  createFileTreeIconResolver,
  getBuiltInSpriteSheet,
  type FileTreeIcons,
} from "@pierre/trees";
import { VIDEO_FILE_EXTENSIONS } from "@t3tools/shared/video";

// Follows apps/web/src/pierre-icons.ts and apps/web/src/components/chat/PierreEntryIcon.tsx.

const SPRITE_ID = "t3code-pierre-file-icon-sprite";

const DOCUMENT_ICON_COLORS: Readonly<Record<string, string>> = {
  "t3-file-icon-pdf": "light-dark(#d52c36, #ff6762)",
  "t3-file-icon-word": "light-dark(#1a85d4, #69b1ff)",
  "t3-file-icon-spreadsheet": "light-dark(#199f43, #5ecc71)",
  "t3-file-icon-slides": "light-dark(#d47628, #ffa359)",
  "t3-file-icon-epub": "light-dark(#693acf, #9d6afb)",
};

const T3_FILE_ICON_SPRITE = `
<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true">
  <!-- Lucide Film icon, ISC license. -->
  <symbol id="t3-file-icon-video" viewBox="0 0 24 24">
    <g fill="none" stroke="#a631be" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M7 3v18M3 7.5h4M3 12h18M3 16.5h4M17 3v18M17 7.5h4M17 16.5h4" />
    </g>
  </symbol>
  <symbol id="t3-file-icon-agents" viewBox="0 0 32 32">
    <path fill="currentColor" d="M27.2 16c0-6.19-5.01-11.2-11.2-11.2C9.81 4.8 4.8 9.81 4.8 16S9.81 27.2 16 27.2c6.19 0 11.2-5.01 11.2-11.2Zm-5.6 2.1a1.4 1.4 0 1 1 0 2.8h-4.2a1.4 1.4 0 1 1 0-2.8Zm-11.2-6.8c.622-.373 1.42-.208 1.84.361l.079.119 2.1 3.5.088.171c.15.351.15.748 0 1.1l-.088.171-2.1 3.5a1.4 1.4 0 0 1-2.4-1.44L11.59 16l-1.67-2.78-.067-.127c-.302-.642-.075-1.42.547-1.79ZM30 16c0 7.73-6.27 14-14 14S2 23.73 2 16 8.27 2 16 2s14 6.27 14 14Z" />
  </symbol>
  <symbol id="t3-file-icon-pnpm" viewBox="0 0 32 32">
    <path fill="#f9ad00" d="M30 10.75h-8.749V2H30Zm-9.626 0h-8.75V2h8.75Zm-9.625 0H2V2h8.749ZM30 20.375h-8.749v-8.75H30Z" />
    <path fill="currentColor" d="M20.374 20.375h-8.75v-8.75h8.75Zm0 9.625h-8.75v-8.75h8.75ZM30 30h-8.749v-8.75H30Zm-19.251 0H2v-8.75h8.749Z" />
  </symbol>
  <!-- Lucide Diff icon, ISC license. -->
  <symbol id="t3-file-icon-diff" viewBox="0 0 24 24">
    <path fill="none" style="stroke: light-dark(#199f43, #5ecc71)" stroke-width="2" stroke-linecap="round" d="M12 3v14M5 10h14M5 21h14" />
  </symbol>
  <!-- Lucide Code Xml icon, ISC license. -->
  <symbol id="t3-file-icon-xml" viewBox="0 0 24 24">
    <path fill="none" style="stroke: light-dark(#d47628, #ffa359)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16" />
  </symbol>
  <!-- Lucide File Type, File Text, File Spreadsheet, Presentation and Book Open icons, ISC license. -->
  <symbol id="t3-file-icon-pdf" viewBox="0 0 24 24">
    <g fill="none" style="stroke: var(--document-icon-stroke, ${DOCUMENT_ICON_COLORS["t3-file-icon-pdf"]})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M11 18h2" />
      <path d="M12 12v6" />
      <path d="M9 13v-.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v.5" />
    </g>
  </symbol>
  <symbol id="t3-file-icon-word" viewBox="0 0 24 24">
    <g fill="none" style="stroke: var(--document-icon-stroke, ${DOCUMENT_ICON_COLORS["t3-file-icon-word"]})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </g>
  </symbol>
  <symbol id="t3-file-icon-spreadsheet" viewBox="0 0 24 24">
    <g fill="none" style="stroke: var(--document-icon-stroke, ${DOCUMENT_ICON_COLORS["t3-file-icon-spreadsheet"]})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M8 13h2" />
      <path d="M14 13h2" />
      <path d="M8 17h2" />
      <path d="M14 17h2" />
    </g>
  </symbol>
  <symbol id="t3-file-icon-slides" viewBox="0 0 24 24">
    <g fill="none" style="stroke: var(--document-icon-stroke, ${DOCUMENT_ICON_COLORS["t3-file-icon-slides"]})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 3h20" />
      <path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" />
      <path d="m7 21 5-5 5 5" />
    </g>
  </symbol>
  <symbol id="t3-file-icon-epub" viewBox="0 0 24 24">
    <g fill="none" style="stroke: var(--document-icon-stroke, ${DOCUMENT_ICON_COLORS["t3-file-icon-epub"]})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </g>
  </symbol>
  <!-- Language logos from Simple Icons, CC0. -->
  <symbol id="t3-file-icon-csharp" viewBox="0 0 24 24">
    <path style="fill: light-dark(#693acf, #9d6afb)" d="M1.194 7.543v8.913c0 1.103.588 2.122 1.544 2.674l7.718 4.456a3.086 3.086 0 0 0 3.088 0l7.718-4.456a3.087 3.087 0 0 0 1.544-2.674V7.543a3.084 3.084 0 0 0-1.544-2.673L13.544.414a3.086 3.086 0 0 0-3.088 0L2.738 4.87a3.085 3.085 0 0 0-1.544 2.673Zm5.403 2.914v3.087a.77.77 0 0 0 .772.772.773.773 0 0 0 .772-.772.773.773 0 0 1 1.317-.546.775.775 0 0 1 .226.546 2.314 2.314 0 1 1-4.631 0v-3.087c0-.615.244-1.203.679-1.637a2.312 2.312 0 0 1 3.274 0c.434.434.678 1.023.678 1.637a.769.769 0 0 1-.226.545.767.767 0 0 1-1.091 0 .77.77 0 0 1-.226-.545.77.77 0 0 0-.772-.772.771.771 0 0 0-.772.772Zm12.35 3.087a.77.77 0 0 1-.772.772h-.772v.772a.773.773 0 0 1-1.544 0v-.772h-1.544v.772a.773.773 0 0 1-1.317.546.775.775 0 0 1-.226-.546v-.772H12a.771.771 0 1 1 0-1.544h.772v-1.543H12a.77.77 0 1 1 0-1.544h.772v-.772a.773.773 0 0 1 1.317-.546.775.775 0 0 1 .226.546v.772h1.544v-.772a.773.773 0 0 1 1.544 0v.772h.772a.772.772 0 0 1 0 1.544h-.772v1.543h.772a.776.776 0 0 1 .772.772Zm-3.088-2.315h-1.544v1.543h1.544v-1.543Z" />
  </symbol>
  <symbol id="t3-file-icon-kotlin" viewBox="0 0 24 24">
    <path style="fill: light-dark(#693acf, #9d6afb)" d="M24 24H0V0h24L12 12Z" />
  </symbol>
  <symbol id="t3-file-icon-haskell" viewBox="0 0 24 24">
    <path style="fill: light-dark(#693acf, #9d6afb)" d="M0 3.535L5.647 12 0 20.465h4.235L9.883 12 4.235 3.535zm5.647 0L11.294 12l-5.647 8.465h4.235l3.53-5.29 3.53 5.29h4.234L9.883 3.535zm8.941 4.938l1.883 2.822H24V8.473zm2.824 4.232l1.882 2.822H24v-2.822z" />
  </symbol>
  <symbol id="t3-file-icon-elixir" viewBox="0 0 24 24">
    <path style="fill: light-dark(#a631be, #d568ea)" d="M19.793 16.575c0 3.752-2.927 7.426-7.743 7.426-5.249 0-7.843-3.71-7.843-8.29 0-5.21 3.892-12.952 8-15.647a.397.397 0 0 1 .61.371 9.716 9.716 0 0 0 1.694 6.518c.522.795 1.092 1.478 1.763 2.352.94 1.227 1.637 1.906 2.644 3.842l.015.028a7.107 7.107 0 0 1 .86 3.4z" />
  </symbol>
  <symbol id="t3-file-icon-powershell" viewBox="0 0 24 24">
    <path style="fill: light-dark(#1a85d4, #69b1ff)" d="M23.181 2.974c.568 0 .923.463.792 1.035l-3.659 15.982c-.13.572-.697 1.035-1.265 1.035H.819c-.568 0-.923-.463-.792-1.035L3.686 4.009c.13-.572.697-1.035 1.265-1.035zm-8.375 9.346c.251-.394.227-.905-.09-1.243L9.122 5.125c-.38-.404-1.037-.407-1.466-.003-.429.402-.468 1.056-.088 1.46l4.662 4.96v.11l-7.42 5.374c-.45.327-.533.977-.187 1.453.346.476.991.597 1.44.27l8.229-5.91c.28-.196.438-.365.514-.52zm-2.796 4.399a.928.928 0 00-.934.923c0 .51.418.923.934.923h4.433a.928.928 0 00.934-.923.928.928 0 00-.934-.923z" />
  </symbol>
  <symbol id="t3-file-icon-toml" viewBox="0 0 24 24">
    <path style="fill: light-dark(#84848a, #adadb1)" d="M.014 0h5.34v2.652H2.888v18.681h2.468V24H.015V0Zm17.622 5.049v2.78h-4.274v12.935h-3.008V7.83H6.059V5.05h11.577ZM23.986 24h-5.34v-2.652h2.467V2.667h-2.468V0h5.34v24Z" />
  </symbol>
  <symbol id="t3-file-icon-scala" viewBox="0 0 24 24">
    <path style="fill: light-dark(#d52c36, #ff6762)" d="M4.589 24c4.537 0 13.81-1.516 14.821-3v-5.729c-.957 1.408-10.284 2.912-14.821 2.912V24zM4.589 16.365c4.537 0 13.81-1.516 14.821-3V7.636c-.957 1.408-10.284 2.912-14.821 2.912v5.817zM4.589 8.729c4.537 0 13.81-1.516 14.821-3V0C18.453 1.408 9.126 2.912 4.589 2.912v5.817z" />
  </symbol>
</svg>`;

const T3_PIERRE_ICONS = {
  set: "complete",
  colored: true,
  spriteSheet: T3_FILE_ICON_SPRITE,
  byFileName: {
    "package.json": "file-tree-builtin-npm",
    "tsconfig.json": "file-tree-builtin-typescript",
    "agents.md": "t3-file-icon-agents",
    "pnpm-lock.yaml": "t3-file-icon-pnpm",
    "pnpm-workspace.yaml": "t3-file-icon-pnpm",
  },
  byFileExtension: {
    ...Object.fromEntries(
      VIDEO_FILE_EXTENSIONS.map((extension) => [extension, "t3-file-icon-video"]),
    ),
    pdf: "t3-file-icon-pdf",
    doc: "t3-file-icon-word",
    docx: "t3-file-icon-word",
    odt: "t3-file-icon-word",
    rtf: "t3-file-icon-word",
    xls: "t3-file-icon-spreadsheet",
    xlsx: "t3-file-icon-spreadsheet",
    ods: "t3-file-icon-spreadsheet",
    csv: "t3-file-icon-spreadsheet",
    tsv: "t3-file-icon-spreadsheet",
    ppt: "t3-file-icon-slides",
    pptx: "t3-file-icon-slides",
    odp: "t3-file-icon-slides",
    epub: "t3-file-icon-epub",
    cs: "t3-file-icon-csharp",
    csx: "t3-file-icon-csharp",
    diff: "t3-file-icon-diff",
    patch: "t3-file-icon-diff",
    ex: "t3-file-icon-elixir",
    exs: "t3-file-icon-elixir",
    hs: "t3-file-icon-haskell",
    heic: "file-tree-builtin-image",
    heif: "file-tree-builtin-image",
    lhs: "t3-file-icon-haskell",
    kt: "t3-file-icon-kotlin",
    kts: "t3-file-icon-kotlin",
    ps1: "t3-file-icon-powershell",
    psm1: "t3-file-icon-powershell",
    psd1: "t3-file-icon-powershell",
    scala: "t3-file-icon-scala",
    toml: "t3-file-icon-toml",
    xml: "t3-file-icon-xml",
    xsd: "t3-file-icon-xml",
    xsl: "t3-file-icon-xml",
    xslt: "t3-file-icon-xml",
  },
} satisfies FileTreeIcons;

const resolver = createFileTreeIconResolver(T3_PIERRE_ICONS);

const ICON_COLORS: Record<string, readonly [light: string, dark: string]> = {
  astro: ["#a631be", "#d568ea"],
  babel: ["#d5a910", "#ffd452"],
  bash: ["#199f43", "#5ecc71"],
  biome: ["#1a85d4", "#69b1ff"],
  bootstrap: ["#693acf", "#9d6afb"],
  browserslist: ["#d5a910", "#ffd452"],
  bun: ["#594c5b", "#79697b"],
  c: ["#1a85d4", "#69b1ff"],
  claude: ["#d47628", "#ffa359"],
  cpp: ["#1a85d4", "#69b1ff"],
  css: ["#693acf", "#9d6afb"],
  database: ["#a631be", "#d568ea"],
  default: ["#84848a", "#adadb1"],
  docker: ["#1a85d4", "#69b1ff"],
  eslint: ["#693acf", "#9d6afb"],
  git: ["#ff8c5b", "#d5512f"],
  go: ["#1ca1c7", "#68cdf2"],
  graphql: ["#d32a61", "#ff678d"],
  html: ["#d47628", "#ffa359"],
  image: ["#d32a61", "#ff678d"],
  javascript: ["#d5a910", "#ffd452"],
  json: ["#d47628", "#ffa359"],
  markdown: ["#199f43", "#5ecc71"],
  mcp: ["#17a5af", "#64d1db"],
  nextjs: ["#84848a", "#adadb1"],
  npm: ["#d52c36", "#ff6762"],
  oxc: ["#1ca1c7", "#68cdf2"],
  postcss: ["#d52c36", "#ff6762"],
  prettier: ["#17a5af", "#64d1db"],
  python: ["#1a85d4", "#69b1ff"],
  react: ["#1ca1c7", "#68cdf2"],
  ruby: ["#d52c36", "#ff6762"],
  rust: ["#d47628", "#ffa359"],
  sass: ["#d32a61", "#ff678d"],
  stylelint: ["#84848a", "#adadb1"],
  svelte: ["#d52c36", "#ff6762"],
  svg: ["#d47628", "#ffa359"],
  svgo: ["#199f43", "#5ecc71"],
  swift: ["#d47628", "#ffa359"],
  table: ["#17a5af", "#64d1db"],
  tailwind: ["#1ca1c7", "#68cdf2"],
  terraform: ["#693acf", "#9d6afb"],
  text: ["#84848a", "#adadb1"],
  typescript: ["#1a85d4", "#69b1ff"],
  vite: ["#a631be", "#d568ea"],
  vscode: ["#1a85d4", "#69b1ff"],
  vue: ["#199f43", "#5ecc71"],
  wasm: ["#693acf", "#9d6afb"],
  webpack: ["#1a85d4", "#69b1ff"],
  yml: ["#d52c36", "#ff6762"],
  zig: ["#d47628", "#ffa359"],
  zip: ["#d47628", "#ffa359"],
};

const LANGUAGE_EXTENSION_ALIASES: Record<string, string> = {
  bash: "sh",
  csharp: "cs",
  elixir: "ex",
  haskell: "hs",
  javascript: "js",
  kotlin: "kt",
  markdown: "md",
  plaintext: "txt",
  powershell: "ps1",
  python: "py",
  ruby: "rb",
  rust: "rs",
  shell: "sh",
  shellscript: "sh",
  typescript: "ts",
  yaml: "yml",
};

const LANGUAGE_FILE_NAMES: Record<string, string> = { dockerfile: "Dockerfile" };

export interface IFileIcon {
  Name: string;
  Light: string;
  Dark: string;
}

export function fileIconFor(path: string): IFileIcon {
  const icon = resolver.resolveIcon("file-tree-icon-file", path);
  const token =
    icon.name === "file-tree-builtin-image" && icon.token === undefined
      ? "image"
      : (icon.token ?? "default");
  const [light, dark] = ICON_COLORS[token] ?? ICON_COLORS.default!;
  return { Name: icon.name, Light: light, Dark: dark };
}

export function languageFileName(languageId: string): string {
  const normalized = languageId.toLowerCase();
  return (
    LANGUAGE_FILE_NAMES[normalized] ??
    `file.${LANGUAGE_EXTENSION_ALIASES[normalized] ?? normalized}`
  );
}

export function hasSpecificIcon(fileName: string): boolean {
  return resolver.resolveIcon("file-tree-icon-file", fileName).token !== "default";
}

// Every icon references this one shared sprite.
export function ensureFileIconSprite(): void {
  if (document.getElementById(SPRITE_ID)) return;
  const container = document.createElement("div");
  container.id = SPRITE_ID;
  container.setAttribute("aria-hidden", "true");
  container.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  container.innerHTML = `${getBuiltInSpriteSheet("complete")}${T3_FILE_ICON_SPRITE}`;
  document.body.prepend(container);
}
