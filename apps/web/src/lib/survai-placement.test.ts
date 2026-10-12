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
 it("leaves room for the collapsed symbol caption at the bottom", () => {
  const position = constrainSurvaiPlacement({ x: 1300, y: 5000, dock: null }, { ...desktop, expanded: false });
  expect(position.y + desktop.height + 16).toBeLessThanOrEqual(desktop.viewportHeight - 12);
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
 it("anchors the default home at the bottom right through open, close and resizing", () => {
  const home = constrainSurvaiPlacement({ x: 0, y: 0, dock: "home" }, desktop);
  expect(home).toEqual({ x: 998, y: 172, dock: "home" });
  expect(constrainSurvaiPlacement(home, { ...desktop, expanded: false })).toEqual(home);
  expect(constrainSurvaiPlacement(home, { ...desktop, width: 480, height: 600 })).toEqual({ x: 948, y: 272, dock: "home" });
 });
 it("returns to the home slot on a nearby drop and leaves a moved case floating", () => {
  expect(snapSurvaiPlacement({ x: 980, y: 165, dock: null }, desktop).dock).toBe("home");
  expect(snapSurvaiPlacement({ x: 850, y: 165, dock: null }, desktop).dock).toBeNull();
 });
 it("resolves narrow-screen edge overlap using the dragged pointer", () => {
  const narrow = { ...desktop, width: 366, viewportWidth: 390 };
  expect(snapSurvaiPlacement({ x: 12, y: 40, dock: null }, narrow, 24).dock).toBe("left");
  expect(snapSurvaiPlacement({ x: 12, y: 40, dock: null }, narrow, 360).dock).toBe("right");
 });
 it("keeps a collapsed right-facing case inside the page when undocked", () => {
  const moved = constrainSurvaiPlacement({ x: 5000, y: 40, dock: null, side: "right" }, { ...desktop, expanded: false });
  expect(moved.x + desktop.width).toBe(desktop.viewportWidth - 12);
 });
 it("rejects malformed device preferences", () => {
  expect(parseSurvaiPlacement('{"x":"100","y":20,"dock":"left"}')).toBeNull();
  expect(parseSurvaiPlacement('{"x":100,"y":20,"dock":"top"}')).toBeNull();
  expect(parseSurvaiPlacement("bad JSON")).toBeNull();
  expect(parseSurvaiPlacement('{"x":100,"y":20,"dock":null}')).toEqual({ x: 100, y: 20, dock: null });
 });
});
