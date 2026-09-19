import { useCallback, useEffect, useRef, useState } from "react";
import { parseScan, scanToQuery } from "../lib/cardLookup";
import styles from "../styles/Scan.module.css";

/**
 * Point a phone at a card, get the two strips that identify it.
 *
 * The scanner reads a guide frame, not a whole photograph. The guide is a
 * card-shaped outline the user lines the card up inside, which lets us crop two
 * narrow bands — the title along the top and the small print along the bottom —
 * and run OCR on those alone. Whole-card OCR reads the attack text, the flavour
 * text and the illustrator credit, and then has to guess which of forty
 * fragments was the name. Two known bands make the same job nearly trivial.
 *
 * Everything here runs in the browser and nothing is uploaded. The frame is
 * drawn to a canvas, cropped, recognised, and discarded; only the text goes to
 * the server. That is worth stating in the UI, because "let this website use
 * your camera" is a real thing to ask of somebody.
 *
 * Tesseract is loaded on demand. It is roughly four megabytes of WebAssembly
 * and language data, which is a lot to spend on a visitor who came to check a
 * booster box price, so it is imported when the camera opens and never during
 * the initial page load.
 *
 * OCR on a photographed card is genuinely unreliable — holofoil, glare, angle
 * and stylised name fonts all defeat it. The result is therefore treated as a
 * draft: it lands in the search box for the user to correct rather than being
 * fired straight at a lookup, and the typed path beside it is a peer, not a
 * fallback.
 */

/** Fractions of the guide frame occupied by the title and collector strips. */
const TITLE_BAND = { top: 0.03, height: 0.14 };
const BOTTOM_BAND = { top: 0.87, height: 0.13 };

/** Upscale crops before OCR: Tesseract is far more accurate above ~30px glyphs. */
const OCR_SCALE = 2;

type Props = {
  onRead: (query: string, debug: { title: string; bottom: string }) => void;
  onClose: () => void;
};

type Phase = "starting" | "ready" | "working" | "error";

export default function CardScanner({ onRead, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<{ recognize: (img: unknown) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> } | null>(null);

  const [phase, setPhase] = useState<Phase>("starting");
  const [message, setMessage] = useState<string>("Starting the camera…");

  // ── Camera lifecycle ──
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase("error");
        setMessage("This browser cannot open a camera. Type the card name instead.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setPhase("ready");
        setMessage("");
      } catch (err) {
        if (cancelled) return;
        setPhase("error");
        // Distinguish the two failures people actually hit: a refused
        // permission is fixable by the user, an insecure origin is not.
        const denied = err instanceof DOMException && err.name === "NotAllowedError";
        setMessage(
          denied
            ? "Camera access was declined. You can still type the card name below."
            : window.isSecureContext === false
              ? "Cameras only work over a secure connection. Type the card name instead."
              : "No camera available. Type the card name instead."
        );
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      workerRef.current?.terminate().catch(() => undefined);
      workerRef.current = null;
    };
  }, []);

  /** Crop one horizontal band of the guide frame into its own canvas. */
  const cropBand = useCallback(
    (video: HTMLVideoElement, band: { top: number; height: number }) => {
      // The guide frame is centred and sized to a card's 5:7 ratio against the
      // shorter axis of the video, matching what the overlay draws.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const frameH = vh * 0.8;
      const frameW = frameH * (5 / 7);
      const frameX = (vw - frameW) / 2;
      const frameY = (vh - frameH) / 2;

      const sx = frameX;
      const sy = frameY + frameH * band.top;
      const sw = frameW;
      const sh = frameH * band.height;

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sw * OCR_SCALE);
      canvas.height = Math.round(sh * OCR_SCALE);
      const ctx = canvas.getContext("2d");
      if (!ctx) return canvas;

      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      // Greyscale and hard contrast. Card art behind the title is the main
      // thing that confuses OCR, and a threshold removes most of it.
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = image.data;
      for (let i = 0; i < px.length; i += 4) {
        const grey = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        const value = grey > 145 ? 255 : 0;
        px[i] = px[i + 1] = px[i + 2] = value;
      }
      ctx.putImageData(image, 0, 0);
      return canvas;
    },
    []
  );

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    setPhase("working");
    setMessage("Reading the card…");

    try {
      if (!workerRef.current) {
        setMessage("Loading the text reader (one-time, a few megabytes)…");
        const { createWorker } = await import("tesseract.js");
        workerRef.current = (await createWorker("eng")) as unknown as typeof workerRef.current;
        setMessage("Reading the card…");
      }
      const worker = workerRef.current;
      if (!worker) throw new Error("worker unavailable");

      const title = cropBand(video, TITLE_BAND);
      const bottom = cropBand(video, BOTTOM_BAND);

      // Sequential, not parallel: one worker, and two concurrent recognitions
      // on a phone is the documented way to run it out of memory.
      const titleText = (await worker.recognize(title)).data.text;
      const bottomText = (await worker.recognize(bottom)).data.text;

      const scan = parseScan(titleText, bottomText);
      const query = scanToQuery(scan);

      if (!query) {
        setPhase("ready");
        setMessage("Could not read that one. Try more light, or type the name below.");
        return;
      }
      onRead(query, { title: titleText, bottom: bottomText });
    } catch {
      setPhase("ready");
      setMessage("The reader failed. Type the card name below instead.");
    }
  }, [cropBand, onRead]);

  return (
    <div className={styles.scanner}>
      <div className={styles.viewport}>
        <video ref={videoRef} className={styles.video} playsInline muted />
        <div className={styles.guide} aria-hidden="true">
          <span className={`${styles.band} ${styles.bandTop}`} />
          <span className={`${styles.band} ${styles.bandBottom}`} />
        </div>
      </div>

      <p className={styles.hint}>
        {message || "Line the card up inside the frame — the two highlighted strips are what gets read."}
      </p>

      <div className={styles.scanActions}>
        <button
          type="button"
          className={styles.captureBtn}
          onClick={capture}
          disabled={phase !== "ready"}
        >
          {phase === "working" ? "Reading…" : "Capture"}
        </button>
        <button type="button" className={styles.secondaryBtn} onClick={onClose}>
          Close camera
        </button>
      </div>

      <p className={styles.privacy}>
        The picture never leaves your phone — the text is read here in the
        browser, and only that text is sent to look the card up.
      </p>
    </div>
  );
}
