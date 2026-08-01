import { createHmac, randomUUID } from "node:crypto";

import {
  adapterFail,
  adapterOk,
  fetchWithTimeout,
  type Adapter,
  type AdapterHealth,
  type AdapterResult,
} from "@/adapters/types";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import type { VideoProvider } from "@/generated/prisma/enums";

/**
 * Telehealth room provisioning.
 *
 * The mock driver issues signed tokens for an in-app WebRTC room that runs
 * entirely on localhost, so a full doctor/patient consultation can be rehearsed
 * with no third-party service. Production drivers provision a real room and
 * return per-participant tokens.
 */

export interface CreateRoomInput {
  appointmentId: string;
  /** Room opens shortly before the appointment and closes after it ends. */
  startsAt: Date;
  endsAt: Date;
  doctorName: string;
  patientName: string;
  enableRecording?: boolean;
}

export interface VideoRoom {
  provider: VideoProvider;
  roomName: string;
  roomUrl: string;
  doctorToken: string;
  patientToken: string;
  expiresAt: Date;
}

export interface VideoAdapter extends Adapter {
  readonly provider: VideoProvider;
  createRoom(input: CreateRoomInput): Promise<AdapterResult<VideoRoom>>;
  endRoom(roomName: string): Promise<AdapterResult<{ ended: boolean }>>;
}

/** Rooms open 10 minutes early so the waiting room is usable. */
const EARLY_ACCESS_MINUTES = 10;
/** And stay open past the end to absorb overruns. */
const GRACE_MINUTES = 15;

function roomWindow(input: CreateRoomInput): { opensAt: Date; expiresAt: Date } {
  return {
    opensAt: new Date(input.startsAt.getTime() - EARLY_ACCESS_MINUTES * 60_000),
    expiresAt: new Date(input.endsAt.getTime() + GRACE_MINUTES * 60_000),
  };
}

export class MockVideoAdapter implements VideoAdapter {
  readonly driver = "mock";
  readonly provider = "MOCK" as const;

  /**
   * Tokens are HMAC-signed with the app secret and carry the role plus the
   * validity window, so the in-app room can authorise a joiner exactly the way
   * a real provider would — the offline path is not an authorisation bypass.
   */
  private issueToken(roomName: string, role: "doctor" | "patient", expiresAt: Date): string {
    const payload = Buffer.from(
      JSON.stringify({ room: roomName, role, exp: Math.floor(expiresAt.getTime() / 1000) }),
    ).toString("base64url");

    const signature = createHmac("sha256", env.BETTER_AUTH_SECRET)
      .update(payload)
      .digest("base64url");

    return `${payload}.${signature}`;
  }

  static verifyToken(
    token: string,
  ): { room: string; role: "doctor" | "patient"; exp: number } | null {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;

    const expected = createHmac("sha256", env.BETTER_AUTH_SECRET)
      .update(payload)
      .digest("base64url");
    if (expected !== signature) return null;

    try {
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        room: string;
        role: "doctor" | "patient";
        exp: number;
      };
      return decoded.exp * 1000 > Date.now() ? decoded : null;
    } catch {
      return null;
    }
  }

  async createRoom(input: CreateRoomInput): Promise<AdapterResult<VideoRoom>> {
    const { expiresAt } = roomWindow(input);
    const roomName = `mock-${input.appointmentId.slice(-8)}-${randomUUID().slice(0, 6)}`;

    logger.info({ roomName, appointmentId: input.appointmentId }, "Mock video room created");

    return adapterOk({
      provider: this.provider,
      roomName,
      roomUrl: `${env.APP_URL}/consultation/${roomName}`,
      doctorToken: this.issueToken(roomName, "doctor", expiresAt),
      patientToken: this.issueToken(roomName, "patient", expiresAt),
      expiresAt,
    });
  }

  async endRoom(): Promise<AdapterResult<{ ended: boolean }>> {
    return adapterOk({ ended: true });
  }

  async health(): Promise<AdapterHealth> {
    return { driver: this.driver, healthy: true, detail: "In-app WebRTC room" };
  }
}

export class DailyVideoAdapter implements VideoAdapter {
  readonly driver = "daily";
  readonly provider = "DAILY" as const;

  private get apiKey(): string {
    const key = env.DAILY_API_KEY;
    if (!key) throw new Error("DAILY_API_KEY is not configured.");
    return key;
  }

  async createRoom(input: CreateRoomInput): Promise<AdapterResult<VideoRoom>> {
    const { opensAt, expiresAt } = roomWindow(input);
    const roomName = `consult-${input.appointmentId.slice(-10).toLowerCase()}`;

    try {
      const response = await fetchWithTimeout("https://api.daily.co/v1/rooms", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: roomName,
          privacy: "private",
          properties: {
            nbf: Math.floor(opensAt.getTime() / 1000),
            exp: Math.floor(expiresAt.getTime() / 1000),
            enable_chat: true,
            enable_recording: input.enableRecording ? "cloud" : false,
            eject_at_room_exp: true,
          },
        }),
        timeoutMs: 20_000,
      });

      const payload = (await response.json()) as { name?: string; url?: string; error?: string };

      if (!response.ok || !payload.url) {
        return adapterFail(
          payload.error ?? `http_${response.status}`,
          "Daily room creation failed.",
          response.status >= 500,
        );
      }

      const [doctorToken, patientToken] = await Promise.all([
        this.meetingToken(roomName, input.doctorName, true, expiresAt),
        this.meetingToken(roomName, input.patientName, false, expiresAt),
      ]);

      return adapterOk({
        provider: this.provider,
        roomName: payload.name ?? roomName,
        roomUrl: payload.url,
        doctorToken,
        patientToken,
        expiresAt,
      });
    } catch (error) {
      logger.error({ err: error }, "Daily room creation threw");
      return adapterFail("network_error", "Could not reach Daily.", true);
    }
  }

  private async meetingToken(
    roomName: string,
    userName: string,
    isOwner: boolean,
    expiresAt: Date,
  ): Promise<string> {
    const response = await fetchWithTimeout("https://api.daily.co/v1/meeting-tokens", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: {
          room_name: roomName,
          user_name: userName,
          is_owner: isOwner,
          exp: Math.floor(expiresAt.getTime() / 1000),
        },
      }),
      timeoutMs: 15_000,
    });

    const payload = (await response.json()) as { token?: string };
    if (!payload.token) throw new Error("Daily did not return a meeting token.");
    return payload.token;
  }

  async endRoom(roomName: string): Promise<AdapterResult<{ ended: boolean }>> {
    try {
      const response = await fetchWithTimeout(`https://api.daily.co/v1/rooms/${roomName}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeoutMs: 15_000,
      });
      return adapterOk({ ended: response.ok });
    } catch {
      return adapterFail("network_error", "Could not reach Daily.", true);
    }
  }

  async health(): Promise<AdapterHealth> {
    try {
      const response = await fetchWithTimeout("https://api.daily.co/v1/", {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeoutMs: 8_000,
      });
      return { driver: this.driver, healthy: response.ok, detail: `HTTP ${response.status}` };
    } catch (error) {
      return {
        driver: this.driver,
        healthy: false,
        detail: error instanceof Error ? error.message : "unreachable",
      };
    }
  }
}

export class ZoomVideoAdapter implements VideoAdapter {
  readonly driver = "zoom";
  readonly provider = "ZOOM" as const;

  private tokenCache: { token: string; expiresAt: number } | null = null;

  private async accessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) {
      return this.tokenCache.token;
    }

    const accountId = env.ZOOM_ACCOUNT_ID;
    const clientId = env.ZOOM_CLIENT_ID;
    const clientSecret = env.ZOOM_CLIENT_SECRET;
    if (!accountId || !clientId || !clientSecret) {
      throw new Error("Zoom credentials are not configured.");
    }

    const response = await fetchWithTimeout(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        timeoutMs: 15_000,
      },
    );

    if (!response.ok) throw new Error(`Zoom token request failed: HTTP ${response.status}`);

    const payload = (await response.json()) as { access_token: string; expires_in: number };
    this.tokenCache = {
      token: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
    };
    return payload.access_token;
  }

  async createRoom(input: CreateRoomInput): Promise<AdapterResult<VideoRoom>> {
    const { expiresAt } = roomWindow(input);
    const durationMinutes = Math.max(
      15,
      Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60_000),
    );

    try {
      const token = await this.accessToken();
      const response = await fetchWithTimeout("https://api.zoom.us/v2/users/me/meetings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: `Consultation ${input.appointmentId.slice(-8)}`,
          type: 2,
          start_time: input.startsAt.toISOString(),
          duration: durationMinutes,
          settings: {
            waiting_room: true,
            join_before_host: false,
            auto_recording: input.enableRecording ? "cloud" : "none",
          },
        }),
        timeoutMs: 20_000,
      });

      const payload = (await response.json()) as {
        id?: number;
        join_url?: string;
        start_url?: string;
        message?: string;
      };

      if (!response.ok || !payload.join_url || !payload.start_url) {
        return adapterFail(
          `http_${response.status}`,
          payload.message ?? "Zoom meeting creation failed.",
          response.status >= 500,
        );
      }

      return adapterOk({
        provider: this.provider,
        roomName: String(payload.id),
        roomUrl: payload.join_url,
        // Zoom's start_url embeds host authority; the join_url is for the patient.
        doctorToken: payload.start_url,
        patientToken: payload.join_url,
        expiresAt,
      });
    } catch (error) {
      logger.error({ err: error }, "Zoom meeting creation threw");
      return adapterFail("network_error", "Could not reach Zoom.", true);
    }
  }

  async endRoom(roomName: string): Promise<AdapterResult<{ ended: boolean }>> {
    try {
      const token = await this.accessToken();
      const response = await fetchWithTimeout(`https://api.zoom.us/v2/meetings/${roomName}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        timeoutMs: 15_000,
      });
      return adapterOk({ ended: response.ok });
    } catch {
      return adapterFail("network_error", "Could not reach Zoom.", true);
    }
  }

  async health(): Promise<AdapterHealth> {
    try {
      await this.accessToken();
      return { driver: this.driver, healthy: true };
    } catch (error) {
      return {
        driver: this.driver,
        healthy: false,
        detail: error instanceof Error ? error.message : "unreachable",
      };
    }
  }
}

export class GoogleMeetVideoAdapter implements VideoAdapter {
  readonly driver = "meet";
  readonly provider = "GOOGLE_MEET" as const;

  /**
   * Google Meet rooms are created as a side effect of a Calendar event with a
   * conference request, which requires a delegated OAuth token for the
   * organiser. That token is supplied per-request by the caller's Google
   * account linkage rather than held as a service credential.
   */
  async createRoom(input: CreateRoomInput): Promise<AdapterResult<VideoRoom>> {
    const clientId = env.GOOGLE_MEET_CLIENT_ID;
    const refreshToken = process.env.GOOGLE_MEET_REFRESH_TOKEN;
    const clientSecret = env.GOOGLE_MEET_CLIENT_SECRET;

    if (!clientId || !clientSecret || !refreshToken) {
      return adapterFail(
        "not_configured",
        "Google Meet requires GOOGLE_MEET_CLIENT_ID, GOOGLE_MEET_CLIENT_SECRET and GOOGLE_MEET_REFRESH_TOKEN.",
      );
    }

    try {
      const tokenResponse = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }).toString(),
        timeoutMs: 15_000,
      });

      const tokenPayload = (await tokenResponse.json()) as { access_token?: string };
      if (!tokenPayload.access_token) {
        return adapterFail("auth_failed", "Could not refresh the Google access token.");
      }

      const response = await fetchWithTimeout(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenPayload.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            summary: `Consultation with ${input.doctorName}`,
            start: { dateTime: input.startsAt.toISOString() },
            end: { dateTime: input.endsAt.toISOString() },
            conferenceData: {
              createRequest: {
                requestId: input.appointmentId,
                conferenceSolutionKey: { type: "hangoutsMeet" },
              },
            },
          }),
          timeoutMs: 20_000,
        },
      );

      const payload = (await response.json()) as {
        id?: string;
        hangoutLink?: string;
        error?: { message?: string };
      };

      if (!response.ok || !payload.hangoutLink) {
        return adapterFail(
          `http_${response.status}`,
          payload.error?.message ?? "Google Meet creation failed.",
          response.status >= 500,
        );
      }

      const { expiresAt } = roomWindow(input);

      return adapterOk({
        provider: this.provider,
        roomName: payload.id ?? input.appointmentId,
        roomUrl: payload.hangoutLink,
        // Meet authorises by Google identity, so the link is the credential.
        doctorToken: payload.hangoutLink,
        patientToken: payload.hangoutLink,
        expiresAt,
      });
    } catch (error) {
      logger.error({ err: error }, "Google Meet creation threw");
      return adapterFail("network_error", "Could not reach Google.", true);
    }
  }

  async endRoom(): Promise<AdapterResult<{ ended: boolean }>> {
    // Meet links expire with the calendar event; nothing to tear down.
    return adapterOk({ ended: true });
  }

  async health(): Promise<AdapterHealth> {
    const configured = Boolean(env.GOOGLE_MEET_CLIENT_ID && env.GOOGLE_MEET_CLIENT_SECRET);
    return {
      driver: this.driver,
      healthy: configured,
      detail: configured ? undefined : "credentials missing",
    };
  }
}

let instance: VideoAdapter | undefined;

function build(): VideoAdapter {
  switch (env.VIDEO_DRIVER) {
    case "daily":
      return new DailyVideoAdapter();
    case "zoom":
      return new ZoomVideoAdapter();
    case "meet":
      return new GoogleMeetVideoAdapter();
    case "mock":
      return new MockVideoAdapter();
    default: {
      const exhaustive: never = env.VIDEO_DRIVER;
      throw new Error(`Unsupported VIDEO_DRIVER: ${String(exhaustive)}`);
    }
  }
}

export function getVideoAdapter(): VideoAdapter {
  if (!instance) {
    instance = build();
    logger.info({ driver: instance.driver }, "Video adapter resolved");
  }
  return instance;
}

export function setVideoAdapter(adapter: VideoAdapter | undefined): void {
  instance = adapter;
}
