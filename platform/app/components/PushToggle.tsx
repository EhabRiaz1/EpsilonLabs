"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { eps } from "./eps";
import { deletePushSubscription, pushPublicKey, savePushSubscription, sendTestPush } from "@/lib/push-actions";

type State = "checking" | "unsupported" | "install" | "blocked" | "off" | "on" | "unconfigured";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function standalone(): boolean {
  return matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

/** Settings: "Turn on notifications" for this device (E5). Push is best-effort; urgent items are also emailed. */
export function PushToggle() {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      let next: State;
      if (!supported) next = isIos() && !standalone() ? "install" : "unsupported";
      else if (Notification.permission === "denied") next = "blocked";
      else {
        const reg = await registration().catch(() => null);
        const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
        next = sub && Notification.permission === "granted" ? "on" : "off";
      }
      if (live) setState(next);
    })();
    return () => {
      live = false;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    setMsg("");
    try {
      const key = await pushPublicKey();
      if (!key) {
        setState("unconfigured");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await savePushSubscription(
        { endpoint: json.endpoint ?? "", keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } },
        navigator.userAgent,
      );
      if (!res.ok) {
        await sub.unsubscribe().catch(() => undefined);
        setMsg(res.message);
        return;
      }
      setState("on");
      eps()?.toast("Notifications on for this device", { icon: "bell" });
    } catch {
      setMsg("This browser refused the subscription. Try again, or use another browser.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMsg("");
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const res = await deletePushSubscription(sub.endpoint);
        await sub.unsubscribe();
        if (!res.ok) setMsg(res.message);
      }
      setState("off");
    } catch {
      setMsg("Couldn't turn notifications off. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg("");
    const res = await sendTestPush().catch(() => ({ ok: false as const, message: "Couldn't queue a test. Try again." }));
    setBusy(false);
    if (res.ok) eps()?.toast("Test queued · arrives within a minute while the Mac is online", { icon: "bell" });
    else setMsg(res.message);
  }

  const note: Record<State, string> = {
    checking: "Checking this device…",
    unsupported: "This browser can't receive push notifications. Urgent items are still emailed to you.",
    install: "On iPhone, push works only from the installed app: tap Share, then Add to Home Screen, open Epsilon from there and turn notifications on.",
    blocked: "Notifications are blocked for this site. Allow them in the browser's site settings, then reload.",
    off: "Get a notification for interested replies, new drafts, intake, tickets, proposals, payments and agent errors. Urgent ones are also emailed.",
    on: "This device gets notifications. Titles only: no client words ever leave in a notification.",
    unconfigured: "Push isn't configured on the server yet (VAPID keys). Urgent items are still emailed.",
  };

  return (
    <div className="push-toggle stack g-10">
      <div className="row wrap g-10">
        <span className={`pill ${state === "on" ? "pill-good" : state === "blocked" ? "pill-bad" : "pill-white"}`}>
          <span className="dot" />
          {state === "on" ? "On for this device" : state === "checking" ? "Checking" : "Off"}
        </span>
        {state === "off" && (
          <button className="btn btn-primary" type="button" onClick={turnOn} disabled={busy}>
            <Icon name="bell" />
            Turn on notifications
          </button>
        )}
        {state === "on" && (
          <>
            <button className="btn btn-secondary" type="button" onClick={test} disabled={busy}>
              Send a test
            </button>
            <button className="btn btn-ghost" type="button" onClick={turnOff} disabled={busy}>
              Turn off
            </button>
          </>
        )}
      </div>
      <p className="c-3 t-12 push-hint">
        {note[state]}
      </p>
      {msg && (
        <p className="c-bad t-12 m-0" role="alert">
          {msg}
        </p>
      )}
    </div>
  );
}
