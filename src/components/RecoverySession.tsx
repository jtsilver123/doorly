"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * The half of a recovery link the server can never see.
 *
 * Supabase hands the session back one of two ways. When the reset was
 * requested and opened in the same browser it uses PKCE, and the code arrives
 * as a query parameter that `/auth/callback` exchanges server-side. When it
 * wasn't — the request came from a laptop and the email was opened on a
 * phone, which is how most people actually reset a password — there is no
 * verifier to match, so the tokens come back in the URL *fragment* instead.
 *
 * Fragments are never sent to a server. So without this the cross-device case
 * lands on a page that correctly reports no session, and the user is told
 * their link expired when it didn't.
 *
 * Reading them here closes that. The fragment is stripped from the address bar
 * immediately afterwards, because a URL carrying a live refresh token is one
 * paste away from being shared.
 */
export default function RecoverySession() {
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("access_token")) return;

    const params = new URLSearchParams(hash.slice(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) return;

    setRestoring(true);
    // Out of the address bar before anything else, including on the failure
    // path — history.replaceState doesn't reload, so nothing is lost.
    window.history.replaceState(null, "", window.location.pathname);

    supabaseBrowser()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error }) => {
        // A full reload, not a router refresh: the server has to re-render
        // with the cookie the call above just wrote, and only a real
        // navigation resends it.
        if (!error) window.location.reload();
        else setRestoring(false);
      })
      .catch(() => setRestoring(false));
  }, []);

  if (!restoring) return null;
  return (
    <p className="auth-note" role="status">
      Checking your link…
    </p>
  );
}
