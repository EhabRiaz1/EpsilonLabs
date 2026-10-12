import { describe, expect, it } from "vitest";
import { baseName, diffTotals, highlight, langFor, parseUnifiedDiff } from "./diff";

const DIFF = `diff --git a/src/recipes/export.ts b/src/recipes/export.ts
index 4f2c9e1..a91b3f0 100644
--- a/src/recipes/export.ts
+++ b/src/recipes/export.ts
@@ -10,4 +10,6 @@ export function exportOne(r: Recipe) {
 const SEP = ",";
-const EOL = "\\n";
+const EOL = "\\r\\n";
+// Excel wants CRLF
+export function exportBatch(rs: Recipe[]) { return rs.map(exportOne).join(EOL); }
 
 export default exportOne;
diff --git a/test/export.test.ts b/test/export.test.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/test/export.test.ts
@@ -0,0 +1,2 @@
+it("exports two", () => {});
+it("formats 3 dp", () => {});
diff --git a/old/name.ts b/new/name.ts
similarity index 90%
rename from old/name.ts
rename to new/name.ts
diff --git a/logo.png b/logo.png
index 1..2 100644
Binary files a/logo.png and b/logo.png differ
\\ No newline at end of file
`;

describe("parseUnifiedDiff", () => {
  const files = parseUnifiedDiff(DIFF);
  it("splits files with status, counts and paths", () => {
    expect(files.map((f) => [f.path, f.status, f.added, f.removed, f.binary])).toEqual([
      ["src/recipes/export.ts", "modified", 3, 1, false],
      ["test/export.test.ts", "added", 2, 0, false],
      ["new/name.ts", "renamed", 0, 0, false],
      ["logo.png", "modified", 0, 0, true],
    ]);
    expect(files[2].oldPath).toBe("old/name.ts");
    expect(diffTotals(files)).toEqual({ files: 4, added: 5, removed: 1 });
  });
  it("numbers old and new lines through a hunk", () => {
    const h = files[0].hunks[0];
    expect(h.header).toMatch(/^@@ -10,4 \+10,6 @@/);
    expect(h.lines.map((l) => [l.type, l.old, l.new])).toEqual([
      ["ctx", 10, 10], ["del", 11, null], ["add", null, 11], ["add", null, 12], ["add", null, 13], ["ctx", 12, 14], ["ctx", 13, 15],
    ]);
    expect(h.lines[1].text).toBe('const EOL = "\\n";');
    expect(files[1].hunks[0].lines[0]).toEqual({ type: "add", old: null, new: 1, text: 'it("exports two", () => {});' });
  });
  it("is safe on empty or junk input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("hello\n@@ -1 +1 @@\n+x")).toEqual([]);
    expect(parseUnifiedDiff("… diff truncated at 200 KB")).toEqual([]);
  });
  it("keeps markup as text", () => {
    const f = parseUnifiedDiff("diff --git a/x.html b/x.html\n--- a/x.html\n+++ b/x.html\n@@ -1 +1 @@\n-<b>\n+<script>alert(1)</script>\n");
    expect(f[0].hunks[0].lines[1].text).toBe("<script>alert(1)</script>");
  });
});

describe("highlight", () => {
  it("picks a language from the extension", () => {
    expect([langFor("a/b.tsx"), langFor("x.py"), langFor("main.c"), langFor("Makefile"), langFor("q.SQL")]).toEqual(["js", "py", "c", "text", "sql"]);
    expect(baseName("src/recipes/export.ts")).toBe("export.ts");
  });
  it("tokenises keywords, strings, numbers, calls and comments", () => {
    expect(highlight('const n = grams(12) + "kg"; // why', "js")).toEqual([
      { t: "kw", s: "const" }, { t: null, s: " n = " }, { t: "fn", s: "grams" }, { t: null, s: "(" }, { t: "nm", s: "12" },
      { t: null, s: ") + " }, { t: "str", s: '"kg"' }, { t: null, s: "; " }, { t: "cm", s: "// why" },
    ]);
    expect(highlight("def f(x):  # note", "py")).toEqual([
      { t: "kw", s: "def" }, { t: null, s: " " }, { t: "fn", s: "f" }, { t: null, s: "(x):  " }, { t: "cm", s: "# note" },
    ]);
    expect(highlight("x2 = 'it\\'s'", "py")).toEqual([{ t: null, s: "x2 = " }, { t: "str", s: "'it\\'s'" }]);
    expect(highlight("SELECT id FROM t", "sql")[0]).toEqual({ t: "kw", s: "SELECT" });
    expect(highlight("plain <b>", "text")).toEqual([{ t: null, s: "plain <b>" }]);
    expect(highlight("", "js")).toEqual([{ t: null, s: "" }]);
  });
  it("round-trips the text exactly", () => {
    for (const line of ['  return rs.map((r) => `${r.id},${r.w}`).join("\\r\\n"); /* x */ y', "unterminated 'str", "a /* open"]) {
      expect(highlight(line, "js").map((t) => t.s).join("")).toBe(line);
    }
  });
});
