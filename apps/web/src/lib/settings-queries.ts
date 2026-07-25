import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CapabilitiesSchema,
  NotificationPrefSchema,
  ProjectionSettingsSchema,
  SessionInfoSchema,
  UserSchema,
  type UpsertNotificationPref,
  type UpdateProjectionSettings,
} from "@compass/shared";
import { apiGet, apiPost } from "./api.ts";

const OkSchema = z.object({ ok: z.boolean() });

async function send<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "Failed");
  return schema.parse(await res.json());
}

export function useProfileMutations() {
  const qc = useQueryClient();
  const updateProfile = useMutation({
    mutationFn: (displayName: string) => send("PATCH", "/api/auth/profile", UserSchema, { displayName }),
    // Seed the cache with the user the server echoed back before revalidating.
    // Invalidating alone leaves the stale name in place until the refetch lands, so
    // the input — which re-adopts the stored name once saved — would visibly flash
    // the old value, or keep showing it for good if that refetch failed.
    onSuccess: (user) => {
      qc.setQueryData(["me"], user);
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const changePassword = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      apiPost("/api/auth/password", OkSchema, body),
  });
  return { updateProfile, changePassword };
}

export function useSessions() {
  return useQuery({ queryKey: ["sessions"], queryFn: () => apiGet("/api/auth/sessions", z.array(SessionInfoSchema)) });
}

export function useSessionRevoke() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => send("DELETE", `/api/auth/sessions/${id}`, OkSchema),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

export function useCapabilities() {
  return useQuery({ queryKey: ["capabilities"], queryFn: () => apiGet("/api/capabilities", CapabilitiesSchema) });
}

export function useProjectionSettings() {
  return useQuery({
    queryKey: ["projection-settings"],
    queryFn: () => apiGet("/api/projection-settings", ProjectionSettingsSchema),
  });
}

export function useProjectionSettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProjectionSettings) =>
      send("PUT", "/api/projection-settings", ProjectionSettingsSchema, body),
    onSuccess: (settings) => {
      qc.setQueryData(["projection-settings"], settings);
      void qc.invalidateQueries({ queryKey: ["goal-progress"] });
    },
  });
}

export function useNotificationPrefs() {
  return useQuery({
    queryKey: ["notification-prefs"],
    queryFn: () => apiGet("/api/notification-prefs", z.array(NotificationPrefSchema)),
  });
}

export function usePrefMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertNotificationPref) => apiPost("/api/notification-prefs", NotificationPrefSchema, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notification-prefs"] }),
  });
}
