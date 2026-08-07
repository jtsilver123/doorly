import type { Metadata } from "next";
import AuthPitch from "@/components/AuthPitch";
import AuthArt from "@/components/AuthArt";
import PasswordForm from "@/components/PasswordForm";
import { requestReset } from "@/app/auth/actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset your password · DamnLease",
  // Nothing here should ever turn up in a search result.
  robots: { index: false, follow: false },
};

export default async function ForgotPage() {
  return (
    <main className="auth">
      <AuthPitch>
        <AuthArt />
      </AuthPitch>
      <PasswordForm mode="request" action={requestReset} />
    </main>
  );
}
