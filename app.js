import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { formatSaudiDateTime, saudiLocalDateTimeToUtcIso } from "./assets/time.js";

const SUPABASE_URL = "https://hsryrgmoyieqqyqubtly.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_n1DoELV-OoMllDuSMOzuhw_Bkf5LM33";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const byId = (id) => document.getElementById(id);
const setMessage = (id, message) => { byId(id).textContent = message || ""; };

function saudiDayRange() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const start = saudiLocalDateTimeToUtcIso(
    Number(values.year), Number(values.month), Number(values.day), 0, 0, 0
  );
  const end = new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

function showLogin() {
  byId("login-panel").hidden = false;
  byId("dashboard").hidden = true;
}

function showDashboard() {
  byId("login-panel").hidden = true;
  byId("dashboard").hidden = false;
}

async function loadDashboard(user) {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, role, active")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || !profile.active) {
    await supabase.auth.signOut();
    throw new Error("الحساب غير مفعّل في صلاحيات النظام. تواصل مع مدير النظام.");
  }

  showDashboard();
  byId("welcome-title").textContent = "مرحبًا، " + (profile.full_name || user.email);

  const { start, end } = saudiDayRange();
  const results = await Promise.all([
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("device_logs").select("id", { count: "exact", head: true }),
    supabase.from("device_logs").select("id", { count: "exact", head: true })
      .gte("punched_at", start).lt("punched_at", end),
    supabase.from("attendance_sessions").select("id", { count: "exact", head: true })
  ]);

  const failed = results.find((result) => result.error);
  if (failed) throw new Error("تعذر تحميل الإحصائيات. تحقق من صلاحيات الحساب وقاعدة البيانات.");

  byId("employees-count").textContent = results[0].count ?? 0;
  byId("logs-count").textContent = results[1].count ?? 0;
  byId("today-count").textContent = results[2].count ?? 0;
  byId("sessions-count").textContent = results[3].count ?? 0;

  const { data: logs, error: logsError } = await supabase
    .from("device_logs")
    .select("device_user_id, punched_at")
    .order("punched_at", { ascending: false })
    .limit(15);

  if (logsError) throw new Error("تعذر تحميل آخر حركات البصمة.");
  const body = byId("recent-logs");
  body.replaceChildren();

  for (const log of (logs || [])) {
    const row = document.createElement("tr");
    const employeeCell = document.createElement("td");
    const timeCell = document.createElement("td");
    employeeCell.textContent = log.device_user_id ?? "—";
    timeCell.textContent = formatSaudiDateTime(log.punched_at);
    row.append(employeeCell, timeCell);
    body.append(row);
  }

  if (!logs || logs.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 2;
    cell.textContent = "لا توجد حركات بصمة مسجلة.";
    row.append(cell);
    body.append(row);
  }
}

byId("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("login-message", "جارٍ التحقق من بيانات الدخول…");
  const email = byId("email").value.trim();
  const password = byId("password").value;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    setMessage("login-message", "تعذر تسجيل الدخول. راجع البريد وكلمة المرور.");
    return;
  }

  setMessage("login-message", "");
  try {
    await loadDashboard(data.user);
  } catch (problem) {
    await supabase.auth.signOut();
    showLogin();
    setMessage("login-message", problem.message || "حدث خطأ أثناء تحميل لوحة التحكم.");
  }
});

byId("logout-button").addEventListener("click", async () => {
  await supabase.auth.signOut();
  showLogin();
  byId("password").value = "";
});

const dateLabel = new Intl.DateTimeFormat("ar-SA", {
  timeZone: "Asia/Riyadh", weekday: "long", year: "numeric", month: "long", day: "numeric"
});
byId("current-date").textContent = dateLabel.format(new Date());

const { data: sessionData } = await supabase.auth.getSession();
if (sessionData.session) {
  try {
    await loadDashboard(sessionData.session.user);
  } catch (problem) {
    await supabase.auth.signOut();
    showLogin();
    setMessage("login-message", problem.message || "تعذر استعادة جلسة الدخول.");
  }
}
