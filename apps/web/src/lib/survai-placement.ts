export type SurvaiDock = "home" | "left" | "right" | null;
export type SurvaiPlacement = { x: number; y: number; dock: SurvaiDock; side?: "left" | "right" };
export type SurvaiBounds = { width: number; height: number; viewportWidth: number; viewportHeight: number; expanded: boolean };
const GAP = 12;
export const SURVAI_SNAP_DISTANCE = 32;
export function survaiSide(placement: SurvaiPlacement) { return placement.dock === "left" ? "left" : placement.dock === "home" || placement.dock === "right" ? "right" : placement.side ?? "left"; }

/** Keep the tape case anchored as its fieldbook extends into the available page space. */
export function constrainSurvaiPlacement(placement: SurvaiPlacement, bounds: SurvaiBounds): SurvaiPlacement {
 const visibleWidth = bounds.expanded ? bounds.width : 68;
 const symbolOffsetX = !bounds.expanded && survaiSide(placement) === "right" ? Math.max(0, bounds.width - 68) : 0;
 const symbolOffsetY = bounds.expanded ? 0 : Math.max(0, bounds.height - 68);
 const minX = GAP - symbolOffsetX;
 const maxX = Math.max(minX, bounds.viewportWidth - visibleWidth - GAP - symbolOffsetX);
 const minY = GAP - symbolOffsetY;
 const maxY = Math.max(minY, bounds.viewportHeight - bounds.height - (bounds.expanded && placement.dock !== "home" ? GAP : GAP + 16));
 const x = placement.dock === "left" ? minX : placement.dock === "right" || placement.dock === "home" ? maxX : Math.min(maxX, Math.max(minX, placement.x));
 return { ...placement, x, y: placement.dock === "home" ? maxY : Math.min(maxY, Math.max(minY, placement.y)) };
}

export function snapSurvaiPlacement(placement: SurvaiPlacement, bounds: SurvaiBounds, pointerX?: number): SurvaiPlacement {
 const constrained = constrainSurvaiPlacement(placement, bounds);
 const home = constrainSurvaiPlacement({ ...constrained, dock: "home" }, bounds);
 const symbolOffset = !bounds.expanded && survaiSide(constrained) === "right" ? Math.max(0, bounds.width - 68) : 0;
 const visibleLeft = constrained.x + symbolOffset;
 const visibleRight = visibleLeft + (bounds.expanded ? bounds.width : 68);
 const homeRight = home.x + bounds.width;
 if (Math.abs(visibleRight - homeRight) <= SURVAI_SNAP_DISTANCE && Math.abs(constrained.y - home.y) <= SURVAI_SNAP_DISTANCE) return home;
 const leftDistance = visibleLeft - GAP, rightDistance = bounds.viewportWidth - GAP - visibleRight;
 const nearLeft = leftDistance <= SURVAI_SNAP_DISTANCE, nearRight = rightDistance <= SURVAI_SNAP_DISTANCE;
 const dock = nearLeft && nearRight ? (pointerX ?? visibleLeft + (bounds.expanded ? bounds.width : 68) / 2) < bounds.viewportWidth / 2 ? "left" : "right" : nearLeft ? "left" : nearRight ? "right" : null;
 return constrainSurvaiPlacement({ ...constrained, dock }, bounds);
}

export function parseSurvaiPlacement(raw: string | null): SurvaiPlacement | null {
 if (!raw) return null;
 try {
  const value = JSON.parse(raw);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && ["home", "left", "right", null].includes(value.dock) && (value.side === undefined || ["left", "right"].includes(value.side))) return { x: value.x, y: value.y, dock: value.dock, ...(value.side ? { side: value.side } : {}) };
 } catch { /* Ignore old or malformed device preferences. */ }
 return null;
}
