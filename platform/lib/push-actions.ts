"use server";

import { requireStaff } from "@/lib/staff";

// Server actions behind app/components/PushToggle.tsx. They act as the signed-in staff user (aal2); the RPCs check
// is_staff() again (migration 011). No service role here.

type Result = { ok: true } | { ok: false; message: string };

/** The VAPID public key (not a secret), passed to PushManager.subscribe. Empty when push is not configured. */
export async function pushPublicKey(): Promise<string> {
  await requireStaff();
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string): Promise<Result> {
  const { supabase } = await requireStaff();
  if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://") || typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string") {
    return { ok: false, message: "This browser returned an unusable subscription." };
  }
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: sub.endpoint,
    p_keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    p_user_agent: String(userAgent || "").slice(0, 300),
  });
  return error ? { ok: false, message: "Couldn't save this device. Try again." } : { ok: true };
}

export async function deletePushSubscription(endpoint: string): Promise<Result> {
  const { supabase } = await requireStaff();
  const { error } = await supabase.rpc("delete_push_subscription", { p_endpoint: String(endpoint || "") });
  return error ? { ok: false, message: "Couldn't remove this device. Try again." } : { ok: true };
}

export async function sendTestPush(): Promise<Result> {
  const { supabase } = await requireStaff();
  const { error } = await supabase.rpc("queue_test_push");
  return error ? { ok: false, message: "Couldn't queue a test. Try again." } : { ok: true };
}
