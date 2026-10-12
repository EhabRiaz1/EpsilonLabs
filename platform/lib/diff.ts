// Unified diff parser and a tiny syntax highlighter for the ticket diff viewer (project agent, migration 015). Pure:
// unit-tested in diff.test.ts. The diff text is written by the Mac worker (`git diff`, capped at 200 KB) from code the
// agent wrote, so it is rendered as text nodes only (never as HTML).

export type DiffLine = { type: "add" | "del" | "ctx"; old: number | null; new: number | null; text: string };
export type DiffHunk = { header: string; lines: DiffLine[] };
export type DiffFile = { path: string; oldPath: string | null; status: "added" | "deleted" | "renamed" | "modified"; binary: boolean; added: number; removed: number; hunks: DiffHunk[] };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

function stripPrefix(p: string): string {
  const s = p.trim().replace(/^"(.*)"$/, "$1");
  return s === "/dev/null" ? s : s.replace(/^[ab]\//, "");
}

/** Splits `git diff` output into files and hunks with old/new line numbers. Unknown lines are ignored. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let f: DiffFile | null = null;
  let h: DiffHunk | null = null;
  let oldN = 0;
  let newN = 0;
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      f = { path: m ? m[2] : line.slice(11), oldPath: null, status: "modified", binary: false, added: 0, removed: 0, hunks: [] };
      files.push(f);
      h = null;
      continue;
    }
    if (!f) continue;
    if (!h) {
      if (line.startsWith("new file mode")) f.status = "added";
      else if (line.startsWith("deleted file mode")) f.status = "deleted";
      else if (line.startsWith("rename from ")) {
        f.status = "renamed";
        f.oldPath = line.slice(12);
      } else if (line.startsWith("rename to ")) f.path = line.slice(10);
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") f.binary = true;
      else if (line.startsWith("--- ")) {
        const p = stripPrefix(line.slice(4));
        if (p !== "/dev/null" && f.status !== "renamed" && p !== f.path) f.oldPath = p;
      } else if (line.startsWith("+++ ")) {
        const p = stripPrefix(line.slice(4));
        if (p !== "/dev/null") f.path = p;
      }
    }
    const hm = HUNK.exec(line);
    if (hm) {
      h = { header: line, lines: [] };
      f.hunks.push(h);
      oldN = Number(hm[1]);
      newN = Number(hm[2]);
      continue;
    }
    if (!h) continue;
    if (line.startsWith("+")) {
      h.lines.push({ type: "add", old: null, new: newN++, text: line.slice(1) });
      f.added++;
    } else if (line.startsWith("-")) {
      h.lines.push({ type: "del", old: oldN++, new: null, text: line.slice(1) });
      f.removed++;
    } else if (line.startsWith(" ")) {
      h.lines.push({ type: "ctx", old: oldN++, new: newN++, text: line.slice(1) });
    }
    // anything else ("\ No newline at end of file", the output's trailing newline) is not a line of the file
  }
  return files;
}

export function diffTotals(files: DiffFile[]): { files: number; added: number; removed: number } {
  return files.reduce((t, f) => ({ files: t.files + 1, added: t.added + f.added, removed: t.removed + f.removed }), { files: 0, added: 0, removed: 0 });
}

/** The last path segment, for a file tab. */
export function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

// ---------------------------------------------------------------------------------------------- highlighting

export type Tok = { t: "kw" | "str" | "cm" | "nm" | "fn" | "ty" | null; s: string };
export type Lang = "js" | "py" | "go" | "rust" | "c" | "sh" | "css" | "sql" | "text";

const EXT: Record<string, Lang> = {
  js: "js", jsx: "js", ts: "js", tsx: "js", mjs: "js", cjs: "js", json: "js", py: "py", go: "go", rs: "rust",
  c: "c", h: "c", cpp: "c", hpp: "c", cc: "c", ino: "c", java: "c", kt: "c", swift: "c", cs: "c", dart: "c",
  sh: "sh", bash: "sh", zsh: "sh", css: "css", scss: "css", sql: "sql",
};

export function langFor(path: string): Lang {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return (m && EXT[m[1].toLowerCase()]) || "text";
}

const KW: Record<Lang, Set<string>> = {
  js: new Set("const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of this null undefined true false void interface type enum implements public private protected readonly static yield as".split(" ")),
  py: new Set("def return if elif else for while in not and or is None True False import from as class try except finally raise with lambda yield pass break continue global nonlocal async await assert del".split(" ")),
  go: new Set("func return if else for range switch case break continue package import var const type struct interface map chan go defer select nil true false default fallthrough goto".split(" ")),
  rust: new Set("fn let mut return if else for while loop match impl struct enum trait pub use mod crate self Self super const static ref move async await where as in true false None Some Ok Err unsafe dyn type".split(" ")),
  c: new Set("int char float double void long short unsigned signed return if else for while do switch case break continue struct union enum typedef const static extern sizeof include define ifdef ifndef endif class public private protected new delete this true false null nullptr bool auto namespace using template virtual override final import package".split(" ")),
  sh: new Set("if then else elif fi for in do done while case esac function return export local echo set unset".split(" ")),
  css: new Set([] as string[]),
  sql: new Set("select from where and or not insert into values update set delete create table index alter drop join left right inner outer on as group by order having limit offset begin commit returns return language function declare if then else end null is in exists case when distinct union all".split(" ")),
  text: new Set([] as string[]),
};

const LINE_COMMENT: Record<Lang, string[]> = { js: ["//"], py: ["#"], go: ["//"], rust: ["//"], c: ["//"], sh: ["#"], css: [], sql: ["--"], text: [] };

/** Tokens for one line (no state across lines: a block comment that spans lines is shown as plain text after its first line). */
export function highlight(line: string, lang: Lang): Tok[] {
  if (lang === "text" || !line) return [{ t: null, s: line }];
  const out: Tok[] = [];
  const push = (t: Tok["t"], s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last && last.t === t) last.s += s;
    else out.push({ t, s });
  };
  const kw = KW[lang];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    const lc = LINE_COMMENT[lang].find((c) => rest.startsWith(c));
    if (lc) {
      push("cm", rest);
      break;
    }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/", 2);
      const s = end < 0 ? rest : rest.slice(0, end + 2);
      push("cm", s);
      i += s.length;
      continue;
    }
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j += line[j] === "\\" ? 2 : 1;
      const s = line.slice(i, Math.min(j + 1, line.length));
      push("str", s);
      i += s.length;
      continue;
    }
    const num = /^(0x[0-9a-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)/.exec(rest);
    if (num && (i === 0 || !/[A-Za-z_$]/.test(line[i - 1]))) {
      push("nm", num[0]);
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest);
    if (word) {
      const w = word[0];
      const after = line.slice(i + w.length);
      const t: Tok["t"] = kw.has(lang === "sql" ? w.toLowerCase() : w) ? "kw" : /^\s*\(/.test(after) ? "fn" : /^[A-Z][a-z]/.test(w) && lang !== "sql" ? "ty" : null;
      push(t, w);
      i += w.length;
      continue;
    }
    push(null, ch);
    i += 1;
  }
  return out;
}
