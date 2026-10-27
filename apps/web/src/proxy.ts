import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Only the routes that need a session; `/`, `/dev/*` and static files stay untouched.
  matcher: ["/app/:path*", "/sign-in"],
};
