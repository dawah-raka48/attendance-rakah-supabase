import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const expectedKey = Deno.env.get("DEVICE_SYNC_KEY");
  if (!expectedKey) return reply(503, { error: "device_sync_not_configured" });
  const suppliedKey = req.headers.get("x-device-sync-key") || "";
  const a = new TextEncoder().encode(suppliedKey);
  const b = new TextEncoder().encode(expectedKey);
  if (a.length !== b.length) return reply(401, { error: "unauthorized" });
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return reply(401, { error: "unauthorized" });

  let body: unknown;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  const records = (body as { records?: unknown })?.records;
  if (!Array.isArray(records) || records.length === 0) return reply(400, { error: "records_required" });
  if (records.length > 500) return reply(413, { error: "batch_limit_500" });

  const rows = [];
  for (const item of records) {
    if (!item || typeof item !== "object") return reply(400, { error: "invalid_record" });
    const r = item as Record<string, unknown>;
    const eventHash = String(r.event_hash ?? r.eventId ?? "").trim();
    const deviceUserId = String(r.device_user_id ?? r.deviceUserId ?? "").trim();
    const punchedAt = String(r.punched_at ?? r.timestamp ?? "").trim();
    if (!eventHash || !deviceUserId || !punchedAt || !Number.isFinite(Date.parse(punchedAt))) return reply(400, { error: "record_missing_required_fields" });
    const asInt = (v: unknown) => v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null;
    rows.push({
      event_hash: eventHash,
      device_user_id: deviceUserId,
      device_uid: r.device_uid == null ? null : String(r.device_uid),
      device_name: r.device_name == null ? null : String(r.device_name),
      punched_at: new Date(punchedAt).toISOString(),
      device_status: asInt(r.device_status ?? r.status),
      punch_type: asInt(r.punch_type ?? r.punch),
      raw_payload: r.raw_payload && typeof r.raw_payload === "object" ? r.raw_payload : r,
    });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(503, { error: "server_configuration_missing" });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.from("device_logs")
    .upsert(rows, { onConflict: "event_hash", ignoreDuplicates: true }).select("id");
  if (error) return reply(500, { error: "database_insert_failed", detail: error.message });
  return reply(200, { received: rows.length, inserted: data?.length ?? 0, duplicates: rows.length - (data?.length ?? 0) });
});