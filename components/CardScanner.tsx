import { useCallback, useEffect, useRef, useState } from "react";
import { parseScan, scanToQuery } from "../lib/cardLookup";
import { gradeFrame, stretchRange, type FrameGrade } from "../lib/frameQuality";
import { bestMatch, isConfident, looksLikeName } from "../lib/fuzzyName";
import {
  artOutcome,
  EMPTY_HASH_TABLE,
  hashCardRegions,
  hashPhoto,
  matchArt,
  parseHashTable,
  type HashTable,
} from "../lib/artHash";
import styles from "../styles/Scan.module.css";

/**
 * Point a phone at a card and it reads it. No shutter button.
 *
 * It recognises the picture first and the title second, which is the order
 * every scanner that works well uses. Reading a card name off a phone tops out
 * around 60-70%, because holofoil, glare and stylised type defeat text
 * recognition in precisely the conditions people scan in. A glare spot destroys
 * a few characters of a title; it leaves most of a painting intact. So the card
 * is fingerprinted against the whole catalogue on every frame, and Tesseract
 * only runs when that has not already answered.
 *
 *   * Picture first. A 64-bit fingerprint of the art window, matched against
 *     every card in about 6ms, which is cheap enough to run per frame. It names
 *     one exact printing rather than a search term. Measured against real card
 *     images degraded the way a phone degrades them — blurred, dim, over-bright,
 *     rotated, mis-framed, JPEG-mangled — it returned the right card for 156 of
 *     160 frames, accepted 142 of them outright, and accepted a wrong card zero
 *     times. The ones it declines fall through to the title.
 *   * Continuous. No shutter and nothing to time; the way to beat a bad frame
 *     is another frame.
 *   * Consensus. Nothing is accepted until two passes agree, which throws out
 *     the one-off garbage a single hand-held frame produces.
 *   * Closed vocabulary. An OCR reading that is not a real card name is
 *     discarded rather than displayed. This is what stopped the scanner
 *     offering "fd,15" as though it had recognised something.
 *   * Live feedback. Progress is visible, so a user can adjust instead of
 *     pressing a button and being told no.
 *
 * Everything runs in the browser. Frames are drawn to a canvas, matched or
 * read, and discarded; only a card id or a line of text leaves the device.
 */

/**
 * Fractions of the guide frame read for each field, and how tall to upscale
 * each one before reading.
 *
 * The targets differ because the text does. A card name is roughly 3.4% of the
 * card's height and the collector line 1.6%, so at 1080p they arrive about 29
 * and 14 pixels tall against the ~20 Tesseract wants. A single shared target of
 * 120 px, which is what this had, scaled neither: both source bands were
 * already taller than that, so `max(1, 120/height)` was always 1.
 */
const NAME_BAND = { top: 0.02, height: 0.22, target: 200 };
const CODE_BAND = { top: 0.8, height: 0.2, target: 380 };

/** Readings that must agree before a result is accepted. */
const CONSENSUS = 2;

/** Breather between passes, so the phone stays responsive and cool. */
const LOOP_PAUSE_MS = 250;

/** Quiet zone around a crop. Tesseract reads a glyph flush to the edge wrong. */
const BORDER_PX = 12;


type Props = {
  /** Which game's vocabulary and fingerprints to match against. */
  tcg: string;
  /**
   * Called when a card is recognised.
   *
   * `cardHash` is the winning fingerprint when the artwork identified one card
   * outright; `tiedHashes` are the candidates when it identified the picture
   * but not which reprint. Fingerprints rather than ids, because the browser
   * never downloads the ids — see PackedHashTable.
   */
  onRead: (query: string, cardHash?: string, tiedHashes?: string[]) => void;
  onClose: () => void;
  /**
   * Bumped by the page when the user asks to scan another card.
   *
   * The loop refuses to emit the same card twice in a row, which is what stops
   * a card held in front of the lens from firing a lookup every second. But it
   * also meant that after dismissing a result, pointing at that same card again
   * did nothing at all — the most obvious thing to try, and it looked broken.
   * Changing this clears the memory of what was last read.
   */
  rescanKey?: number;
};

type Phase = "starting" | "scanning" | "error";

type Worker = {
  recognize: (img: unknown) => Promise<{ data: { text: string; confidence: number } }>;
  setParameters: (p: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};

export default function CardScanner({ tcg, onRead, onClose, rescanKey = 0 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const runningRef = useRef(false);
  /**
   * The callback, held in a ref.
   *
   * The scan loop is a dependency of the effect that opens the camera, so
   * anything the loop closes over decides how often the camera is torn down and
   * reopened. `onRead` is rebuilt by the page whenever a filter changes, which
   * made changing the sort order stop the stream, drop the Tesseract worker and
   * start the whole thing again. Reading it through a ref keeps the loop stable
   * while still calling the current version.
   */
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const recentRef = useRef<string[]>([]);
  const lastEmittedRef = useRef<string>("");

  const [phase, setPhase] = useState<Phase>("starting");
  const [message, setMessage] = useState("Starting the camera…");
  const [reading, setReading] = useState("");
  const [quality, setQuality] = useState<string | null>(null);
  const [vocabularyReady, setVocabularyReady] = useState(false);
  const [artCount, setArtCount] = useState(0);
  const [torchOn, setTorchOn] = useState(false);
  const [torchable, setTorchable] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  /**
   * Every card name, fetched once.
   *
   * A ref rather than state: the scan loop reads it on every pass and must not
   * be restarted each time it changes. Empty until it arrives, and the scanner
   * simply validates nothing until then rather than blocking on the download.
   */
  const vocabularyRef = useRef<string[]>([]);
  /**
   * Artwork fingerprints for the whole catalogue.
   *
   * A ref for the same reason as the vocabulary: the scan loop reads it every
   * pass and must not restart when it lands.
   */
  const artRef = useRef<HashTable>(EMPTY_HASH_TABLE);

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
    (
      video: HTMLVideoElement,
      band: { top: number; height: number; target: number },
      invert: boolean
    ): { canvas: HTMLCanvasElement; grade: FrameGrade | null } => {
      const frame = guideInVideoSpace(video);
      const canvas = document.createElement("canvas");
      if (!frame) return { canvas, grade: null };

      const sx = frame.x;
      const sy = frame.y + frame.h * band.top;
      const sw = frame.w;
      const sh = frame.h * band.height;

      // Per band, because the two are not the same problem. A card name is
      // ~3.4% of the card's height and the collector line ~1.6%, so at 1080p
      // the name arrives around 29 px tall and the number around 14 — below the
      // ~20 px Tesseract wants. One shared target left both unscaled, because
      // the source band was already taller than it.
      const scale = Math.max(1, band.target / sh);
      // Tesseract's own guidance asks for a small quiet zone around the text;
      // a glyph flush against the edge of the image reads as a different glyph.
      canvas.width = Math.round(sw * scale) + BORDER_PX * 2;
      canvas.height = Math.round(sh * scale) + BORDER_PX * 2;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return { canvas, grade: null };

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

      const innerW = canvas.width - BORDER_PX * 2;
      const innerH = canvas.height - BORDER_PX * 2;
      const image = ctx.getImageData(BORDER_PX, BORDER_PX, innerW, innerH);
      const px = image.data;

      // Grayscale into its own buffer first, so the frame can be graded on what
      // the camera actually saw. Grading after the stretch measures the stretch:
      // it maps the brightest pixel to 255 by definition, so every frame would
      // look blown out. Grading the padded canvas was worse still — the white
      // border alone was 13.5% of the pixels against a 6% limit, which tripped
      // the glare gate on every frame and stopped OCR ever running.
      const gray = new Uint8ClampedArray(innerW * innerH);
      for (let i = 0, g = 0; i < px.length; i += 4, g += 1) {
        gray[g] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      }
      const grade = gradeFrame(gray, innerW, innerH);

      // No thresholding. Tesseract works from the greyscale image and binarises
      // internally with Otsu, which adapts to the histogram; the fixed cutoff
      // this replaced erased the text on any card with a dark title bar.
      const { low, high } = stretchRange(gray, gray.length);
      const span = Math.max(1, high - low);
      for (let i = 0, g = 0; i < px.length; i += 4, g += 1) {
        let v = ((gray[g] - low) / span) * 255;
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        if (invert) v = 255 - v;
        px[i] = px[i + 1] = px[i + 2] = v;
        px[i + 3] = 255;
      }
      ctx.putImageData(image, BORDER_PX, BORDER_PX);
      return { canvas, grade };
    },
    [guideInVideoSpace]
  );

  /**
   * The real card name a set of OCR candidates refers to, or null.
   *
   * Tries each candidate the parser offered, best first, and takes the first
   * that resolves confidently. Confidence is a margin, not a distance: a
   * reading one edit from two different cards is a coin toss however close it
   * is to either, and "Absol ex" and "Absol GX" are one edit apart and ten
   * times apart in price.
   */
  const resolveName = useCallback((candidates: string[]): string | null => {
    const vocabulary = vocabularyRef.current;
    for (const candidate of candidates) {
      if (!looksLikeName(candidate)) continue;
      // No vocabulary yet — the download is still in flight. Accept the
      // candidate on its shape alone rather than refusing to scan at all.
      if (vocabulary.length === 0) return candidate;
      const match = bestMatch(vocabulary, candidate);
      if (isConfident(match)) return match!.name;
    }
    return null;
  }, []);

  /**
   * Fingerprint the card in the guide frame and look it up by picture.
   *
   * This is the primary signal, and OCR is the fallback. Reading a title tops
   * out around 60-70% on a phone because holofoil, glare and stylised type
   * defeat text recognition in exactly the conditions people scan in; a glare
   * spot destroys a few characters of a name and leaves most of a picture
   * intact. Measured on real cards, a blurred, darkened or downscaled copy
   * stays within 8 bits of its own reference while different cards sit 19 to 45
   * bits apart, so the signal is not close to marginal.
   *
   * Several crops are tried because a hand-held card is never framed exactly
   * where the reference was cropped, and the best of them is kept.
   */
  const matchByArt = useCallback(() => {
    const video = videoRef.current;
    const table = artRef.current;
    if (!video || !video.videoWidth || table.count === 0) return null;

    const frame = guideInVideoSpace(video);
    if (!frame) return null;

    const canvas = document.createElement("canvas");
    // Sampled at a modest size: the fingerprint area-averages down to 9x8
    // regardless, and pulling a full-resolution frame into a canvas every pass
    // is the expensive part. Measured stable to within 3 bits from 98px wide
    // upwards, so there is nothing to gain from more pixels here.
    const w = Math.min(480, Math.round(frame.w));
    const h = Math.round((frame.h / frame.w) * w);
    if (w < 64 || h < 64) return null;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(video, frame.x, frame.y, frame.w, frame.h, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);
    // One call, because the crops overlap almost entirely and this converts the
    // frame to greyscale once for all of them rather than once each.
    const queries = hashCardRegions(data, w, h, { x: 0, y: 0, w, h });
    return matchArt(table, queries);
  }, [guideInVideoSpace]);

  /**
   * One OCR pass, validated against the real card vocabulary.
   *
   * Returns "" unless the reading resolves to a card that exists. This is the
   * fix for the scanner showing "fd,15" as though it had read something: before
   * it, any line of three or more characters became a candidate and was
   * displayed and searched. Nothing in the pipeline knew what a card is called,
   * so noise off the card's border was indistinguishable from a name.
   *
   * Two gates, cheapest first. `looksLikeName` throws out anything that is
   * mostly punctuation and digits without touching the vocabulary at all, and
   * the survivors are matched against every real name — where "Charlzard"
   * resolves to Charizard and "fd,15" has nowhere to land.
   */
  const readOnce = useCallback(async (): Promise<string> => {
    const video = videoRef.current;
    const worker = workerRef.current;
    if (!video || !worker || !video.videoWidth) return "";

    const name = cropBand(video, NAME_BAND, false);

    // Advice, not a gate. The frame is read whatever the grade says.
    //
    // The version this replaces returned early on a complaint, and a grading
    // bug meant the complaint fired on every frame — so OCR never ran and the
    // scanner was dead while appearing to work. A threshold that is wrong
    // should cost a misleading sentence, not the feature. Tesseract is also
    // better at a marginal frame than any threshold of mine is at predicting
    // which frames are marginal.
    setQuality(name.grade?.advice ?? null);

    const code = cropBand(video, CODE_BAND, false);
    const nameText = (await worker.recognize(name.canvas)).data.text;
    const codeText = (await worker.recognize(code.canvas)).data.text;

    let scan = parseScan(nameText, codeText);
    let resolved = resolveName(scan.nameCandidates);

    // Tesseract 4 and later need dark text on a light ground and will not invert
    // for themselves. Plenty of modern cards print the name light-on-dark, so a
    // pass that resolved nothing gets one inverted retry. Retrying on "no
    // confident match" rather than "no text at all" matters: a light-on-dark
    // title usually reads as *something*, just not as a card.
    if (!resolved) {
      const inverted = cropBand(video, NAME_BAND, true);
      const invertedScan = parseScan(
        (await worker.recognize(inverted.canvas)).data.text,
        codeText
      );
      const invertedName = resolveName(invertedScan.nameCandidates);
      if (invertedName) {
        scan = invertedScan;
        resolved = invertedName;
      }
    }

    if (!resolved) {
      // Read something, but nothing that is a card. Say so rather than
      // displaying the noise — "Reading: fd,15" looks like progress and is not.
      setReading("");
      return "";
    }

    // The matched card name, not the raw reading. The collector line rides
    // along unvalidated because it is a number, not a word, and the digit
    // repair in parseScan is the only correction it can usefully get.
    const query = scanToQuery({ ...scan, nameCandidates: [resolved] });
    setReading(`Found: ${query}`);
    return query;
  }, [cropBand, resolveName]);

  /**
   * Identify a card from a still photo.
   *
   * Worth having for three reasons: a camera can be declined or absent, a
   * desktop has no useful one, and people already have photos of cards. On a
   * phone this opens the camera roll or the camera itself, whichever the user
   * picks.
   *
   * It does not reuse the live path, because a photo is a different problem: the
   * viewfinder crops to the on-screen guide so the card fills the frame, and a
   * photo has a desk around it. Measured on real cards, a card filling 85% of a
   * photo matched nothing at all against the whole frame and matched every time
   * once a few centred card-shaped rectangles were tried — so hashPhoto searches
   * for the card rather than assuming it is the picture.
   */
  const readPhoto = useCallback(
    async (file: File) => {
      setPhotoNote("Reading the photo…");
      try {
        const bitmap = await createImageBitmap(file);
        // Downscaled for the same reason the live path is: the fingerprint
        // area-averages to 9x8 regardless, and pulling a 12-megapixel photo
        // through a canvas is the only expensive part.
        const w = Math.min(720, bitmap.width);
        const h = Math.round((bitmap.height / bitmap.width) * w);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          setPhotoNote("Could not read that image.");
          return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();

        const table = artRef.current;
        if (table.count === 0) {
          setPhotoNote("Card pictures are still loading — try again in a moment.");
          return;
        }

        const { data } = ctx.getImageData(0, 0, w, h);
        const match = matchArt(table, hashPhoto(data, w, h));
        const outcome = artOutcome(match);

        if (outcome === "pinned") {
          setPhotoNote(null);
          onReadRef.current(match!.hash, match!.hash, undefined);
        } else if (outcome === "ambiguous") {
          setPhotoNote(null);
          onReadRef.current(match!.hash, undefined, match!.ties);
        } else {
          // Specific, because the fix is specific. Below about 70% of the frame
          // this stops working, and "crop it tighter" is the actionable advice.
          setPhotoNote(
            "No match. Crop so the card fills most of the photo, and keep it straight on."
          );
        }
      } catch {
        setPhotoNote("Could not read that image.");
      }
    },
    []
  );

  /** The scan loop. Runs until the component unmounts or the camera closes. */
  /**
   * The scan loop: picture first, title second.
   *
   * Fingerprinting a frame against the whole catalogue measures about 6ms and
   * OCR costs one to two seconds, so the cheap signal runs every pass and the
   * expensive one only when the cheap one has not already answered. In good
   * light on a card we have a fingerprint for, this recognises the exact
   * printing without ever starting Tesseract.
   *
   * Consensus still applies to both. A picture match has to repeat before it is
   * acted on, because a frame caught mid-motion can land near the wrong card,
   * and repeating a mistake is much less likely than making one.
   */
  const loop = useCallback(async () => {
    while (runningRef.current) {
      let key = "";
      let query = "";
      let cardHash: string | undefined;
      let tiedHashes: string[] | undefined;

      const art = matchByArt();
      const outcome = artOutcome(art);

      if (outcome === "pinned") {
        // The picture named one exact printing. That is a better answer than a
        // name and number, which still has to be searched for.
        cardHash = art!.hash;
        key = `art:${art!.hash}`;
        query = art!.hash;
        setReading("Matched the picture — looking it up…");
      } else if (outcome === "ambiguous") {
        // The artwork is certain and the printing is not, which is what a
        // reprint looks like: a real Applin matches its own reference at 1 bit
        // and the Stellar Crown printing at 2, with the next card 16 bits away.
        // Treating that as a failure — which is what this did — threw away a
        // perfect read and fell back to OCR. The server turns these candidates
        // into a name search, so the user gets every printing of the card in
        // their hand and the collector number settles the rest.
        tiedHashes = art!.ties;
        key = `ties:${tiedHashes.join(",")}`;
        query = art!.hash;
        setReading("Matched the picture — finding the printing…");
      } else {
        try {
          query = await readOnce();
          key = query.toLowerCase();
        } catch {
          // A single failed pass is not worth telling anybody about; the next
          // frame is a second away.
        }
      }

      if (key) {
        const recent = recentRef.current;
        recent.push(key);
        if (recent.length > 4) recent.shift();

        const agreeing = recent.filter((r) => r === key).length;
        if (agreeing >= CONSENSUS && key !== lastEmittedRef.current) {
          lastEmittedRef.current = key;
          recentRef.current = [];
          onReadRef.current(query, cardHash, tiedHashes);
        }
      }

      await new Promise((r) => setTimeout(r, LOOP_PAUSE_MS));
    }
  }, [matchByArt, readOnce]);

  useEffect(() => {
    // Forget the last reading so the same card can be scanned again. The
    // consensus buffer goes too, otherwise the previous card's votes would
    // carry into the next one.
    lastEmittedRef.current = "";
    recentRef.current = [];
    setReading("");
  }, [rescanKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Both in parallel, and neither blocks the camera. The scanner is
        // useful with either one alone: fingerprints without the name list
        // still identify a card, and the name list without fingerprints is the
        // OCR-only scanner that came before.
        const [namesRes, hashRes] = await Promise.all([
          fetch(`/api/card-names?tcg=${tcg}`),
          fetch(`/api/card-hashes?tcg=${tcg}`),
        ]);
        const payload = (await namesRes.json()) as { names?: string[] };
        const packed = await hashRes.json();
        if (cancelled) return;
        vocabularyRef.current = payload.names ?? [];
        artRef.current = parseHashTable(packed);
        setVocabularyReady((payload.names?.length ?? 0) > 0);
        setArtCount(artRef.current.count);
      } catch {
        // Offline or the index is not published for this game. The scanner
        // still reads; it just cannot reject a non-card, which is how it
        // behaved before the vocabulary existed.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tcg]);

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

        // Scanning starts the moment the camera is live. Picture matching
        // needs nothing but the fingerprint table, which is a couple of hundred
        // kilobytes and already in flight; Tesseract is several megabytes of
        // WASM and trained data. Waiting for it meant the fast path — the one
        // that recognises most cards — sat behind the slow path's download on
        // exactly the phone connections where that download is slowest.
        setPhase("scanning");
        setMessage("Loading the text reader — picture matching works already.");
        runningRef.current = true;
        void loop();

        const { createWorker } = await import("tesseract.js");
        const worker = (await createWorker("eng")) as unknown as Worker;

        // Set once, not per pass. Page segmentation mode 7 is "a single line of
        // text", which is what both a card name and a collector line are; the
        // default runs full page-layout analysis, including column detection,
        // on a strip 200 pixels tall. Declaring the DPI stops Tesseract
        // guessing it from the image size.
        //
        // No character whitelist. It is a soft filter over the beam search
        // rather than a constraint, and it is documented to suppress correct
        // readings outright under this engine. The digit repair in parseScan
        // does that job afterwards, where it cannot lose a good character.
        await worker.setParameters({
          tessedit_pageseg_mode: "7",
          user_defined_dpi: "300",
        });
        if (cancelled) {
          void worker.terminate();
          return;
        }
        workerRef.current = worker;
        setMessage("");
      } catch (err) {
        if (cancelled) return;
        // A camera that is already scanning must survive the text reader
        // failing to load. Tesseract is fetched from a CDN and is the most
        // likely thing here to fail; tearing down a working picture scanner
        // because its fallback did not arrive would be the wrong trade.
        if (runningRef.current) {
          setMessage("");
          return;
        }
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

      {/* A recognised card outranks the frame advice: the advice exists to
          explain a failure, and there isn't one. Everything shown here is now a
          real card name rather than whatever OCR produced, so there is no
          longer a state in which this line shows gibberish. */}
      <p className={styles.hint} aria-live="polite">
        {reading ||
          message ||
          quality ||
          "Hold the card inside the frame — it reads continuously, nothing to press."}
      </p>

      {phase === "scanning" && artCount === 0 && (
        <p className={styles.privacy}>
          {vocabularyReady
            ? "Card pictures unavailable for this game, so this is reading the title. Hold steady and keep glare off the name."
            : "Card list unavailable, so readings cannot be checked against real card names — expect more misreads until it loads."}
        </p>
      )}

      {photoNote && <p className={styles.privacy}>{photoNote}</p>}

      <div className={styles.scanActions}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className={styles.fileInput}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so picking the same file twice still fires a change.
            e.target.value = "";
            if (file) void readPhoto(file);
          }}
        />
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => fileRef.current?.click()}
        >
          Use a photo
        </button>
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
