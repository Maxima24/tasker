"use client";

import * as React from "react";

/** Stream links are API paths; in the browser they go through the same-origin proxy. */
export function mediaSrc(streamUrl?: string | null): string | undefined {
  if (!streamUrl) return undefined;
  return streamUrl.startsWith("/") ? `/api${streamUrl}` : streamUrl;
}

type Props = Omit<React.VideoHTMLAttributes<HTMLVideoElement>, "src"> & {
  /** The signed stream link from the API. */
  streamUrl?: string | null;
  /** Which video this is. The link is only swapped when this changes. */
  videoId: string;
};

/**
 * A player for tutorial videos that does not offer them as files.
 *
 * The file arrives in ranges from a link signed for this person, so there is
 * no address to save. On top of that the player hides its download and cast
 * controls, picture-in-picture, and the right-click "Save video as". A
 * determined person can still record their screen - nothing on the web stops
 * that - but nobody walks away with the file by accident or in two clicks.
 */
export const ProtectedVideo = React.forwardRef<HTMLVideoElement, Props>(function ProtectedVideo(
  { streamUrl, videoId, onError, ...rest },
  ref,
) {
  // Keep the first link for this video. Every refetch mints a fresh one, and
  // swapping src mid-watch would restart playback from the beginning.
  const [src, setSrc] = React.useState(() => mediaSrc(streamUrl));
  const shownFor = React.useRef(videoId);
  const latest = React.useRef(streamUrl);
  latest.current = streamUrl;

  React.useEffect(() => {
    if (shownFor.current !== videoId) {
      shownFor.current = videoId;
      setSrc(mediaSrc(streamUrl));
    }
  }, [videoId, streamUrl]);

  return (
    <video
      ref={ref}
      src={src}
      controls
      playsInline
      controlsList="nodownload noremoteplayback"
      disablePictureInPicture
      draggable={false}
      onContextMenu={(e) => e.preventDefault()}
      onError={(e) => {
        // A link that lapsed while the page sat open: pick up the newer one.
        const fresh = mediaSrc(latest.current);
        if (fresh && fresh !== src) setSrc(fresh);
        onError?.(e);
      }}
      {...rest}
    />
  );
});
