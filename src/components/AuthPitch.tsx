/**
 * The left half of every account screen.
 *
 * Sign in, sign up, forgot password and set-a-new-one all sit on the same
 * split: the pitch on ink, the form on paper. Pulled out of AuthForm so the
 * password-reset pages inherit it rather than copying it, because a recovery
 * screen that looks like a different product is exactly when someone decides
 * the email was phishing.
 *
 * A server component holding no state, so the map geometry it renders stays
 * out of the client bundle.
 */

const CLAIMS: { stat: string; label: string; detail: string }[] = [
  {
    stat: "17",
    label: "sites, one hunt",
    detail:
      "StreetEasy, Zillow, the sublet boards, the groups — each opens with your search set, and what you find lands on one board.",
  },
  {
    stat: "1",
    label: "keystroke to file it",
    detail: "A pipeline that tracks who you've texted, what's booked and what's gone quiet.",
  },
  {
    stat: "2",
    label: "taps to reach out",
    detail: "The text to the agent is pre-written; the tour drops onto your calendar in one click.",
  },
];

export default function AuthPitch({ children }: { children?: React.ReactNode }) {
  return (
    <section className="auth-pitch">
      {children}
      <div className="auth-pitch-inner">
        <div className="auth-mark">DamnLease</div>
        <h1>
          Be <span className="mark">first</span>,
          <br />
          not lucky.
        </h1>
        <p className="auth-lede">
          A good New York apartment goes to whoever replied first and
          followed through. Paste any place you find and this runs the chase:
          the honest price, the building&apos;s record, the message already
          written, and a watch on every place you&apos;re after. The hunt
          stops living in twelve browser tabs.
        </p>

        <ul className="auth-claims">
          {CLAIMS.map((claim) => (
            <li key={claim.label}>
              <b>{claim.stat}</b>
              <span>
                <strong>{claim.label}</strong>
                {claim.detail}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
