export interface IDiffFile {
  Path: string;
  Additions: number;
  Deletions: number;
  Patch: string;
}

function pathOf(lines: string[]): string {
  const hunk = lines.findIndex((line) => line.startsWith("@@"));
  const preamble = hunk < 0 ? lines : lines.slice(0, hunk);
  for (const pattern of [/^\+\+\+ "?b\/(.+?)"?$/, /^rename to (.+)$/, /^--- "?a\/(.+?)"?$/]) {
    for (const line of preamble) {
      const found = line.match(pattern);
      if (found !== null) return found[1]!;
    }
  }
  const header = lines[0]!;
  return header.match(/ "?b\/(.+?)"?$/)?.[1] ?? header.replace(/^diff --git /, "");
}

export interface IPatchRow {
  Kind: "added" | "removed" | "context" | "hunk";
  Number: number | null;
  Text: string;
}

export function patchRows(patch: string): IPatchRow[] {
  const rows: IPatchRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hunk !== null) {
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({ Kind: "hunk", Number: null, Text: hunk[3]?.trim() || line });
    } else if (!inHunk || line.startsWith("\\")) {
      continue;
    } else if (line.startsWith("+")) {
      rows.push({ Kind: "added", Number: newLine++, Text: line.slice(1) });
    } else if (line.startsWith("-")) {
      rows.push({ Kind: "removed", Number: oldLine++, Text: line.slice(1) });
    } else {
      rows.push({ Kind: "context", Number: newLine, Text: line.slice(1) });
      oldLine += 1;
      newLine += 1;
    }
  }
  return rows;
}

export function parseDiff(text: string): IDiffFile[] {
  if (text.trim() === "") return [];
  return text
    .split(/^(?=diff --git )/m)
    .filter((part) => part.startsWith("diff --git "))
    .map((patch) => {
      const lines = patch.replace(/\n$/, "").split("\n");
      let additions = 0;
      let deletions = 0;
      let inHunk = false;
      for (const line of lines) {
        if (line.startsWith("@@")) inHunk = true;
        else if (inHunk && line.startsWith("+")) additions += 1;
        else if (inHunk && line.startsWith("-")) deletions += 1;
      }
      return {
        Path: pathOf(lines),
        Additions: additions,
        Deletions: deletions,
        Patch: lines.join("\n"),
      };
    });
}
