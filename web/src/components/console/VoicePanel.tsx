"use client";

import { useState } from "react";
import { useConversationControls, useConversationMode, useConversationStatus } from "@elevenlabs/react";

export type TranscriptLine = { id: string; speaker: "you" | "leash"; text: string };

type Props = {
  transcript: TranscriptLine[];
  onError: (message: string) => void;
};

async function fetchConversationToken(): Promise<string> {
  const res = await fetch("/api/conversation-token", { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !body.token) throw new Error(body.error ?? "Could not start a voice session.");
  return body.token;
}

/** Start/stop button, live state, and the running transcript. */
export function VoicePanel({ transcript, onError }: Props) {
  const { startSession, endSession } = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const [isStarting, setIsStarting] = useState(false);

  const isLive = status === "connected";
  const isBusy = isStarting || status === "connecting";
  const stateLabel = isLive ? (isSpeaking ? "Leash is speaking" : "Listening") : isBusy ? "Connecting…" : "Off";

  async function handleToggle() {
    if (isLive) {
      endSession();
      return;
    }
    setIsStarting(true);
    try {
      // Token first, so a server misconfiguration shows up before the mic prompt.
      const conversationToken = await fetchConversationToken();
      await navigator.mediaDevices.getUserMedia({ audio: true });
      startSession({ conversationToken });
    } catch (err) {
      const isMicDenied = err instanceof DOMException && err.name === "NotAllowedError";
      onError(
        isMicDenied
          ? "Microphone access was blocked. Allow the mic for this site and try again."
          : err instanceof Error
            ? err.message
            : "Could not start the voice session.",
      );
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <section aria-labelledby="voice-heading" className="flex flex-col items-center gap-6">
      <h2 id="voice-heading" className="sr-only">
        Voice
      </h2>
      <div className="relative grid size-44 place-items-center">
        {isLive && (
          <span
            aria-hidden
            className={`voice-ring absolute inset-0 rounded-full ${isSpeaking ? "bg-tension/40" : "bg-auto/30"}`}
          />
        )}
        <button
          type="button"
          onClick={handleToggle}
          disabled={isBusy}
          aria-pressed={isLive}
          className="relative grid size-40 place-items-center rounded-full bg-ink text-paper shadow-[0_18px_40px_-12px_oklch(19%_0.012_70/0.55)] transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-60 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-tension"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          <span className="flex flex-col items-center gap-1">
            <span className="text-lg font-semibold">{isLive ? "End" : "Talk to Leash"}</span>
            <span className="text-xs uppercase tracking-[0.2em] text-paper/60">{isLive ? "tap to stop" : "mic"}</span>
          </span>
        </button>
      </div>
      <p className="text-sm font-medium text-ink-soft" aria-live="polite">
        {stateLabel}
      </p>

      <ol className="flex w-full max-w-md flex-col gap-2" aria-label="Transcript" aria-live="polite">
        {transcript.slice(-6).map((line) => (
          <li key={line.id} className={line.speaker === "you" ? "self-end text-right" : "self-start"}>
            <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-ink-soft">
              {line.speaker === "you" ? "You" : "Leash"}
            </span>
            <span
              className={`mt-0.5 inline-block rounded-lg px-3 py-2 text-sm ${
                line.speaker === "you" ? "bg-ink text-paper" : "bg-paper-raised"
              }`}
            >
              {line.text}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
