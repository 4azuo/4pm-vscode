/**
 * Tests of the console command splitter.
 * @adr 0670
 */
import { describe, expect, it } from "vitest";
import { splitArgs } from "./split-args";

describe("splitArgs", () => {
  it("splits on whitespace and keeps quoted groups", () => {
    expect(splitArgs(`npm run  "my script" 'a b' c\\ d`)).toEqual(["npm", "run", "my script", "a b", "c d"]);
  });

  it("keeps an empty quoted argument and ignores blank input", () => {
    expect(splitArgs(`echo ""`)).toEqual(["echo", ""]);
    expect(splitArgs("   ")).toEqual([]);
  });
});
