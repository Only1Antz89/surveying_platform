import { describe, expect, it } from "vitest";
import { accommodationSchedule, roomArea, roomInput, schematicLayout, squareFeet, summariseFloors, type Room } from "./floor-plan-model";

const room = (overrides: Partial<Room>): Room => ({ id: "r", floor: "ground", name: "Room", lengthM: null, widthM: null, heightM: null, areaOverrideM2: null, notes: null, position: 0, version: 1, ...overrides });

describe("floor plan model", () => {
  it("derives area from dimensions, prefers an irregular-area override and never guesses", () => {
    expect(roomArea(room({ lengthM: 4.6, widthM: 4.1 }))).toBe(18.86);
    expect(roomArea(room({ lengthM: 4.6, widthM: 4.1, areaOverrideM2: 20.5 }))).toBe(20.5);
    expect(roomArea(room({ lengthM: 4.6 }))).toBeNull();
    expect(squareFeet(100)).toBe(1076);
  });
  it("groups floors in building order with measured totals and counts unmeasured rooms", () => {
    const summary = summariseFloors([room({ id: "a", floor: "first", name: "Bedroom", lengthM: 4, widthM: 3, position: 2 }), room({ id: "b", floor: "ground", name: "Kitchen", lengthM: 5, widthM: 3, position: 1 }), room({ id: "c", floor: "roof_space", name: "Loft" })]);
    expect(summary.floors.map((floor) => floor.label)).toEqual(["Ground floor", "First floor", "Roof space"]);
    expect(summary.totalAreaM2).toBe(27);
    expect(summary.unmeasured).toBe(1);
  });
  it("lays rooms out to scale in rows without overlap", () => {
    const layout = schematicLayout([room({ id: "a", lengthM: 10, widthM: 4 }), room({ id: "b", lengthM: 6, widthM: 3, position: 1 }), room({ id: "c", position: 2 })], 14);
    expect(layout.rects[0]).toMatchObject({ x: 0, y: 0, width: 10, height: 4, measured: true });
    expect(layout.rects[1].y).toBeGreaterThan(4);
    expect(layout.rects[2]).toMatchObject({ measured: false, width: 2.5 });
  });
  it("validates input in metres and builds a frozen accommodation schedule", () => {
    expect(roomInput.safeParse({ floor: "ground", name: "Hall", lengthM: -1 }).success).toBe(false);
    expect(roomInput.safeParse({ floor: "attic", name: "Hall" }).success).toBe(false);
    expect(roomInput.safeParse({ floor: "ground", name: "Hall", lengthM: 5.25, widthM: 1.8 }).success).toBe(true);
    const schedule = accommodationSchedule([room({ name: "Hall", lengthM: 5.25, widthM: 1.8 })]);
    expect(schedule.floors[0].rooms[0]).toEqual({ name: "Hall", dimensions: "5.25 m × 1.80 m", areaM2: 9.45 });
  });
});
