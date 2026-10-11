import type { NextRequest } from "next/server";
import { confirm } from "@/lib/auth-confirm";

export function GET(request: NextRequest) {
  return confirm("admin", request);
}
