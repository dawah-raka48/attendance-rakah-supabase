import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { formatSaudiDateTime, saudiLocalDateTimeToUtcIso } from "./assets/time.js";

const SUPABASE_URL = "https://hsryrgmoyieqqyqubtly.supabase.co";
const SUPABASE_KEY = "sb_publishable_n1DoELV-OoMllDuSMOzuhw_Bkf5LM33";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);
const TZ = "Asia/Riyadh";
let currentUser = null;
let profile = null;
let data = { employees: [], logs: [], shifts: { morning: null, evening: null } };
let currentAttendance = [];
let reportRows = [];

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const shiftName = code => code === "morning" ? "صباحي" : "مسائي";
const active = employee => employee.active === true;
const timeMinutes = value => { const [h,m] = String(value || "00:00").slice(0,5).split(":").map(Number); return h * 60 + m; };
const todaySaudi = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
const nowSaudiMinutes = () => { const p = new Intl.DateTimeFormat("en-GB", {timeZone:TZ,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()); const v=Object.fromEntries(p.map(x=>[x.type,x.value])); return Number(v.hour)*60+Number(v.minute); };
function saudiRange(from, to) {
  const [fy,fm,fd] = from.split("-").map(Number);
  const [ty,tm,td] = to.split("-").map(Number);
  const start = saudiLocalDateTimeToUtcIso(fy,fm,fd,0,0,0);
  const endDate = new Date(Date.UTC(ty,tm-1,td+1));
  const end = saudiLocalDateTimeToUtcIso(endDate.getUTCFullYear(),endDate.getUTCMonth()+1,endDate.getUTCDate(),0,0,0);
  return { start, end };
}
function toast(message) { const el=$("toast"); el.textContent=message; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),3000); }
function showLogin(message="") { document.body.classList.remove("authenticated"); $("loginScreen").style.display=""; $("loginError").textContent=message; }
function showApp() { document.body.classList.add("authenticated"); $("loginScreen").style.display="none"; }

async function loadProfile(user) {
  const {data:row,error} = await supabase.from("profiles").select("full_name,role,active").eq("id",user.id).single();
  if (error || !row || !row.active) throw new Error("هذا الحساب غير مفعّل في صلاحيات المنصة.");
  profile=row; currentUser=user;
  $("sidebar").querySelector(".sidebar-foot").innerHTML='<span class="status-dot"></span> '+esc(row.role==="owner"?"مالك النظام":row.role==="admin"?"مدير النظام":row.role==="hr"?"الموارد البشرية":"مشاهدة فقط");
  $("loginScreen").style.display="none";
  showApp();
}

async function loadEmployees() {
  const {data:rows,error}=await supabase.from("employees").select("id,employee_code,full_name,department,device_user_id,active").order("employee_code");
  if(error) throw error;
  data.employees=rows||[];
}
async function loadShifts() {
  const {data:rows,error}=await supabase.from("shift_settings").select("shift_code,shift_name,start_time,end_time,grace_minutes,early_arrival_minutes,enabled");
  if(error) throw error;
  for(const row of rows||[]) data.shifts[row.shift_code]=row;
}
async function loadLogs(from,to) {
  const {start,end}=saudiRange(from,to);
  let all=[],offset=0,batch=1000;
  while(true){
    const {data:rows,error}=await supabase.from("device_logs")
      .select("id,device_user_id,punched_at,device_status,punch_type,device_name")
      .gte("punched_at",start).lt("punched_at",end)
      .order("punched_at",{ascending:true}).range(offset,offset+batch-1);
    if(error) throw error;
    all=all.concat(rows||[]);
    if(!rows||rows.length<batch) break;
    offset+=batch;
  }
  return all;
}
function employeeForDevice(deviceId) {
  return data.employees.find(e=>String(e.device_user_id??"")===String(deviceId) || String(e.employee_code)===String(deviceId));
}
function localParts(iso) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(iso));
  return Object.fromEntries(parts.map(p=>[p.type,p.value]));
}
function shiftForPunch(iso) {
  const p=localParts(iso), mins=Number(p.hour)*60+Number(p.minute);
  for(const code of ["morning","evening"]){
    const s=data.shifts[code]; if(!s||!s.enabled) continue;
    const start=timeMinutes(s.start_time), end=timeMinutes(s.end_time), early=Number(s.early_arrival_minutes??120);
    if(mins>=start-early && mins<=end) return code;
  }
  return null;
}
function buildSessions(logs) {
  const grouped=new Map();
  for(const log of logs){
    const employee=employeeForDevice(log.device_user_id);
    const shift=shiftForPunch(log.punched_at);
    if(!employee||!shift) continue;
    const p=localParts(log.punched_at), date=p.year+"-"+p.month+"-"+p.day, key=employee.id+"|"+date+"|"+shift;
    if(!grouped.has(key)) grouped.set(key,{employee,date,shift,first:log.punched_at,last:log.punched_at,count:0,lastAccepted:null});
    const g=grouped.get(key), stamp=new Date(log.punched_at).getTime();
    if(g.lastAccepted===null || stamp-g.lastAccepted>=5*60*1000){g.count++;g.lastAccepted=stamp;}
    if(stamp<new Date(g.first).getTime())g.first=log.punched_at;
    if(stamp>new Date(g.last).getTime())g.last=log.punched_at;
  }
  return [...grouped.values()].map(g=>{
    const s=data.shifts[g.shift], first=localParts(g.first), mins=Number(first.hour)*60+Number(first.minute);
    const start=timeMinutes(s.start_time), grace=Number(s.grace_minutes??5);
    const late=Math.max(0,mins-(start+grace));
    return {...g,firstLocal:first,lastLocal:localParts(g.last),lateMinutes:late,status:late>0?"متأخر":"في الموعد"};
  }).sort((a,b)=>(b.date+b.first).localeCompare(a.date+a.first));
}
function statusBadge(status){return status==="متأخر"?'<span class="status late">متأخر</span>':status==="حاضر"||status==="في الموعد"?'<span class="status ok">في الموعد</span>':'<span class="status neutral">'+esc(status||"—")+'</span>';}
function timeLabel(session){return session?new Intl.DateTimeFormat("ar-SA",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hour12:true}).format(new Date(session.first)): "—";}
function renderDashboard(sessions) {
  const today=todaySaudi(), todayRows=sessions.filter(x=>x.date===today), people=data.employees.filter(active);
  const morning=todayRows.filter(x=>x.shift==="morning"), evening=todayRows.filter(x=>x.shift==="evening");
  const presentIds=new Set(todayRows.map(x=>x.employee.id));
  $("totalEmployees").textContent=people.length;
  $("presentCount").textContent=presentIds.size;
  $("lateCount").textContent=todayRows.filter(x=>x.lateMinutes>0).length;
  const now=nowSaudiMinutes();
  const absent=new Set();
  for(const e of people){
    for(const code of ["morning","evening"]){
      const s=data.shifts[code]; if(!s||!s.enabled||now<=timeMinutes(s.end_time))continue;
      if(!todayRows.some(x=>x.employee.id===e.id&&x.shift===code)) absent.add(e.id+"|"+code);
    }
  }
  $("absentCount").textContent=absent.size;
  $("morningCount").innerHTML=morning.length+' <small>حضور</small>';
  $("eveningCount").innerHTML=evening.length+' <small>حضور</small>';
  const rate=people.length?Math.round(presentIds.size/people.length*100):0;
  $("attendanceRate").textContent=rate+"%";
  $("attendanceDonut").style.background='conic-gradient(var(--green) '+rate*3.6+'deg,#e9edf3 0deg)';
  $("recentRows").innerHTML=todayRows.slice(0,8).map(x=>'<tr><td class="person-cell">'+esc(x.employee.full_name)+'</td><td>'+esc(x.employee.employee_code)+'</td><td>'+shiftName(x.shift)+'</td><td>'+timeLabel(x)+'</td><td>'+statusBadge(x.status)+'</td></tr>').join("")||'<tr><td colspan="5">لا توجد حركات حضور لهذا اليوم.</td></tr>';
}
function renderEmployees(){
  const q=$("employeeSearch").value.trim().toLowerCase(),dep=$("departmentFilter").value;
  const rows=data.employees.filter(e=>(!q||(e.full_name+" "+e.employee_code+" "+(e.device_user_id||"")).toLowerCase().includes(q))&&(!dep||e.department===dep));
  $("employeeRows").innerHTML=rows.map(e=>'<tr><td>'+esc(e.employee_code)+'</td><td class="person-cell">'+esc(e.full_name)+'</td><td>'+esc(e.department)+'</td><td>'+esc(e.device_user_id||"—")+'</td><td>'+(e.active?'<span class="status ok">نشط</span>':'<span class="status neutral">موقوف</span>')+'</td><td>'+(["owner","admin","hr"].includes(profile?.role)?'<button class="text-btn" data-edit="'+esc(e.id)+'">تعديل</button> <button class="text-btn" data-deactivate="'+esc(e.id)+'">إيقاف</button>':"—")+'</td></tr>').join("")||'<tr><td colspan="6">لا يوجد موظفون.</td></tr>';
}
function renderAttendance(sessions){
  const date=$("attendanceDate").value,shift=$("shiftFilter").value,q=$("attendanceSearch").value.trim().toLowerCase();
  const rows=sessions.filter(x=>(!date||x.date===date)&&(!shift||x.shift===shift)&&(!q||(x.employee.full_name+" "+x.employee.employee_code).toLowerCase().includes(q)));
  $("attendanceRows").innerHTML=rows.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.employee.full_name)+'</td><td>'+shiftName(x.shift)+'</td><td>'+timeLabel(x)+'</td><td>'+statusBadge(x.status)+'</td><td>'+x.lateMinutes+' دقيقة</td><td><span class="status neutral">جهاز البصمة</span></td></tr>').join("")||'<tr><td colspan="7">لا توجد سجلات في الفترة المحددة.</td></tr>';
}
function filteredReport(){
  const from=$("fromDate").value,to=$("toDate").value,shift=$("reportShift").value,dep=$("reportDepartment").value;
  return reportRows.filter(x=>(!from||x.date>=from)&&(!to||x.date<=to)&&(!shift||x.shift===shift)&&(!dep||x.employee.department===dep));
}
function renderReport(){
  const rows=filteredReport();
  $("reportSummary").textContent="عدد جلسات الحضور: "+rows.length+" | حالات التأخير: "+rows.filter(x=>x.lateMinutes>0).length+" | الموظفون: "+new Set(rows.map(x=>x.employee.id)).size;
  $("reportRows").innerHTML=rows.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.employee.full_name)+'</td><td>'+esc(x.employee.department)+'</td><td>'+shiftName(x.shift)+'</td><td>'+timeLabel(x)+'</td><td>'+statusBadge(x.status)+'</td><td>'+x.lateMinutes+' دقيقة</td></tr>').join("")||'<tr><td colspan="7">لا توجد نتائج للفترة المحددة.</td></tr>';
}
function fillDepartments(){
  const deps=[...new Set(data.employees.map(e=>e.department).filter(Boolean))];
  ["departmentFilter","reportDepartment"].forEach(id=>{const el=$(id),old=el.value;el.innerHTML='<option value="">كل الأقسام</option>'+deps.map(d=>'<option value="'+esc(d)+'">'+esc(d)+'</option>').join("");el.value=old;});
}
async function refreshBase(){
  await Promise.all([loadEmployees(),loadShifts()]);
  fillDepartments();
  const today=todaySaudi(), logs=await loadLogs(today,today);
  const sessions=buildSessions(logs);
  renderDashboard(sessions); currentAttendance=sessions;
  renderAttendance(sessions);
  loadSettingsForm();
}
async function refreshAttendanceDate(){
  const date=$("attendanceDate").value||todaySaudi();
  const logs=await loadLogs(date,date);
  currentAttendance=buildSessions(logs);
  renderAttendance(currentAttendance);
}
async function refreshReport(){
  const from=$("fromDate").value||todaySaudi(),to=$("toDate").value||from;
  const logs=await loadLogs(from,to);
  reportRows=buildSessions(logs);
  renderReport();
}
function loadSettingsForm(){
  for(const code of ["morning","evening"]){
    const s=data.shifts[code]; if(!s)continue;
    $(code+"Start").value=String(s.start_time).slice(0,5);
    $(code+"End").value=String(s.end_time).slice(0,5);
    $(code+"Grace").value=s.grace_minutes;
  }
}
async function saveEmployee(form){
  const values=Object.fromEntries(new FormData(form).entries());
  const payload={employee_code:values.code.trim(),full_name:values.name.trim(),department:values.department.trim(),device_user_id:values.deviceId.trim()||null,active:true};
  const editingId=form.dataset.editId;
  const query=editingId?supabase.from("employees").update(payload).eq("id",editingId):supabase.from("employees").insert(payload);
  const {error}=await query;
  if(error)throw error;
}
function openEmployeeModal(employee=null){
  $("employeeForm").reset();$("employeeForm").dataset.editId=employee?.id||"";
  $("modalTitle").textContent=employee?"تعديل بيانات موظف":"إضافة موظف";
  if(employee){$("employeeForm").elements.code.value=employee.employee_code;$("employeeForm").elements.name.value=employee.full_name;$("employeeForm").elements.department.value=employee.department;$("employeeForm").elements.deviceId.value=employee.device_user_id||"";}
  $("modalBackdrop").classList.add("show");
}
function tick(){
  const now=new Date();
  $("clock").textContent=new Intl.DateTimeFormat("ar-SA",{timeZone:TZ,hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true}).format(now);
  $("todayLabel").textContent=new Intl.DateTimeFormat("ar-SA",{timeZone:TZ,weekday:"long",year:"numeric",month:"long",day:"numeric"}).format(now);
}
async function startApp(){
  await refreshBase();
  $("attendanceDate").value=todaySaudi();
  const last=new Date(Date.now()-6*86400000);
  $("fromDate").value=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(last);
  $("toDate").value=todaySaudi();
  $("reportDepartment").value="";
}

$("loginForm").addEventListener("submit",async event=>{
  event.preventDefault();$("loginSubmit").disabled=true;$("loginError").textContent="جارٍ التحقق من بيانات الدخول…";
  const {data:authData,error}=await supabase.auth.signInWithPassword({email:$("loginEmail").value.trim(),password:$("loginPassword").value});
  if(error){$("loginError").textContent="تعذر تسجيل الدخول. تأكد من البريد وكلمة المرور."; $("loginSubmit").disabled=false;return;}
  try{await loadProfile(authData.user);await startApp();$("loginError").textContent="";}
  catch(err){await supabase.auth.signOut();showLogin(err.message||"تعذر تحميل بيانات المنصة.");}
  $("loginSubmit").disabled=false;
});
$("logoutBtn")?.addEventListener("click",async()=>{await supabase.auth.signOut();profile=null;currentUser=null;showLogin();});
$("employeeForm").addEventListener("submit",async event=>{event.preventDefault();try{await saveEmployee(event.currentTarget);$("modalBackdrop").classList.remove("show");await loadEmployees();renderEmployees();toast("تم حفظ بيانات الموظف");}catch(e){toast("تعذر الحفظ: "+e.message);}});
$("employeeRows").addEventListener("click",async event=>{
  const id=event.target.dataset.edit||event.target.dataset.deactivate;if(!id)return;
  const employee=data.employees.find(e=>e.id===id);if(!employee)return;
  if(event.target.dataset.edit){openEmployeeModal(employee);return;}
  if(confirm("هل تريد إيقاف الموظف "+employee.full_name+"؟")){
    const {error}=await supabase.from("employees").update({active:false}).eq("id",id);
    if(error)toast("تعذر إيقاف الموظف: "+error.message);else{await loadEmployees();renderEmployees();toast("تم إيقاف الموظف");}
  }
});
$("saveSettings").addEventListener("click",async()=>{
  if(!["owner","admin"].includes(profile?.role)){toast("ليس لديك صلاحية تعديل إعدادات الدوام");return;}
  for(const code of ["morning","evening"]){
    const {error}=await supabase.from("shift_settings").update({start_time:$(code+"Start").value,end_time:$(code+"End").value,grace_minutes:Number($(code+"Grace").value),updated_at:new Date().toISOString()}).eq("shift_code",code);
    if(error){toast("تعذر حفظ الإعدادات: "+error.message);return;}
  }
  await loadShifts();loadSettingsForm();toast("تم حفظ إعدادات الدوام");
});
$("addPunchBtn").addEventListener("click",()=>toast("إضافة البصمات اليدوية غير مفعّلة؛ سجلات الجهاز الأصلية محفوظة دون تعديل."));
$("addEmployeeBtn").addEventListener("click",()=>openEmployeeModal());
$("closeModal").addEventListener("click",()=>$("modalBackdrop").classList.remove("show"));
$("cancelModal").addEventListener("click",()=>$("modalBackdrop").classList.remove("show"));
$("menuBtn").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
$("themeBtn").addEventListener("click",()=>{document.body.classList.toggle("dark");localStorage.setItem("attendance-theme",document.body.classList.contains("dark")?"dark":"light");});
if(localStorage.getItem("attendance-theme")==="dark")document.body.classList.add("dark");
document.querySelectorAll(".nav-link").forEach(button=>button.addEventListener("click",async()=>{
  document.querySelectorAll(".nav-link").forEach(x=>x.classList.remove("active"));button.classList.add("active");
  document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));$("view-"+button.dataset.view).classList.add("active");
  $("pageTitle").textContent=button.textContent.trim();$("sidebar").classList.remove("open");
  try{if(button.dataset.view==="attendance")await refreshAttendanceDate();if(button.dataset.view==="reports")await refreshReport();if(button.dataset.view==="employees")renderEmployees();}catch(e){toast("تعذر تحميل البيانات: "+e.message);}
}));
document.querySelectorAll("[data-go]").forEach(button=>button.addEventListener("click",()=>document.querySelector('[data-view="'+button.dataset.go+'"]').click()));
["employeeSearch","departmentFilter"].forEach(id=>$(id).addEventListener("input",renderEmployees));
["attendanceDate","shiftFilter","attendanceSearch"].forEach(id=>$(id).addEventListener("change",()=>refreshAttendanceDate().catch(e=>toast(e.message))));
$("runReport").addEventListener("click",()=>refreshReport().catch(e=>toast(e.message)));
$("exportBtn").addEventListener("click",()=>{
  const rows=[["التاريخ","الموظف","القسم","الفترة","أول بصمة","آخر بصمة","الحالة","التأخير بالدقائق"],...filteredReport().map(x=>[x.date,x.employee.full_name,x.employee.department,shiftName(x.shift),timeLabel(x),new Intl.DateTimeFormat("ar-SA",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hour12:true}).format(new Date(x.last)),x.status,x.lateMinutes])];
  const csv="\uFEFF"+rows.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\n");
  const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));link.download="attendance-report.csv";link.click();URL.revokeObjectURL(link.href);
});
$("attendanceDate").value=todaySaudi();
tick();setInterval(tick,1000);
supabase.auth.getSession().then(async({data:sessionData})=>{
  if(!sessionData.session)return;
  try{await loadProfile(sessionData.session.user);await startApp();}
  catch(e){await supabase.auth.signOut();showLogin(e.message||"انتهت الجلسة، سجّل الدخول مجددًا.");}
});
