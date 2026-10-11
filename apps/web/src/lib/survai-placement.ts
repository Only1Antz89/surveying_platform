export type SurvaiDock = "left" | "right" | null;
export type SurvaiPlacement = { x: number; y: number; dock: SurvaiDock };
export type SurvaiBounds = { width: number; height: number; viewportWidth: number; viewportHeight: number; expanded: boolean };
const GAP = 12;
export const SURVAI_SNAP_DISTANCE = 32;

/** The collapsed symbol can move freely; opening always keeps the whole fieldbook on screen. */
export function constrainSurvaiPlacement(placement: SurvaiPlacement, bounds: SurvaiBounds): SurvaiPlacement {
 const visibleWidth = bounds.expanded ? bounds.width : 68;
 const symbolOffset = bounds.expanded ? 0 : Math.max(0, bounds.height - 68);
 const maxX = Math.max(GAP, bounds.viewportWidth - visibleWidth - GAP);
 const minY = GAP - symbolOffset;
 const maxY = Math.max(minY, bounds.viewportHeight - bounds.height - GAP);
 const x = placement.dock === "left" ? GAP : placement.dock === "right" ? maxX : Math.min(maxX, Math.max(GAP, placement.x));
 return { x, y: Math.min(maxY, Math.max(minY, placement.y)), dock: placement.dock };
}

export function snapSurvaiPlacement(placement: SurvaiPlacement, bounds: SurvaiBounds): SurvaiPlacement {
 const constrained = constrainSurvaiPlacement(placement, bounds);
 const visibleWidth = bounds.expanded ? bounds.width : 68;
 const right = Math.max(GAP, bounds.viewportWidth - visibleWidth - GAP);
 const dock = constrained.x - GAP <= SURVAI_SNAP_DISTANCE ? "left" : right - constrained.x <= SURVAI_SNAP_DISTANCE ? "right" : null;
 return constrainSurvaiPlacement({ ...constrained, dock }, bounds);
}

export function parseSurvaiPlacement(raw: string | null): SurvaiPlacement | null {
 if (!raw) return null;
 try {
  const value = JSON.parse(raw);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && ["left", "right", null].includes(value.dock)) return { x: value.x, y: value.y, dock: value.dock };
 } catch { /* Ignore old or malformed device preferences. */ }
 return null;
}
