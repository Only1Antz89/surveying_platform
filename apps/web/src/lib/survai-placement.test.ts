import { describe, expect, it } from "vitest";
import { constrainSurvaiPlacement, parseSurvaiPlacement, snapSurvaiPlacement, type SurvaiBounds } from "./survai-placement";
const desktop: SurvaiBounds = { width: 430, height: 700, viewportWidth: 1440, viewportHeight: 900, expanded: true };
describe("SurvAI placement", () => {
 it("keeps the expanded fieldbook inside the viewport", () => {
  expect(constrainSurvaiPlacement({ x: 5000, y: -5000, dock: null }, desktop)).toEqual({ x: 998, y: 12, dock: null });
 });
 it("allows the collapsed symbol to move near the top without clipping it", () => {
  expect(constrainSurvaiPlacement({ x: 1300, y: -900, dock: null }, { ...desktop, expanded: false })).toEqual({ x: 1300, y: -620, dock: null });
 });
 it("snaps only near an edge and preserves a floating centre position", () => {
  expect(snapSurvaiPlacement({ x: 30, y: 40, dock: null }, desktop).dock).toBe("left");
  expect(snapSurvaiPlacement({ x: 980, y: 40, dock: null }, desktop).dock).toBe("right");
  expect(snapSurvaiPlacement({ x: 500, y: 40, dock: null }, desktop).dock).toBeNull();
 });
 it("repositions a right dock when the viewport becomes smaller", () => {
  const mobile = { ...desktop, width: 366, height: 700, viewportWidth: 390, viewportHeight: 844 };
  expect(constrainSurvaiPlacement({ x: 998, y: 800, dock: "right" }, mobile)).toEqual({ x: 12, y: 132, dock: "right" });
 });
 it("rejects malformed device preferences", () => {
  expect(parseSurvaiPlacement('{"x":"100","y":20,"dock":"left"}')).toBeNull();
  expect(parseSurvaiPlacement('{"x":100,"y":20,"dock":"top"}')).toBeNull();
  expect(parseSurvaiPlacement("bad JSON")).toBeNull();
  expect(parseSurvaiPlacement('{"x":100,"y":20,"dock":null}')).toEqual({ x: 100, y: 20, dock: null });
 });
});
