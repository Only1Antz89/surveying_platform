import { z } from "zod";

// Pure floor-plan model shared by the server, the survey workspace and reports.

export const floors = ["lower_ground", "ground", "first", "second", "third", "fourth", "roof_space", "outbuilding"] as const;
export type Floor = (typeof floors)[number];
export const floorLabels: Record<Floor, string> = { lower_ground: "Lower ground floor", ground: "Ground floor", first: "First floor", second: "Second floor", third: "Third floor", fourth: "Fourth floor", roof_space: "Roof space", outbuilding: "Outbuildings" };

const metres = (max: number) => z.number().positive().max(max).multipleOf(0.01).nullable().optional();
export const roomInput = z.object({
  floor: z.enum(floors),
  name: z.string().trim().min(1).max(80),
  lengthM: metres(500),
  widthM: metres(500),
  heightM: metres(50),
  areaOverrideM2: metres(100000),
  notes: z.string().trim().max(500).nullable().optional(),
});
export type RoomInput = z.infer<typeof roomInput>;
export type Room = { id: string; floor: Floor; name: string; lengthM: number | null; widthM: number | null; heightM: number | null; areaOverrideM2: number | null; notes: string | null; position: number; version: number };

const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
export const squareFeet = (squareMetres: number) => round(squareMetres * 10.7639, 0);

/** Area in m²: an override when recorded, otherwise length × width, otherwise unknown. */
export function roomArea(room: Pick<Room, "lengthM" | "widthM" | "areaOverrideM2">): number | null {
  if (room.areaOverrideM2 != null) return round(room.areaOverrideM2);
  return room.lengthM != null && room.widthM != null ? round(room.lengthM * room.widthM) : null;
}

export type FloorSummary = { floor: Floor; label: string; rooms: (Room & { areaM2: number | null })[]; measuredAreaM2: number; unmeasured: number };
/** Rooms grouped in building order with measured totals; unmeasured rooms are counted, never guessed. */
export function summariseFloors(rooms: Room[]): { floors: FloorSummary[]; totalAreaM2: number; unmeasured: number } {
  const grouped = floors.flatMap((floor) => {
    const list = rooms.filter((room) => room.floor === floor).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)).map((room) => ({ ...room, areaM2: roomArea(room) }));
    if (!list.length) return [];
    return [{ floor, label: floorLabels[floor], rooms: list, measuredAreaM2: round(list.reduce((sum, room) => sum + (room.areaM2 ?? 0), 0)), unmeasured: list.filter((room) => room.areaM2 == null).length }];
  });
  return { floors: grouped, totalAreaM2: round(grouped.reduce((sum, floor) => sum + floor.measuredAreaM2, 0)), unmeasured: grouped.reduce((sum, floor) => sum + floor.unmeasured, 0) };
}

export type PlanRect = { id: string; name: string; x: number; y: number; width: number; height: number; areaM2: number | null; measured: boolean };
/**
 * A schematic layout for one floor: rooms drawn to their recorded dimensions and
 * packed into rows. Positions are illustrative, not the building's real arrangement.
 */
export function schematicLayout(rooms: Room[], rowWidthM = 14): { rects: PlanRect[]; width: number; height: number } {
  const rects: PlanRect[] = [];
  let x = 0, y = 0, rowHeight = 0, width = 0;
  for (const room of [...rooms].sort((a, b) => a.position - b.position)) {
    const area = roomArea(room);
    const measured = room.lengthM != null && room.widthM != null;
    const side = area ? Math.sqrt(area) : 2.5;
    const w = measured ? room.lengthM! : side, h = measured ? room.widthM! : side;
    if (x > 0 && x + w > rowWidthM) { x = 0; y += rowHeight + 0.4; rowHeight = 0; }
    rects.push({ id: room.id, name: room.name, x, y, width: w, height: h, areaM2: area, measured });
    x += w + 0.4; rowHeight = Math.max(rowHeight, h); width = Math.max(width, x - 0.4);
  }
  return { rects, width: round(width), height: round(y + rowHeight) };
}

export type AccommodationSchedule = { floors: { label: string; rooms: { name: string; dimensions: string | null; areaM2: number | null }[]; areaM2: number }[]; totalAreaM2: number; totalAreaSqFt: number; unmeasured: number; basis: string };
/** The report's accommodation schedule, frozen into the composed report version. */
export function accommodationSchedule(rooms: Room[]): AccommodationSchedule {
  const summary = summariseFloors(rooms);
  return {
    floors: summary.floors.map((floor) => ({ label: floor.label, areaM2: floor.measuredAreaM2, rooms: floor.rooms.map((room) => ({ name: room.name, dimensions: room.lengthM != null && room.widthM != null ? `${room.lengthM.toFixed(2)} m × ${room.widthM.toFixed(2)} m` : null, areaM2: room.areaM2 })) })),
    totalAreaM2: summary.totalAreaM2, totalAreaSqFt: squareFeet(summary.totalAreaM2), unmeasured: summary.unmeasured,
    basis: "Approximate internal measurements taken on site. Rooms that could not be measured are listed without an area.",
  };
}
