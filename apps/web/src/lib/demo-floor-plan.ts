import type { Room } from "./floor-plan-model";

/** A fictional Georgian terrace used in the local preview. */
export const demoRooms: Room[] = [
  { id: "room-hall", floor: "ground", name: "Entrance hall", lengthM: 5.2, widthM: 1.8, heightM: 3.1, areaOverrideM2: null, notes: null, position: 0, version: 1 },
  { id: "room-front", floor: "ground", name: "Front reception", lengthM: 4.6, widthM: 4.1, heightM: 3.1, areaOverrideM2: null, notes: "Bay window included in length.", position: 1, version: 1 },
  { id: "room-rear", floor: "ground", name: "Rear reception", lengthM: 4.2, widthM: 3.9, heightM: 3.1, areaOverrideM2: null, notes: null, position: 2, version: 1 },
  { id: "room-kitchen", floor: "ground", name: "Kitchen", lengthM: 4.8, widthM: 2.7, heightM: 2.6, areaOverrideM2: null, notes: null, position: 3, version: 1 },
  { id: "room-bed1", floor: "first", name: "Bedroom 1", lengthM: 4.6, widthM: 4.0, heightM: 2.9, areaOverrideM2: null, notes: null, position: 4, version: 1 },
  { id: "room-bed2", floor: "first", name: "Bedroom 2", lengthM: 3.9, widthM: 3.2, heightM: 2.9, areaOverrideM2: null, notes: null, position: 5, version: 1 },
  { id: "room-bath", floor: "first", name: "Bathroom", lengthM: 2.6, widthM: 2.2, heightM: 2.9, areaOverrideM2: null, notes: null, position: 6, version: 1 },
  { id: "room-loft", floor: "roof_space", name: "Loft", lengthM: null, widthM: null, heightM: null, areaOverrideM2: null, notes: "Viewed from the hatch only.", position: 7, version: 1 },
];
