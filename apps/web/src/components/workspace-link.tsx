"use client";
import NextLink from "next/link";
import type {ComponentProps} from "react";
import {useWorkspace} from "./workspace-provider";
import {workspaceHref,workspaceApiHref} from "@/lib/workspace-mode";
export default function WorkspaceLink({href,...props}:ComponentProps<typeof NextLink>){const context=useWorkspace();const mapped=context&&typeof href==="string"?workspaceApiHref(workspaceHref(href,context),context.workspaceMode):href;return <NextLink {...props} href={mapped}/>;}
