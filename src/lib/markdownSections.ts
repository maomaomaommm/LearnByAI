import { RevisionScope } from "./types";
import { resolveRepairAnchor } from "./repairAnchor";

export type MarkdownSection = {
  heading: string;
  headingLine: string;
  level: number;
  startLine: number;
  endLine: number;
  text: string;
};

/**
 * Split Markdown into heading-delimited sections. A section runs from its
 * heading line up to the next heading of the same or higher level. Shared by
 * the quality targeted-repair logic and the revise scope-anchor resolver.
 */
export function parseMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const headings = lines
    .map((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
      if (!match) return undefined;
      return {
        heading: match[2],
        headingLine: line.trim(),
        level: match[1].length,
        startLine: index,
      };
    })
    .filter((item): item is Omit<MarkdownSection, "endLine" | "text"> => Boolean(item));

  return headings.map((heading, index) => {
    const next = headings.find((candidate, candidateIndex) => candidateIndex > index && candidate.level <= heading.level);
    const endLine = next?.startLine ?? lines.length;
    return {
      ...heading,
      endLine,
      text: lines.slice(heading.startLine, endLine).join("\n").trim(),
    };
  });
}

/**
 * Resolve the exact, verbatim slice of `content` that a revision of the given
 * scope should target. The returned string is always a verbatim substring of
 * `content`, so the apply step can match it exactly once:
 *  - "selection": the unique anchor for the user's selection.
 *  - "paragraph": the blank-line-delimited block containing the selection.
 *  - "section":   the Markdown heading block containing the selection.
 *  - "chapter":   the whole content (chapter scope is otherwise driven by a
 *                 snapshot/regen, not by a text swap).
 * Returns undefined when the selection cannot be uniquely located.
 */
export function resolveRevisionScopeAnchor(
  content: string,
  scope: RevisionScope,
  selectedText: string,
): string | undefined {
  if (scope === "chapter") return content;

  const anchor = resolveRepairAnchor(content, selectedText);
  if (!anchor) return undefined;
  if (scope === "selection") return anchor;
  if (scope === "paragraph") return expandToParagraph(content, anchor);
  if (scope === "section") return expandToSection(content, anchor);
  return undefined;
}

function expandToParagraph(content: string, anchorText: string): string | undefined {
  const blocks = content.split(/\n{2,}/u);
  const matches = blocks.filter((block) => block.includes(anchorText));
  if (matches.length !== 1) return undefined;
  const block = matches[0];
  return content.includes(block) ? block : undefined;
}

function expandToSection(content: string, anchorText: string): string | undefined {
  const sections = parseMarkdownSections(content).filter((section) => section.text.includes(anchorText));
  if (!sections.length) return undefined;
  // Choose the deepest (most specific) section that still contains the anchor.
  const target = sections.reduce((deepest, section) => (section.level >= deepest.level ? section : deepest));
  return content.includes(target.text) ? target.text : undefined;
}
