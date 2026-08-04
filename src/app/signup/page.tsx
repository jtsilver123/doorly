import AuthForm from "@/components/AuthForm";
import { signUp } from "@/app/auth/actions";

export default function SignupPage() {
  return <AuthForm mode="signup" action={signUp} />;
}
