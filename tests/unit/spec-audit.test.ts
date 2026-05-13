import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PUBLIC_COPY_PATHS = [
  "README.md",
  "copy/live-safety-copy.md",
  "copy/youtube-metadata.md",
  "docs/PENUMBRA-about-ja.md",
  "docs/PENUMBRA-about-en.md",
  "docs/youtube-metadata.md",
  "public/about-ja.md",
  "public/about-en.md",
  "public/live-safety.txt",
  "public/youtube-metadata.md",
] as const;

describe("spec audit copy guardrails", () => {
  it("does not give the work listening subjectivity in public copy", () => {
    for (const path of PUBLIC_COPY_PATHS) {
      const text = readFileSync(join(process.cwd(), path), "utf8");
      expect(text).not.toMatch(/PENUMBRA continues to listen/i);
      expect(text).not.toMatch(/device listens/i);
      expect(text).not.toMatch(/装置が聴く/);
      expect(text).not.toMatch(/本作はただ聴き続け/);
    }
  });
});
