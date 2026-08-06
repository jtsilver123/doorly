"use client";

import { useEffect, useState } from "react";
import { pendingUploads, subscribeUploads, uploadProgress } from "@/lib/uploadQueue";

/**
 * The one visible trace of the upload queue once its panel is gone.
 *
 * A count alone ("uploading 1 file") answers the wrong question. On hotel wifi
 * a 200MB walkthrough takes minutes, and what someone actually wants to know
 * is whether it's moving and roughly how long they're stuck — so this carries
 * a real bar, driven by bytes acknowledged rather than files finished. Sits
 * above the tab bar so a phone never hides it.
 */
export default function UploadStatus() {
  const [state, setState] = useState({ pending: 0, ratio: 0, done: 0, total: 0 });

  useEffect(() => {
    const read = () => setState({ pending: pendingUploads(), ...uploadProgress() });
    read();
    return subscribeUploads(read);
  }, []);

  if (state.pending === 0) return null;
  const pct = Math.round(state.ratio * 100);
  const mb = (n: number) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0);

  return (
    <div className="uploadpill" role="status" aria-live="polite">
      <div className="uploadpill-top">
        <span>
          Uploading {state.pending} file{state.pending === 1 ? "" : "s"} — safe to keep
          browsing
        </span>
        <b>{pct}%</b>
      </div>
      <div
        className="uploadbar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <span className="uploadpill-sub">
        {mb(state.done)} of {mb(state.total)} MB
      </span>
    </div>
  );
}
