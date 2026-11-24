// PreToolUse hook for Bash: refuses commands that write or edit files, which belong to Write and Edit.
// On Windows, sed and Python rewrite CRLF files as LF, and long inline scripts get cut off.
import * as NodeFS from "node:fs";

const input = JSON.parse(NodeFS.readFileSync(0, "utf8"));
const command = String(input.tool_input?.command ?? "");

// Heredoc bodies and quoted strings hold data, not shell syntax, so a `>` in them isn't a redirect.
const shell = command
  .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g, "<<HEREDOC")
  .replace(/'[^']*'/g, "''")
  .replace(/"(?:\\.|[^"\\])*"/g, '""');

const SAFE_TARGET = /^(\/dev\/null|&\d|\$null|NUL)$/i;
const reasons = [];
if (/\bsed\s+(-[a-zA-Z]*i|--in-place)/.test(shell)) reasons.push("`sed -i` edits a file in place");
if (/\bperl\s+-[a-zA-Z]*i/.test(shell)) reasons.push("`perl -i` edits a file in place");
if (
  /\bpython[\d.]*\b/.test(shell) &&
  /open\([^)]*['"][wa]b?['"]|\.write_text\(|\.write\(/.test(command)
)
  reasons.push("a Python script writes a file");
if (
  /\bnode\b/.test(shell) &&
  /\b(writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream)\s*\(/.test(command)
)
  reasons.push("a Node script writes a file");
if (/\b(Set-Content|Add-Content|Out-File)\b/.test(command))
  reasons.push("PowerShell writes a file");
for (const match of shell.matchAll(/(?:^|[\s;&|(])\d?>>?\s*([^\s;&|)<>]+)/g)) {
  if (!SAFE_TARGET.test(match[1])) reasons.push("a redirect writes a file");
}
for (const match of shell.matchAll(/\|\s*tee\s+(?:-a\s+)?([^\s;&|)]+)/g)) {
  if (!SAFE_TARGET.test(match[1])) reasons.push("`tee` writes a file");
}

if (reasons.length > 0) {
  process.stderr.write(
    `Blocked: ${reasons.join("; ")}. Write and edit files with the Write and Edit tools, never through Bash, merge conflicts included. A script may print to stdout; capture its output with Write. A long-running command's output can go through run_in_background instead of a redirect.\n`,
  );
  process.exit(2);
}
