import type { AppProps } from "next/app";
import Head from "next/head";
import { useEffect } from "react";
import { RETAILER_CLAIM, UPDATE_CADENCE } from "../lib/siteFacts";
import "../styles/globals.css";

/**
 * Registers the service worker, which caches only Next's immutable build
 * output — never HTML or prices. Registration is deferred to load so it never
 * competes with the first render.
 */
function useServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        // A failed registration must never surface to the reader.
        console.warn("[sw] registration failed:", err);
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
}

export default function App({ Component, pageProps }: AppProps) {
  useServiceWorker();
  return (
    <>
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>TCG Drop — Best Canadian Prices</title>
        <meta
          name="description"
          content={`Track live TCG sealed product prices across ${RETAILER_CLAIM} Canadian retailers. Compare Pokémon TCG and Magic: The Gathering prices. Updated ${UPDATE_CADENCE}.`}
        />
        <meta name="robots" content="index, follow" />
        <meta property="og:type"        content="website" />
        <meta property="og:title"       content="TCG Drop — Best Canadian Prices" />
        <meta
          property="og:description"
          content={`Live TCG sealed product prices across ${RETAILER_CLAIM} Canadian retailers. Always find the best deal.`}
        />
        <meta name="theme-color" content="#0d1117" />
        <meta name="color-scheme" content="dark" />
        {/* There is no favicon.ico in public/, so pointing at one just 404s on
            every page load. The SVG icon doubles as the tab icon. */}
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        {/* PNG, not the SVG. iOS ignores an SVG apple-touch-icon outright and
            falls back to a screenshot of the page, so the home-screen icon was
            a blurry thumbnail instead of the mark. 180px is what current
            iPhones ask for. */}
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="TCG Drop" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
