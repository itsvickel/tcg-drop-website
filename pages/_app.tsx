import type { AppProps } from "next/app";
import Head from "next/head";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Pokemon TCG Price Tracker — Best Canadian Prices</title>
        <meta
          name="description"
          content="Track live Pokemon TCG sealed product prices across 50+ Canadian retailers. Compare Elite Trainer Boxes, Booster Boxes, and more. Updated every 3 hours."
        />
        <meta name="robots" content="index, follow" />
        <meta property="og:type"        content="website" />
        <meta property="og:title"       content="Pokemon TCG Price Tracker — Best Canadian Prices" />
        <meta
          property="og:description"
          content="Live Pokemon TCG sealed product prices across 50+ Canadian retailers. Always find the best deal."
        />
        <meta name="theme-color" content="#0d1117" />
        <meta name="color-scheme" content="dark" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
