import AuthForm from "@/components/AuthForm";
import AuthArt from "@/components/AuthArt";
import { signUp } from "@/app/auth/actions";

export default function SignupPage() {
  // The art is a server component passed through as children, so the 126KB of
  // neighborhood geometry never reaches the client bundle — it arrives as
  // already-rendered SVG paths in the HTML.
  return (
    <AuthForm mode="signup" action={signUp}>
      <AuthArt />
    </AuthForm>
  );
}
