import {readdir,readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {it,expect} from "vitest";
it("gives every existing practice page a distinct instance route without duplicating its implementation",async()=>{
 const root=fileURLToPath(new URL("../app/app/[organisationSlug]/",import.meta.url));
 const files=await readdir(root,{recursive:true});const pages=files.filter(file=>file.endsWith("page.tsx")&&!file.startsWith("workspace-instances/"));expect(pages.length).toBeGreaterThan(20);
 for(const relative of pages){const alias=path.join(root,"workspace-instances/[workspaceMode]",relative);const source=await readFile(alias,"utf8");const imported=source.match(/from "([^"]+)"/);expect(imported).not.toBeNull();expect(path.resolve(path.dirname(alias),imported![1]+".tsx")).toBe(path.join(root,relative));expect(source).toContain("export {default");}
});
