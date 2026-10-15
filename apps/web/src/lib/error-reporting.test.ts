import { describe, expect, it } from "vitest";
import { safeErrorEvent, safeStoredErrorEvent, withheldErrorMessage } from "./error-reporting";

describe("private built-in error diagnostics", () => {
 it("never persists exception prose, SQL parameters, credential shapes, custom names or digests", () => {
  const sensitive = "Robin Example damp at 8 Fictional Lane AIzaSyntheticKey AQ.SyntheticKey token_secret1234";
  for (const error of [new Error(`Failed query insert into observations: params ${sensitive}`), Object.assign(new Error(sensitive), {name:sensitive,digest:sensitive}), sensitive, {message:sensitive,toString:()=>sensitive}]) {
   const event=safeErrorEvent(error,{path:`/api/v1/jobs/${sensitive}?key=${sensitive}`,method:"POST"},{routePath:"/api/v1/jobs/[id]",routeType:"route"});
   expect(event.message).toBe(withheldErrorMessage);expect(event.digest).toBeNull();expect(JSON.stringify(event)).not.toContain("Robin");expect(JSON.stringify(event)).not.toContain("SyntheticKey");
  }
 });
 it("uses only trusted route templates, known error classes and HTTP methods", () => {
  const event=safeErrorEvent(new TypeError("secret"),{path:"/customers/Robin?key=secret",method:"GET"},{routePath:"/app/[organisationSlug]/jobs/[id]",routeType:"render"});
  expect(event).toMatchObject({errorName:"TypeError",routePath:"/app/[organisationSlug]/jobs/[id]",method:"GET",routeType:"render"});
  expect(safeErrorEvent("secret",{path:"/customers/Robin",method:"SECRET"},{})).toMatchObject({routePath:"[unknown]",method:"OTHER",errorName:"Error"});
  expect(safeErrorEvent(new Error(),{path:"/",method:"POST"},{routePath:"/x?token=secret"}).routePath).toBe("[unknown]");
 });
 it("groups the same route and error class without including changing private text", () => {
  const context={routePath:"/api/v1/jobs/[id]",routeType:"route"};
  const first=safeErrorEvent(new TypeError("Robin"),{path:"/api/v1/jobs/a",method:"GET"},context);
  const second=safeErrorEvent(new TypeError("Another client"),{path:"/api/v1/jobs/b",method:"GET"},context);
  expect(first.fingerprint).toBe(second.fingerprint);
  expect(first.fingerprint).not.toBe(safeErrorEvent(new SyntaxError(),{path:"/",method:"GET"},context).fingerprint);
 });
 it("withholds historical rows until migration cleanup and preserves safe diagnostics", () => {
  const old = {fingerprint:"old", routePath:"/customers/Robin", routeType:"private data", method:"secret", errorName:"Robin", message:"SQL params: private", digest:"credential"};
  const safe = safeStoredErrorEvent(old);
  expect(safe).toMatchObject({routePath:"[unknown]", method:"OTHER", routeType:"unknown", errorName:"Error", message:withheldErrorMessage, digest:null});
  expect(JSON.stringify(safe)).not.toMatch(/Robin|credential|SQL/);
  const current=safeErrorEvent(new TypeError(),{path:"/",method:"GET"},{routePath:"/api/[id]",routeType:"route"});
  expect(safeStoredErrorEvent(current)).toEqual(current);
 });
});
