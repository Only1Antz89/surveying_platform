"use client";
import type {ComponentProps} from "react";
import {useWorkspace} from "./workspace-provider";
import {workspaceHref,workspaceApiHref} from "@/lib/workspace-mode";
/** Native navigation for downloads and OAuth; scope stays in the URL, never in a shared cookie. */
export function WorkspaceAnchor({href,...props}:ComponentProps<"a">){const context=useWorkspace();const mapped=context&&href?workspaceApiHref(workspaceHref(href,context),context.workspaceMode):href;return <a {...props} href={mapped}/>;}
