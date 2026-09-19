import { useCallback, useEffect, useRef, useState } from "react";
import { parseScan, scanToQuery } from "../lib/cardLookup";
import styles from "../styles/Scan.module.css";

/**
 * Point a phone at a card and it reads it. No shutter button.
 *
 * The first version asked the user to line a card up inside a frame and press
 * Capture, then OCR'd two razor-thin strips of that one frame. It was hard to
 * use for a reason that is obvious in hindsight: it gave the reader exactly one
 * attempt per press, on a single hand-held frame, cropped so tightly that being
 * slightly off meant reading the card's border. Every real scanner — Delver
 * Lens, TCGplayer, Dragon Shield — reads continuously instead, because the way
 * to beat a bad frame is another frame.
 *
 * So this runs a loop and keeps going until it agrees with itself:
 *
 *   * Continuous. OCR runs back-to-back on live frames; the user just holds the
 *     card up. There is nothing to press and nothing to time.
 *   * Consensus. A reading is only accepted once two passes agree, which costs
 *     a second or two and throws out the one-off garbage that a single frame
 *     produces over holofoil.
 *   * Generous crops. The name band is the top quarter of the card and the
 *     collector band the bottom fifth, rather than two 13% slivers. Tesseract
 *     copes with whitespace far better than with a clipped glyph.
 *   * Live feedback. What it is reading appears as it reads it, so a user can
 *     see it working and adjust, instead of pressing a button and being told no.
 *
 * The other half of the accuracy story is not here: the name is fuzzy-matched
 * server-side against an index of every card, so "Charlzard" finds Charizard.
 * OCR only has to get close.
 *
 * Everything runs in the browser. Frames are drawn to a canvas, read, and
 * discarded; only text leaves the device.
 */

/** Fractions of the guide frame read for each field. */
const NAME_BAND = { top: 0.02, height: 0.22 };
const CODE_BAND = { top: 0.8, height: 0.2 };

/** Target pixel height for a cropped band. Tesseract wants big glyphs. */
const TARGET_BAND_HEIGHT = 120;

/** Readings that must agree before a result is accepted. */
const CONSENSUS = 2;

/** Breather between passes, so the phone stays responsive and cool. */
const LOOP_PAUSE_MS = 250;

/** Quiet zone around a crop. Tesseract reads a glyph flush to the edge wrong. */
const BORDER_PX = 12;

/**
 * Quality gates, and the numbers come from a shipped browser document scanner
 * (docuSnap) rather than from taste.
 *
 * They exist to tell the user *why* it is not working. The old scanner failed
 * silently — you pressed a button, nothing happened, and nothing on screen
 * said whether the problem was the light, your hand, or the card. Saying "too
 * much glare, tilt the card" is worth more than any amount of extra OCR
 * tuning, because it is the only advice that actually fixes a foil.
 */
const BLUR_MIN_VARIANCE = 90;
const GLARE_MAX_RATIO = 0.06;
const GLARE_LUMA = 250;

type Props = {
  /** Called when two passes agree. May fire repeatedly as the card changes. */
  onRead: (query: string) => void;
  onClose: () => void;
};

type Phase = "starting" | "loading" | "scanning" | "error";

type Worker = {
  recognize: (img: unknown) => Promise<{ data: { text: string; confidence: number } }>;
  setParameters: (p: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};

export default function CardScanner({ onRead, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const recentRef = useRef<string[]>([]);
  const lastEmittedRef = useRef<string>("");

  const [phase, setPhase] = useState<Phase>("starting");
  const [message, setMessage] = useState("Starting the camera…");
  const [reading, setReading] = useState("");
  const [quality, setQuality] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchable, setTorchable] = useState(false);

  /**
   * Where the on-screen guide box actually sits in the video's own pixels.
   *
   * This is measured from the DOM rather than recomputed, and that is a fix
   * rather than a tidy-up. The first version derived the crop from
   * `videoHeight * 0.8` while the CSS drew the guide as 80% of a 4:3 box with
   * `object-fit: cover`. Those agree only when the camera hands back a
   * landscape track. On a portrait track — routine on Android, and iOS has been
   * observed returning the dimensions swapped between calls — they diverge
   * wildly: for a 1080x1920 stream the guide is at y≈636 in video pixels while
   * the crop was taken at y≈192, with a negative x. The scanner was reading the
   * background above the card and would never have matched anything.
   *
   * Reading both rectangles back from layout means there is one source of truth
   * for where the card is, whatever the camera does.
   */
  const guideInVideoSpace = useCallback((video: HTMLVideoElement) => {
    const guide = guideRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!guide || !vw || !vh) return null;

    const videoRect = video.getBoundingClientRect();
    const guideRect = guide.getBoundingClientRect();
    if (!videoRect.width || !videoRect.height) return null;

    // `object-fit: cover` scales to the larger ratio and centres the overflow.
    const scale = Math.max(videoRect.width / vw, videoRect.height / vh);
    const shownW = vw * scale;
    const shownH = vh * scale;
    const originX = videoRect.left + (videoRect.width - shownW) / 2;
    const originY = videoRect.top + (videoRect.height - shownH) / 2;

    return {
      x: (guideRect.left - originX) / scale,
      y: (guideRect.top - originY) / scale,
      w: guideRect.width / scale,
      h: guideRect.height / scale,
    };
  }, []);

  const cropBand = useCallback(
    (video: HTMLVideoElement, band: { top: number; height: number }, invert: boolean) => {
      const frame = guideInVideoSpace(video);
      const canvas = document.createElement("canvas");
      if (!frame) return canvas;

      const sx = frame.x;
      const sy = frame.y + frame.h * band.top;
      const sw = frame.w;
      const sh = frame.h * band.height;

      const scale = Math.max(1, TARGET_BAND_HEIGHT / sh);
      // Tesseract's own guidance asks for a small quiet zone around the text;
      // a glyph flush against the edge of the image reads as a different glyph.
      canvas.width = Math.round(sw * scale) + BORDER_PX * 2;
      canvas.height = Math.round(sh * scale) + BORDER_PX * 2;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return canvas;

      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        video,
        sx, sy, sw, sh,
        BORDER_PX, BORDER_PX,
        canvas.width - BORDER_PX * 2, canvas.height - BORDER_PX * 2
      );

      // Grayscale with the contrast stretched across the band's own range, and
      // no thresholding. Tesseract binarises internally with Otsu, which adapts
      // to the histogram; a fixed cutoff cannot, and the previous one erased the
      // text on any card with a dark title bar.
      const image = ctx.getImageData(
        BORDER_PX, BORDER_PX,
        canvas.width - BORDER_PX * 2, canvas.height - BORDER_PX * 2
      );
      const px = image.data;

      let min = 255;
      let max = 0;
      for (let i = 0; i < px.length; i += 4) {
        const grey = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        px[i] = grey;
        if (grey < min) min = grey;
        if (grey > max) max = grey;
      }
      const span = Math.max(1, max - min);
      for (let i = 0; i < px.length; i += 4) {
        let v = ((px[i] - min) / span) * 255;
        if (invert) v = 255 - v;
        px[i] = px[i + 1] = px[i + 2] = v;
        px[i + 3] = 255;
      }
      ctx.putImageData(image, BORDER_PX, BORDER_PX);
      return canvas;
    },
    [guideInVideoSpace]
  );

  /**
   * Whether this frame is worth reading, and what to tell the user if not.
   *
   * Cheap: one pass over a band that is already in memory. Variance of the
   * Laplacian is the standard sharpness measure, and the share of pixels pinned
   * at white is the standard glare measure — a foil under a ceiling light blows
   * out a patch that no amount of OCR tuning will recover, and the only fix is
   * for the person holding it to tilt it.
   */
  const gradeFrame = useCallback((canvas: HTMLCanvasElement): string | null => {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !canvas.width || !canvas.height) return null;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    let blown = 0;
    let sum = 0;
    let sumSq = 0;
    let n = 0;

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = (y * width + x) * 4;
        if (data[i] >= GLARE_LUMA) blown += 1;
        // 4-neighbour Laplacian on the already-grayscale buffer.
        const lap =
          4 * data[i] -
          data[i - 4] -
          data[i + 4] -
          data[i - width * 4] -
          data[i + width * 4];
        sum += lap;
        sumSq += lap * lap;
        n += 1;
      }
    }
    if (n === 0) return null;

    const variance = sumSq / n - (sum / n) ** 2;
    const glare = blown / n;

    if (glare > GLARE_MAX_RATIO) return "Too much glare — tilt the card away from the light.";
    if (variance < BLUR_MIN_VARIANCE) return "Hold steadier, or move a little closer.";
    return null;
  }, []);

  /** One OCR pass over both bands. Returns a query string, or "". */
  const readOnce = useCallback(async (): Promise<string> => {
    const video = videoRef.current;
    const worker = workerRef.current;
    if (!video || !worker || !video.videoWidth) return "";

    const nameCanvas = cropBand(video, NAME_BAND, false);

    // Graded before it is read, so a hopeless frame costs a millisecond instead
    // of a second and a half of OCR — and so the user is told what to change.
    const complaint = gradeFrame(nameCanvas);
    setQuality(complaint);
    if (complaint) return "";

    // Page segmentation mode 7 is "a single line of text", which is what both a
    // card name and a collector line are. The default (3) runs full page layout
    // analysis including column detection on a 600x120 strip, and routinely
    // splits a stylised title into fragments or discards it as noise.
    //
    // No character whitelist: `tessedit_char_whitelist` is documented as
    // unsupported under the LSTM engine this uses, so it would be a comment
    // pretending to be a constraint. The digit repair in parseScan does that job
    // afterwards, where it actually works.
    await worker.setParameters({
      tessedit_pageseg_mode: "7",
      user_defined_dpi: "300",
    });

    const nameText = (await worker.recognize(nameCanvas)).data.text;
    const codeText = (await worker.recognize(cropBand(video, CODE_BAND, false))).data.text;

    let scan = parseScan(nameText, codeText);

    // Tesseract 4 and later need dark text on a light ground and will not invert
    // for themselves. Plenty of modern cards print the name light-on-dark, so a
    // failed name gets one inverted retry rather than costing the whole pass.
    if (scan.nameCandidates.length === 0) {
      const inverted = (await worker.recognize(cropBand(video, NAME_BAND, true))).data.text;
      scan = parseScan(inverted, codeText);
    }

    return scanToQuery(scan);
  }, [cropBand, gradeFrame]);

  /** The scan loop. Runs until the component unmounts or the camera closes. */
  const loop = useCallback(async () => {
    while (runningRef.current) {
      let query = "";
      try {
        query = await readOnce();
      } catch {
        // A single failed pass is not worth telling anybody about; the next
        // frame is a second away.
      }

      if (query) {
        setReading(query);
        const key = query.toLowerCase();
        const recent = recentRef.current;
        recent.push(key);
        if (recent.length > 4) recent.shift();

        const agreeing = recent.filter((r) => r === key).length;
        if (agreeing >= CONSENSUS && key !== lastEmittedRef.current) {
          lastEmittedRef.current = key;
          recentRef.current = [];
          onRead(query);
        }
      }

      await new Promise((r) => setTimeout(r, LOOP_PAUSE_MS));
    }
  }, [onRead, readOnce]);

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

        const track = stream.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
        setTorchable(!!caps?.torch);

        setPhase("loading");
        setMessage("Loading the text reader (one-time, a few megabytes)…");
        const { createWorker } = await import("tesseract.js");
        const worker = (await createWorker("eng")) as unknown as Worker;
        if (cancelled) {
          void worker.terminate();
          return;
        }
        workerRef.current = worker;

        setPhase("scanning");
        setMessage("");
        runningRef.current = true;
        void loop();
      } catch (err) {
        if (cancelled) return;
        setPhase("error");
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
      runningRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [loop]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchable(false);
    }
  }, [torchOn]);

  return (
    <div className={styles.scanner}>
      <div className={styles.viewport}>
        <video ref={videoRef} className={styles.video} playsInline muted />
        <div ref={guideRef} className={styles.guide} aria-hidden="true">
          <span className={`${styles.band} ${styles.bandTop}`} />
          <span className={`${styles.band} ${styles.bandBottom}`} />
        </div>
        {phase === "scanning" && (
          <span className={styles.scanPulse} aria-hidden="true" />
        )}
      </div>

      <p className={styles.hint} aria-live="polite">
        {message ||
          quality ||
          (reading
            ? `Reading: ${reading}`
            : "Hold the card inside the frame — it reads continuously, nothing to press.")}
      </p>

      <div className={styles.scanActions}>
        {torchable && (
          <button type="button" className={styles.secondaryBtn} onClick={toggleTorch}>
            {torchOn ? "Light off" : "Light on"}
          </button>
        )}
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
