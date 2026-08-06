"use client";

import { useEffect, useState } from "react";
import { pendingUploads, subscribeUploads } from "@/lib/uploadQueue";

/**
 * The one visible trace of the upload queue once its panel is gone: a small
 * pill that says work is still moving, and disappears when it isn't. Sits
 * above the tab bar so a phone never hides it.
 */
export default function UploadStatus() {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    setPending(pendingUploads());
    return subscribeUploads(() => setPending(pendingUploads()));
  }, []);

  if (pending === 0) return null;
  return (
    <div className="uploadpill" role="status">
      <span className="uploadpill-spin" aria-hidden="true" />
      Uploading {pending} file{pending === 1 ? "" : "s"} — safe to keep browsing
    </div>
  );
}
