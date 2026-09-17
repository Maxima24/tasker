import type { MetadataRoute } from "next";

/**
 * Makes the console installable. On an iPhone, a web page can only receive
 * notifications once it has been added to the Home Screen, so this is what
 * lets an admin get ticket alerts there.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tasker Operations",
    short_name: "Tasker",
    description: "Assignment, proof and verification for an outsourced task operation.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#16181d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
