import { expect, it } from "vitest";
import { suggestedServiceScope } from "./service-scope";
it.each([["RICS Level 1 Condition Report", "level_1"], ["Level 2 Home Survey & Valuation", "level_2"], ["RICS Level 3 Building Survey", "level_3"], ["Drone inspection", null], ["Valuation", null], ["", null]])("suggests only recognised scope: %s", (name, scope) => expect(suggestedServiceScope(name)).toBe(scope));
