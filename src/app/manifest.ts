import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Casa · Gastos compartidos",
    short_name: "Casa",
    lang: "es-AR",
    description: "Las cuentas claras, la casa tranquila.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f8f5",
    theme_color: "#237461",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
