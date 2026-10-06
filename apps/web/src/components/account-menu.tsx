"use client";
import Link from "next/link";
import { OrganizationSwitcher, SignOutButton } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
export function AccountMenu({ href, name }: { href: string; name: string }) {
  const menu=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const dismiss=(event:PointerEvent)=>{if(menu.current?.open&&!menu.current.contains(event.target as Node))menu.current.open=false;};
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"&&menu.current?.open){menu.current.open=false;menu.current.querySelector("summary")?.focus();}};
    document.addEventListener("pointerdown",dismiss);document.addEventListener("keydown",escape);
    return()=>{document.removeEventListener("pointerdown",dismiss);document.removeEventListener("keydown",escape);};
  },[]);
  return <details ref={menu} className="account-menu"><summary className="avatar" aria-label="Your account menu">{name.split(/\s+/).map(part=>part[0]).join("").slice(0,2).toUpperCase()}</summary><div className="account-menu-content"><strong>{name}</strong><Link href={href}>Your account and preferences</Link>{process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?<><span className="muted">Switch practice</span><OrganizationSwitcher hidePersonal afterSelectOrganizationUrl={organisation=>`/app/${encodeURIComponent(organisation.slug??organisation.id)}/overview`} afterCreateOrganizationUrl="/start"/><SignOutButton redirectUrl="/sign-in"><button className="button button-quiet">Sign out</button></SignOutButton></>:<p>Local preview — sign in for secure account controls.</p>}</div></details>;
}
