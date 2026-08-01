"use client";

import {
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Video as VideoIcon,
  VideoOff,
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * The mock consultation room.
 *
 * With `VIDEO_DRIVER=mock` there is no media server, so this renders the real
 * call *shell* — local camera preview via `getUserMedia`, mute and camera
 * toggles, screen-share, elapsed timer, leave — around a placeholder remote
 * tile. Everything except the remote peer is genuine, which is what makes the
 * surrounding flow (join windows, permissions, waiting states, leaving) worth
 * testing offline.
 *
 * Swapping to a real driver replaces the remote tile with the provider's iframe
 * or track; none of the surrounding UI changes.
 */

type MediaState = "idle" | "requesting" | "live" | "denied" | "unavailable";

export function ConsultationRoom({
  roomName,
  peerName,
  role,
  startsAt,
}: {
  roomName: string;
  peerName: string;
  role: "doctor" | "patient";
  startsAt: string;
}) {
  const router = useRouter();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  const [mediaState, setMediaState] = React.useState<MediaState>("idle");
  const [micOn, setMicOn] = React.useState(true);
  const [cameraOn, setCameraOn] = React.useState(true);
  const [sharing, setSharing] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);

  // Elapsed time is derived from a mount timestamp rather than counting ticks,
  // so a throttled background tab does not drift.
  React.useEffect(() => {
    const joinedAt = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - joinedAt) / 1000));
    }, 1_000);
    return () => clearInterval(interval);
  }, []);

  const stopTracks = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Releasing the camera on unmount matters more than usual here: leaving the
  // hardware light on after a medical consultation is its own privacy problem.
  React.useEffect(() => stopTracks, [stopTracks]);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setMediaState("unavailable");
        return;
      }

      setMediaState("requesting");

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setMediaState("live");
      } catch {
        if (!cancelled) setMediaState("denied");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function toggleMic() {
    const next = !micOn;
    streamRef.current?.getAudioTracks().forEach((track) => (track.enabled = next));
    setMicOn(next);
  }

  function toggleCamera() {
    const next = !cameraOn;
    streamRef.current?.getVideoTracks().forEach((track) => (track.enabled = next));
    setCameraOn(next);
  }

  async function toggleShare() {
    if (sharing) {
      setSharing(false);
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      // Stop immediately: with no peer there is nowhere to send it. The button
      // still exercises the permission prompt and the track lifecycle.
      display.getTracks().forEach((track) => track.stop());
      setSharing(true);
      setTimeout(() => setSharing(false), 2_000);
    } catch {
      setSharing(false);
    }
  }

  function leave() {
    stopTracks();
    router.push("/appointments");
  }

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-slate-950 text-slate-50">
      <header className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-sm font-medium">
            {role === "patient" ? `Dr. ${peerName}` : peerName}
          </p>
          <p className="font-mono text-xs text-slate-400">{roomName}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-red-500" />
          <span className="tabular-nums" role="timer">
            {minutes}:{seconds.toString().padStart(2, "0")}
          </span>
        </div>
      </header>

      <div className="relative flex-1 p-4">
        <div className="grid h-full gap-4 lg:grid-cols-2">
          {/* Remote peer — a placeholder under the mock driver. */}
          <div className="relative flex min-h-64 items-center justify-center rounded-xl border border-white/10 bg-slate-900">
            <div className="space-y-3 text-center">
              <div className="mx-auto grid size-20 place-items-center rounded-full bg-slate-800 text-2xl font-semibold">
                {peerName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase() ?? "")
                  .join("")}
              </div>
              <p className="font-medium">{role === "patient" ? `Dr. ${peerName}` : peerName}</p>
              <p className="mx-auto max-w-xs text-sm text-slate-400">
                Waiting for them to join. This is a simulated room — set{" "}
                <code className="rounded bg-slate-800 px-1">VIDEO_DRIVER</code> to a real provider
                to connect live video.
              </p>
            </div>
          </div>

          {/* Local preview — genuinely live. */}
          <div className="relative min-h-64 overflow-hidden rounded-xl border border-white/10 bg-slate-900">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={cn(
                "size-full object-cover",
                // Mirroring matches what people expect of their own preview.
                "scale-x-[-1]",
                (!cameraOn || mediaState !== "live") && "invisible",
              )}
            />

            {mediaState !== "live" && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <p className="text-sm text-slate-400">
                  {mediaState === "requesting" && "Requesting camera and microphone…"}
                  {mediaState === "denied" &&
                    "Camera and microphone are blocked. Allow access in your browser settings, then reload."}
                  {mediaState === "unavailable" &&
                    "This browser does not expose camera access over an insecure origin."}
                  {mediaState === "idle" && "Starting camera…"}
                </p>
              </div>
            )}

            {mediaState === "live" && !cameraOn && (
              <div className="absolute inset-0 grid place-items-center">
                <p className="text-sm text-slate-400">Your camera is off</p>
              </div>
            )}

            <span className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-0.5 text-xs">
              You
            </span>
          </div>
        </div>
      </div>

      <footer className="flex items-center justify-center gap-3 border-t border-white/10 px-4 py-4">
        <Button
          variant={micOn ? "secondary" : "destructive"}
          size="icon"
          onClick={toggleMic}
          disabled={mediaState !== "live"}
          aria-pressed={!micOn}
          aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
        >
          {micOn ? <Mic aria-hidden /> : <MicOff aria-hidden />}
        </Button>

        <Button
          variant={cameraOn ? "secondary" : "destructive"}
          size="icon"
          onClick={toggleCamera}
          disabled={mediaState !== "live"}
          aria-pressed={!cameraOn}
          aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}
        >
          {cameraOn ? <VideoIcon aria-hidden /> : <VideoOff aria-hidden />}
        </Button>

        <Button
          variant={sharing ? "default" : "secondary"}
          size="icon"
          onClick={() => void toggleShare()}
          aria-label="Share your screen"
        >
          <MonitorUp aria-hidden />
        </Button>

        <Button variant="destructive" onClick={leave} className="ml-4">
          <PhoneOff aria-hidden />
          Leave
        </Button>
      </footer>

      <p className="sr-only" aria-live="polite">
        Consultation started at {new Date(startsAt).toLocaleTimeString("en-GB")}.
      </p>
    </div>
  );
}
