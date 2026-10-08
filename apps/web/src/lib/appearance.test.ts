import { expect, it } from "vitest";
import { nextTheme } from "./appearance";
it("cycles system, light, dark and returns to system",()=>{
  expect(nextTheme("system")).toBe("light");
  expect(nextTheme("light")).toBe("dark");
  expect(nextTheme("dark")).toBe("system");
  expect(nextTheme(nextTheme(nextTheme("dark")))).toBe("dark");
});
