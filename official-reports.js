export function initOfficialReports(ctx) {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const TZ = "Asia/Riyadh";
  const roleCanManage = () => ["owner","admin","hr"].includes(ctx.getProfile()?.role);
  const shiftName = code => code === "morning" ? "صباحي" : "مسائي";
  const clock = iso => iso ? new Intl.DateTimeFormat("ar-SA",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hour12:true}).format(new Date(iso)) : "—";
  const toast = msg => { const el=$("toast"); if(el){el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),3000);} };
  function statusLabel(s){return s==="approved"?"معتمد":s==="rejected"?"معاد للمراجعة":"بانتظار المراجعة";}
  function fillEmployees(){
    const el=$("officialEmployee"),old=el.value;
    el.innerHTML='<option value="">اختر الموظف</option>'+ctx.getEmployees().filter(e=>e.active).map(e=>'<option value="'+esc(e.id)+'">'+esc(e.full_name)+' — '+esc(e.employee_code)+'</option>').join("");
    el.value=old;
  }
  async function loadList(){
    const {data:rows,error}=await ctx.supabase.from("employee_accountability_reports")
      .select("id,employee_name,employee_code,department,period_start,period_end,status,summary,created_at")
      .order("created_at",{ascending:false}).limit(30);
    if(error){$("officialReportList").innerHTML='<p class="muted">تعذر تحميل التقارير: '+esc(error.message)+'</p>';return;}
    $("officialReportList").innerHTML=rows?.length?'<table><thead><tr><th>الموظف</th><th>الفترة</th><th>التأخير</th><th>غياب للمراجعة</th><th>الحالة</th><th>فتح</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+esc(x.employee_name)+' ('+esc(x.employee_code)+')</td><td>'+esc(x.period_start)+' — '+esc(x.period_end)+'</td><td>'+Number(x.summary?.lateCount||0)+'</td><td>'+Number(x.summary?.absenceCount||0)+'</td><td>'+statusLabel(x.status)+'</td><td><button class="text-btn" data-open-report="'+esc(x.id)+'">عرض التقرير</button></td></tr>').join("")+'</tbody></table>':'<p class="muted">لا توجد تقارير محفوظة بعد.</p>';
  }
  function makeReport(){
    const employee=ctx.getEmployees().find(e=>e.id===$("officialEmployee").value);
    if(!employee)throw new Error("اختر الموظف أولًا.");
    const from=$("fromDate").value||ctx.today(),to=$("toDate").value||from;
    if(to<from)throw new Error("تاريخ نهاية الفترة يجب أن يكون بعد تاريخ البداية.");
    const sessions=ctx.getReportRows().filter(x=>x.employee.id===employee.id&&x.date>=from&&x.date<=to);
    const details=sessions.map(x=>({date:x.date,shift:x.shift,shiftName:shiftName(x.shift),type:"attendance",firstPunch:clock(x.first),exitAt:clock(x.exitAt),lateMinutes:x.lateMinutes,earlyDeparture:x.earlyDeparture,lateDeparture:x.lateDeparture,status:x.status,punchCount:x.punchCount}));
    const now=Date.now(),start=new Date(from+"T12:00:00Z"),end=new Date(to+"T12:00:00Z");
    // Sunday–Thursday workweek; missing attendance is explicitly flagged for review, not treated as a confirmed violation.
    for(let d=new Date(start);d<=end;d.setUTCDate(d.getUTCDate()+1)){
      const date=d.toISOString().slice(0,10),weekday=new Date(date+"T12:00:00Z").getUTCDay();
      if(weekday===5||weekday===6)continue;
      for(const code of ["morning","evening"]){
        const sh=ctx.getShifts()[code];
        if(!sh?.enabled||sessions.some(x=>x.date===date&&x.shift===code))continue;
        const [hh,mm]=String(sh.end_time).slice(0,5).split(":").map(Number),[yy,mo,dd]=date.split("-").map(Number);
        const endIso=ctx.toUtc(yy,mo,dd,hh,mm,0);
        if(new Date(endIso).getTime()<now)details.push({date,shift:code,shiftName:shiftName(code),type:"absence_review",firstPunch:"—",exitAt:"—",lateMinutes:0,earlyDeparture:false,lateDeparture:false,status:"لم يسجل حضور — يتطلب مراجعة واعتماد",punchCount:0});
      }
    }
    details.sort((a,b)=>(a.date+a.shift).localeCompare(b.date+b.shift));
    const attendance=details.filter(x=>x.type==="attendance");
    const summary={attendanceDays:new Set(attendance.map(x=>x.date)).size,sessionCount:attendance.length,lateCount:attendance.filter(x=>x.lateMinutes>0).length,absenceCount:details.filter(x=>x.type==="absence_review").length,earlyDepartureCount:attendance.filter(x=>x.earlyDeparture).length,lateDepartureCount:attendance.filter(x=>x.lateDeparture).length,totalLateMinutes:attendance.reduce((n,x)=>n+Number(x.lateMinutes||0),0)};
    return {employee,from,to,details,summary};
  }
  async function create(){
    if(!roleCanManage()){toast("ليس لديك صلاحية إصدار التقارير الرسمية");return;}
    try{
      const r=makeReport();
      const {data:row,error}=await ctx.supabase.from("employee_accountability_reports").insert({employee_id:r.employee.id,employee_name:r.employee.full_name,employee_code:r.employee.employee_code,department:r.employee.department||"",period_start:r.from,period_end:r.to,summary:r.summary,details:r.details,created_by:ctx.getUser().id,status:"pending"}).select("id").single();
      if(error)throw error;
      toast("تم حفظ التقرير الرسمي");await loadList();await open(row.id);
    }catch(e){toast("تعذر إنشاء التقرير: "+e.message);}
  }
  async function open(id){
    const {data:r,error}=await ctx.supabase.from("employee_accountability_reports").select("*").eq("id",id).single();
    if(error){toast("تعذر فتح التقرير: "+error.message);return;}
    const s=r.summary||{},items=Array.isArray(r.details)?r.details:[],edit=roleCanManage();
    $("officialReportDetail").innerHTML='<div class="official-paper" id="officialPaper"><div class="official-heading"><strong>جمعية الدعوة والإرشاد وتوعية الجاليات بالراكة</strong><h2>تقرير متابعة حضور وانصراف موظف</h2><span>تقرير إداري للمراجعة والمساءلة</span></div>'+
    '<div class="official-meta"><div><b>اسم الموظف:</b> '+esc(r.employee_name)+'</div><div><b>الرقم الوظيفي:</b> '+esc(r.employee_code)+'</div><div><b>القسم:</b> '+esc(r.department||"—")+'</div><div><b>الفترة:</b> '+esc(r.period_start)+' إلى '+esc(r.period_end)+'</div><div><b>حالة التقرير:</b> '+statusLabel(r.status)+'</div></div>'+
    '<div class="official-stats"><div><b>'+Number(s.attendanceDays||0)+'</b><small>أيام حضور</small></div><div><b>'+Number(s.lateCount||0)+'</b><small>حالات تأخير</small></div><div><b>'+Number(s.absenceCount||0)+'</b><small>غياب يحتاج مراجعة</small></div><div><b>'+Number(s.earlyDepartureCount||0)+'</b><small>انصراف مبكر</small></div><div><b>'+Number(s.lateDepartureCount||0)+'</b><small>انصراف متأخر</small></div><div><b>'+Number(s.totalLateMinutes||0)+'</b><small>إجمالي دقائق التأخير</small></div></div>'+
    '<h3>التفاصيل اليومية</h3><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>الفترة</th><th>الحضور</th><th>الانصراف</th><th>التأخير</th><th>الحالة</th></tr></thead><tbody>'+
    (items.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.shiftName)+'</td><td>'+esc(x.firstPunch)+'</td><td>'+esc(x.exitAt)+'</td><td>'+Number(x.lateMinutes||0)+' دقيقة</td><td>'+esc(x.status)+'</td></tr>').join("")||'<tr><td colspan="6">لا توجد تفاصيل مسجلة.</td></tr>')+
    '</tbody></table></div><p class="official-note">حالات عدم تسجيل الحضور معروضة للمراجعة فقط، ولا تُعد مخالفة معتمدة قبل التحقق من الإجازات والأعذار وأيام العمل الفعلية.</p>'+
    '<div class="official-response"><label>إفادة الموظف<textarea id="employeeStatement" rows="3" '+(!edit?'readonly':'')+'>'+esc(r.employee_statement||"")+'</textarea></label><label>ملاحظات المدير / الموارد البشرية<textarea id="managerNotes" rows="3" '+(!edit?'readonly':'')+'>'+esc(r.manager_notes||"")+'</textarea></label></div>'+
    '<div class="official-signatures"><div>توقيع الموظف: __________________</div><div>اعتماد المدير المختص: __________________</div><div>التاريخ: ____ / ____ / ______</div></div></div>'+
    '<div class="official-actions">'+(edit?'<button class="secondary-btn" id="saveOfficialReport">حفظ الإفادة والملاحظات</button><button class="primary-btn" id="approveOfficialReport">اعتماد التقرير</button><button class="secondary-btn" id="rejectOfficialReport">إرجاع للمراجعة</button>':'')+'<button class="secondary-btn" id="printOfficialReport">طباعة / PDF</button></div>';
    $("saveOfficialReport")?.addEventListener("click",()=>update(id,{}));
    $("approveOfficialReport")?.addEventListener("click",()=>update(id,{status:"approved",approved_by:ctx.getUser().id,approved_at:new Date().toISOString()}));
    $("rejectOfficialReport")?.addEventListener("click",()=>update(id,{status:"rejected",approved_by:null,approved_at:null}));
    $("printOfficialReport")?.addEventListener("click",()=>{document.body.classList.add("printing-official");window.print();document.body.classList.remove("printing-official");});
  }
  async function update(id,extra){
    const payload={employee_statement:$("employeeStatement")?.value||"",manager_notes:$("managerNotes")?.value||"",updated_at:new Date().toISOString(),...extra};
    const {error}=await ctx.supabase.from("employee_accountability_reports").update(payload).eq("id",id);
    if(error){toast("تعذر حفظ التقرير: "+error.message);return;}
    toast(extra.status==="approved"?"تم اعتماد التقرير":extra.status==="rejected"?"تم إرجاع التقرير للمراجعة":"تم حفظ الإفادة والملاحظات");
    await loadList();await open(id);
  }
  $("createOfficialReport").addEventListener("click",create);
  $("officialReportList").addEventListener("click",e=>{const id=e.target.dataset.openReport;if(id)open(id);});
  fillEmployees();
  window.refreshOfficialReportEmployees=fillEmployees;
  window.loadOfficialReports=loadList;
  return {loadList,fillEmployees};
}