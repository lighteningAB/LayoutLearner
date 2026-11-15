import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { getAuthOptions } from "@/lib/auth/options";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ nextauth: string[] }> };

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

async function handle(req: NextRequest, context: RouteContext): Promise<Response> {
  const options = getAuthOptions();
  // Feature off: answer without ever invoking next-auth.
  if (!options) return json(404, { error: "disabled" });
  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, { Allow: "GET, POST" });
  }
  return (await NextAuth(req, context, options)) as Response;
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as OPTIONS,
};
