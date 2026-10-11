"use client";

import { useEffect } from "react";

/** Loads the design system's motion.js once, on the client, after hydration (it boots immediately). */
export function MotionLoader() {
  useEffect(() => {
    void import("../styles/motion.js");
  }, []);
  return null;
}
