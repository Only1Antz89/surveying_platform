import { auth } from "@clerk/nextjs/server";
import { SignUp, SignOutButton } from "@clerk/nextjs";
import { z } from "zod";
import { notFound } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
export const metadata = { title: "Join Surveynt operations" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await auth();
  const error = (await searchParams).error;
  return (
    <AuthFrame
      title="Join Surveynt operations"
      description="Internal platform access is independent of customer accounts."
    >
      {error ? (
        <p className="console-error" role="alert">
          This invitation is unavailable or belongs to another account. Use the
          invited verified primary email and accept the Clerk email link first.
          Expired or revoked invitations require a new invitation.
        </p>
      ) : null}
      {session.userId ? (
        <form
          action={`/api/platform/staff-invitations/${id}/accept`}
          method="post"
        >
          <p>
            Continue with your verified invited account to accept platform
            access.
          </p>
          <SignOutButton redirectUrl={`/platform-invitations/${id}`}>
            <button type="button" className="button button-secondary">
              Use another account
            </button>
          </SignOutButton>
          <button className="button button-primary">
            Accept platform invitation
          </button>
        </form>
      ) : (
        <SignUp forceRedirectUrl={`/platform-invitations/${id}`} />
      )}
    </AuthFrame>
  );
}
