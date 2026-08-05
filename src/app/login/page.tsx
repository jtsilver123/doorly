import AuthForm from "@/components/AuthForm";
import AuthArt from "@/components/AuthArt";
import { signIn } from "@/app/auth/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <AuthForm mode="signin" action={signIn} initialError={error}>
      <AuthArt />
    </AuthForm>
  );
}
