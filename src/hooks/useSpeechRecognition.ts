import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice input via the browser's Web Speech API (build doc §13 / v2.1:
 * "voice input — browser Web Speech API, text responses; front-end-only").
 *
 * Recognition runs continuously with interim results so the stakeholder
 * sees their words land as they speak; final segments are committed through
 * onFinal. Everything stays editable text before send — the AI still
 * responds in text, and nothing about the session transport changes.
 * (A future speech-to-speech phase — e.g. OpenAI Realtime — replaces the
 * transport, not this affordance.)
 *
 * Chrome / Edge / Safari expose webkitSpeechRecognition; Firefox has no
 * implementation, so `supported` gates the mic button entirely.
 */

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [i: number]: RecognitionResult };
}
interface RecognitionErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition({
  onFinal,
  onInterim,
}: {
  /** A finished utterance — append it to the draft. */
  onFinal: (text: string) => void;
  /** The in-flight utterance — preview it after the committed draft. */
  onInterim: (text: string) => void;
}) {
  const supported = getRecognitionCtor() !== null;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantedRef = useRef(false);
  // Keep callbacks fresh without re-creating the recognition instance.
  const cbRef = useRef({ onFinal, onInterim });
  cbRef.current = { onFinal, onInterim };

  const stop = useCallback(() => {
    wantedRef.current = false;
    recRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || wantedRef.current) return;
    setError(null);
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) cbRef.current.onFinal(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      cbRef.current.onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone access was blocked — allow it in your browser to speak your answers.");
        wantedRef.current = false;
        setListening(false);
      }
      // 'no-speech' and 'aborted' are routine; onend handles restart.
    };
    rec.onend = () => {
      cbRef.current.onInterim("");
      // Browsers end recognition after silence; restart while the user
      // still has the mic on so a pause doesn't silently stop dictation.
      if (wantedRef.current && recRef.current === rec) {
        try {
          rec.start();
        } catch {
          setListening(false);
          wantedRef.current = false;
        }
      }
    };
    recRef.current = rec;
    wantedRef.current = true;
    try {
      rec.start();
      setListening(true);
    } catch {
      setError("Couldn't start the microphone — try again.");
      wantedRef.current = false;
    }
  }, []);

  useEffect(
    () => () => {
      wantedRef.current = false;
      recRef.current?.abort();
    },
    [],
  );

  return { supported, listening, error, start, stop };
}
