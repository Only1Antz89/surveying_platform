import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { embeddingOrigins } from "@/lib/website-form";

const clerkProxy = clerkMiddleware();

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (request.nextUrl.pathname.startsWith("/app/north-star-surveying")) {
    const destination = request.nextUrl.clone();
    destination.pathname = request.nextUrl.pathname.replace("/app/north-star-surveying", "/app/clifton-surveyors");
    return NextResponse.redirect(destination);
  }
  const response = !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY ? NextResponse.next() : await clerkProxy(request, event) ?? NextResponse.next();
  let ancestors = "'none'";
  const embed = request.nextUrl.pathname.match(/^\/embed\/([a-z0-9-]{2,80})\/?$/);
  if (embed) {
    try { const origins = await embeddingOrigins(embed[1]); ancestors = origins.length ? origins.join(" ") : "'none'"; } catch { ancestors = "'none'"; }
    response.headers.set("Cache-Control", "no-store");
  } else if (request.nextUrl.pathname.startsWith("/website-form-preview/")) ancestors = "'self'";
  response.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors}`);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
