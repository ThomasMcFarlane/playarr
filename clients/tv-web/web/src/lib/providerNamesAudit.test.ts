import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Owner rule (9 Oct 2026): "We should never mention the source providers in the Playarr frontend". This scans every
// user-visible text token in the web client and its admin (string literals, template text, JSX text, which also
// covers i18n values and aria/title/placeholder attributes) for provider names. Comments and identifiers are fine.
// Admin setup screens that must name an integration are listed in providerNamesAllowlist.txt.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PROVIDERS = /\b(sonarr|radarr|lidarr|readarr|prowlarr|bazarr|whisparr|tdarr|ombi|seerr|jellyseerr|overseerr|dubarr)\b|\*arr\b/i;
const SKIP_DIRS = new Set(["node_modules", "dist", "generated", "scripts", "stories", "public"]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

export function textTokens(file: string, text: string): { line: number; value: string }[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { line: number; value: string }[] = [];
  const add = (node: ts.Node, value: string) => {
    // A bare lowercase identifier ("sonarr") is a code value (an API kind), not display text.
    if (/^[a-z][a-z0-9_]*$/.test(value)) return;
    out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, value });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
      add(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function allowlist(): Set<string> {
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "providerNamesAllowlist.txt"), "utf8");
  return new Set(text.split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean));
}

describe("provider names audit", () => {
  it("detects names in text tokens only", () => {
    expect(textTokens("a.tsx", 'const a = "Sonarr"; // Radarr\nconst k = "radarr";')).toEqual([{ line: 1, value: "Sonarr" }]);
    expect(textTokens("a.tsx", "const j = <p>Ask Seerr</p>;").map((t) => PROVIDERS.test(t.value))).toContain(true);
  });

  it("keeps provider names out of user-visible web and admin text", () => {
    const allowed = allowlist();
    const offenders: string[] = [];
    for (const dir of ["web/src", "admin/src"]) {
      for (const path of sources(join(root, dir))) {
        const rel = relative(root, path);
        if (allowed.has(rel)) continue;
        for (const token of textTokens(path, readFileSync(path, "utf8"))) {
          if (PROVIDERS.test(token.value)) offenders.push(`${rel}:${token.line}: ${token.value.slice(0, 80)}`);
        }
      }
    }
    expect(offenders, "use neutral wording (library source, request service); admin setup screens go in providerNamesAllowlist.txt").toEqual([]);
  });

  it("only allowlists files that exist", () => {
    for (const rel of allowlist()) expect(() => readFileSync(join(root, rel)), rel).not.toThrow();
  });
});
