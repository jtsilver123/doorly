import type { Metadata } from "next";
import AuthPitch from "@/components/AuthPitch";
import AuthArt from "@/components/AuthArt";
import PasswordForm from "@/components/PasswordForm";
import { updatePassword } from "@/app/auth/actions";
import { currentUser } from "@/lib/supabase/server";
import RecoverySession from "@/components/RecoverySession";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose a new password · DamnLease",
  robots: { index: false, follow: false },
};

/**
 * Where a recovery link lands.
 *
 * Reaching this page normally means the link already signed you in, and that
 * session is what authorises the change. The exception is a link opened on a
 * different device from the one that asked for it, where the tokens come back
 * in the URL fragment instead — RecoverySession picks those up, since a
 * fragment never reaches a server.
 *
 * Someone who arrives with neither is told so plainly rather than shown a form
 * that will fail on submit.
 */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await currentUser();

  return (
    <main className="auth">
      <AuthPitch>
        <AuthArt />
      </AuthPitch>
      <PasswordForm
        mode="set"
        action={updatePassword}
        initialError={
          error ??
          (user
            ? undefined
            : "This link has expired or was already used. Ask for a new one below.")
        }
      />
    </main>
  );
}
