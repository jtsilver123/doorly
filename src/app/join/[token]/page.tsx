import { redirect } from "next/navigation";
import Link from "next/link";
import { adminDb } from "@/lib/supabase";
import { currentUser } from "@/lib/supabase/server";
import { acceptInvite } from "@/lib/crew";

/**
 * The landing page of an invite link.
 *
 * Somebody pasted this into a group chat. Whoever clicks it might have an
 * account, might not, and definitely didn't read any docs — so the page says
 * whose search it is, what they'll be able to do, and offers exactly one
 * button. The middleware stashes the token in a cookie for anyone who arrives
 * signed out, so the link survives the trip through signup.
 */

export const dynamic = "force-dynamic";

const ROLE_BLURB: Record<string, string> = {
  scout:
    "You'll be able to drop places into their pipeline — tagged as recommended by you — and watch how the hunt is going.",
  partner:
    "You'll share the whole pipeline: add places, move them along, and split who talks to which agent.",
};

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const { data: invite } = await adminDb()
    .from("crew_invites")
    .select("token, role, accepted_by, crews (name)")
    .eq("token", token)
    .maybeSingle();

  const crewName =
    (invite?.crews as unknown as { name: string } | null)?.name ?? null;
  const user = await currentUser();

  async function join() {
    "use server";
    await acceptInvite(token);
    redirect("/");
  }

  return (
    <main className="joinpage">
      <div className="surface joincard">
        {!invite ? (
          <>
            <h1>This invite has expired</h1>
            <p className="muted">
              The link doesn&apos;t match any open invitation — ask whoever sent
              it for a fresh one.
            </p>
            <Link className="btn btn-primary" href="/">
              Go to Doorly
            </Link>
          </>
        ) : (
          <>
            <h1>
              Join <b>{crewName}</b>
            </h1>
            <p className="muted">{ROLE_BLURB[invite.role] ?? ROLE_BLURB.scout}</p>
            {user ? (
              <form action={join}>
                <button className="btn btn-primary" type="submit">
                  Count me in
                </button>
              </form>
            ) : (
              <div className="joinauth">
                <Link className="btn btn-primary" href="/signup">
                  Create an account to join
                </Link>
                <Link className="btn" href="/login">
                  I already have one
                </Link>
                <p className="muted">
                  You&apos;ll come straight back here after — the invite is
                  remembered.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
