import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants & Helpers ──────────────────────────────────────────────────────
const DAY_NAMES  = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const todayStr   = () => new Date().toISOString().split("T")[0];
const dayName    = (d) => DAY_NAMES[new Date(d + "T00:00:00").getDay()];
const isWeekend  = (d) => { const w = new Date(d + "T00:00:00").getDay(); return w===0||w===6; };
const getWeekNum = (d) => {
  const dt = new Date(d + "T00:00:00");
  const jan1 = new Date(dt.getFullYear(), 0, 1);
  return Math.ceil(((dt - jan1) / 86400000 + jan1.getDay() + 1) / 7);
};
const getMonth   = (d) => d.slice(0,7);
const monthLabel = (ym) => { const [y,m]=ym.split("-"); return new Date(y,m-1,1).toLocaleString("default",{month:"long",year:"numeric"}); };
const fmt2        = (n) => parseFloat(n.toFixed(2));
const effHrsCalc  = (shiftHrs, downtime) => fmt2(Math.max(0, shiftHrs - (parseFloat(downtime)||0)));
// Production formula: hours produced = count ÷ CPH
const hrsProduced = (count, cph) => {
  const c = parseFloat(count)||0;
  const r = parseFloat(cph)||1;
  return fmt2(c / r);
};
// Production % = (sum of hrsProduced across elevations) ÷ effHrs × 100
const productionPct = (counts, cphs, effHrs) => {
  if(!effHrs) return 0;
  const totalHrsProd = counts.reduce((a,c,i)=>a+hrsProduced(c,cphs[i]),0);
  return fmt2(totalHrsProd / effHrs * 100);
};
// OT Pay = min(approvedOT, prohanceOT) × rate
const calcOT = (approvedOTHrs, prohanceHrs, shiftHrs, tenure) => {
  const rate       = tenure==="below" ? 110 : 200;
  const approved   = Math.max(0, parseFloat(approvedOTHrs)||0);
  const prohance   = Math.max(0, parseFloat(prohanceHrs)||0);
  const proOT      = Math.max(0, prohance - shiftHrs);
  const payableHrs = fmt2(Math.min(approved, proOT));
  return { otHrs: payableHrs, otAmt: fmt2(payableHrs * rate) };
};

// ─── Persistent Storage (window.storage API) ──────────────────────────────────
const ENTRIES_KEY = "tracker_entries_v3";
const PROFILE_KEY = "tracker_profile_v3";
const DATES_KEY   = "tracker_dates_v3";   // separate set of logged dates for fast dup check

async function loadStorage(key) {
  try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; }
  catch { return null; }
}
async function saveStorage(key, data) {
  try { await window.storage.set(key, JSON.stringify(data)); } catch(e) { console.error(e); }
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const lbl = { display:"block", color:"#5a7aaa", fontSize:12, marginBottom:6, letterSpacing:0.5, textTransform:"uppercase" };
const inp = {
  width:"100%", boxSizing:"border-box", background:"#0d1830",
  border:"1.5px solid #1e3060", borderRadius:8, color:"#c8daf0",
  padding:"10px 14px", fontSize:14, marginBottom:0, outline:"none",
  fontFamily:"'Segoe UI',sans-serif"
};
const card = { background:"#111d3a", border:"1px solid #1e3060", borderRadius:14, padding:"20px 24px" };

// ─── Sub-components ───────────────────────────────────────────────────────────

function AchievementPopup({ msg, onClose }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(10,18,40,0.85)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999}}>
      <div style={{background:"linear-gradient(135deg,#1a2a4a,#0f3460,#16213e)",
        border:"2px solid #f5a623",borderRadius:20,padding:"48px 56px",textAlign:"center",
        maxWidth:400,boxShadow:"0 0 60px rgba(245,166,35,0.4)"}}>
        <div style={{fontSize:64,marginBottom:12}}>🏆</div>
        <div style={{fontSize:28,fontWeight:700,color:"#f5a623",marginBottom:8}}>{msg||"Target Achieved!"}</div>
        <div style={{color:"#a8c4e0",fontSize:15,marginBottom:28}}>Great work! You hit your daily count target.</div>
        <button onClick={onClose} style={{background:"#f5a623",color:"#0f1e3d",border:"none",
          borderRadius:8,padding:"10px 32px",fontWeight:700,fontSize:15,cursor:"pointer"}}>
          Continue →
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, color="#a8c4e0", size=14 }) {
  return (
    <div style={{background:"#0a1228",borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
      <div style={{color:"#5a7aaa",fontSize:10,marginBottom:3}}>{label}</div>
      <div style={{color,fontWeight:700,fontSize:size}}>{value}</div>
    </div>
  );
}

function SummaryBlock({ entries, elevations, label }) {
  const [open, setOpen] = useState(true);
  if (!entries.length) return null;
  const workDays      = entries.filter(e=>e.isWorking).length;
  const achDays       = entries.filter(e=>e.achieved).length;
  const totOTHrs      = fmt2(entries.reduce((a,e)=>a+e.otHrs,0));
  const totOTAmt      = fmt2(entries.reduce((a,e)=>a+e.otAmt,0));
  const totAchieved   = fmt2(entries.reduce((a,e)=>a+e.totalAchieved,0));
  const totProhance   = fmt2(entries.reduce((a,e)=>a+e.prohance,0));
  const totHrsProd    = fmt2(entries.reduce((a,e)=>a+(e.totalHrsProd||0),0));
  const totEffHrs     = fmt2(entries.filter(e=>e.isWorking).reduce((a,e)=>a+(e.effHrs||0),0));
  const avgProdPct    = totEffHrs>0 ? fmt2(totHrsProd/totEffHrs*100) : 0;
  const hitRate       = workDays>0 ? Math.round(achDays/workDays*100) : 0;
  return (
    <div style={{...card, marginBottom:12}}>
      <div onClick={()=>setOpen(o=>!o)} style={{display:"flex",justifyContent:"space-between",
        alignItems:"center",cursor:"pointer",marginBottom:open?16:0}}>
        <div style={{color:"#f5a623",fontWeight:700,fontSize:14}}>{label}</div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <span style={{fontSize:12,fontWeight:700,padding:"3px 10px",borderRadius:20,
            background:avgProdPct>=100?"rgba(76,175,80,0.2)":"rgba(245,166,35,0.15)",
            color:avgProdPct>=100?"#4caf50":"#f5a623"}}>{avgProdPct}% production</span>
          <span style={{color:"#5a7aaa",fontSize:16}}>{open?"▲":"▼"}</span>
        </div>
      </div>
      {open && <>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
          <Stat label="Working Days"   value={workDays}           color="#4caf50"/>
          <Stat label="Days ≥100%"     value={achDays}            color="#f5a623"/>
          <Stat label="Hrs Produced"   value={totHrsProd+"h"}     color="#5a9fd4"/>
          <Stat label="Total Counts"   value={totAchieved}        color="#a8c4e0"/>
          <Stat label="Avg Production" value={avgProdPct+"%"}     color={avgProdPct>=100?"#4caf50":avgProdPct>=80?"#f5a623":"#e05050"}/>
          <Stat label="Prohance Hrs"   value={totProhance+"h"}    color="#5a9fd4"/>
          <Stat label="OT Hrs"         value={totOTHrs+"h"}       color="#9b59b6"/>
          <Stat label="OT Amount"      value={"₹"+totOTAmt}       color="#9b59b6"/>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {elevations.map((e,i)=>{
            const tot    = fmt2(entries.reduce((a,en)=>a+(en.counts[i]||0),0));
            const hrsPr  = fmt2(entries.reduce((a,en)=>a+((en.hrsPerElev?.[i])||hrsProduced(en.counts[i]||0,e.cph)),0));
            const effSum = fmt2(entries.filter(en=>en.isWorking).reduce((a,en)=>a+(en.effHrs||0),0));
            const p      = effSum>0?fmt2(hrsPr/effSum*100):0;
            return (
              <div key={i} style={{display:"grid",gridTemplateColumns:"1.3fr 0.8fr 0.8fr 70px",gap:8,
                alignItems:"center",background:"#0d1830",borderRadius:8,padding:"7px 12px"}}>
                <div style={{color:"#a8c4e0",fontSize:12,fontWeight:600}}>{e.name}</div>
                <div style={{color:"#5a7aaa",fontSize:11}}>Count: <span style={{color:"#a8c4e0"}}>{tot}</span></div>
                <div style={{color:"#5a7aaa",fontSize:11}}>Prod hrs: <span style={{color:"#5a9fd4"}}>{hrsPr}h</span></div>
                <div style={{textAlign:"center",fontWeight:700,fontSize:12,
                  color:p>=100?"#4caf50":p>=80?"#f5a623":"#e05050"}}>{p}%</div>
              </div>
            );
          })}
        </div>
      </>}
    </div>
  );
}

// ─── Setup Screen ─────────────────────────────────────────────────────────────
function SetupScreen({ onDone }) {
  const [name,        setName]        = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [elevCount,   setElevCount]   = useState(2);
  const [elevations,  setElevations]  = useState([{name:"",cph:""},{name:"",cph:""}]);

  const resizeElevs = (n) => {
    setElevCount(n);
    setElevations(prev => {
      const a = [...prev];
      while(a.length < n) a.push({name:"",cph:""});
      return a.slice(0,n);
    });
  };
  const updateElev = (i,f,v) => setElevations(p => p.map((e,idx)=>idx===i?{...e,[f]:v}:e));
  const valid = name.trim() && joiningDate && elevations.every(e=>e.name.trim()&&parseFloat(e.cph)>0);

  const go = () => {
    if(!valid) return;
    const diff   = (new Date() - new Date(joiningDate+"T00:00:00")) / (1000*60*60*24*365);
    const tenure = diff < 1 ? "below" : "above";
    const profile = { name:name.trim(), joiningDate, tenure, elevations };
    saveStorage(PROFILE_KEY, profile);
    onDone(profile);
  };

  return (
    <div style={{minHeight:"100vh",background:"#0a1228",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#111d3a",borderRadius:20,padding:"40px 44px",width:"100%",maxWidth:560,
        boxShadow:"0 8px 48px rgba(0,0,0,0.5)",border:"1px solid #1e3060"}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{display:"inline-block",background:"linear-gradient(135deg,#1e4080,#0f3460)",
            borderRadius:14,padding:"10px 18px",marginBottom:14}}><span style={{fontSize:28}}>📊</span></div>
          <h1 style={{color:"#f5a623",fontSize:26,fontWeight:700,margin:"0 0 6px"}}>Daily Productivity Tracker</h1>
          <p style={{color:"#5a7aaa",fontSize:13,margin:0}}>Set up your profile to begin tracking</p>
        </div>

        <label style={lbl}>Your Name</label>
        <input style={{...inp,marginBottom:16}} placeholder="e.g. Ravi Kumar" value={name} onChange={e=>setName(e.target.value)}/>

        <label style={lbl}>Date of Joining</label>
        <input style={{...inp,marginBottom:16}} type="date" value={joiningDate} onChange={e=>setJoiningDate(e.target.value)}/>

        <label style={lbl}>Number of Elevations <span style={{color:"#5a7aaa",textTransform:"none",fontSize:11}}>(up to 40)</span></label>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
          {/* Stepper */}
          <div style={{display:"flex",alignItems:"center",background:"#0d1830",border:"1.5px solid #1e3060",borderRadius:10,overflow:"hidden"}}>
            <button onClick={()=>resizeElevs(Math.max(1,elevCount-1))} style={{
              background:"transparent",border:"none",color:"#f5a623",fontSize:20,
              padding:"6px 14px",cursor:"pointer",fontWeight:700,lineHeight:1}}>−</button>
            <div style={{
              minWidth:42,textAlign:"center",color:"#f5a623",fontWeight:700,fontSize:18,
              borderLeft:"1px solid #1e3060",borderRight:"1px solid #1e3060",padding:"6px 10px"}}>
              {elevCount}
            </div>
            <button onClick={()=>resizeElevs(Math.min(40,elevCount+1))} style={{
              background:"transparent",border:"none",color:"#f5a623",fontSize:20,
              padding:"6px 14px",cursor:"pointer",fontWeight:700,lineHeight:1}}>+</button>
          </div>
          {/* Quick-pick chips: common values */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[2,3,4,5,6,8,10,12,15,20].map(n=>(
              <button key={n} onClick={()=>resizeElevs(n)} style={{
                padding:"4px 11px",borderRadius:20,border:"1.5px solid",fontSize:12,fontWeight:600,
                borderColor:elevCount===n?"#f5a623":"#1e3060",
                background:elevCount===n?"rgba(245,166,35,0.18)":"transparent",
                color:elevCount===n?"#f5a623":"#5a7aaa",cursor:"pointer"}}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div style={{color:"#3a5080",fontSize:11,marginBottom:16}}>
          Use − / + or tap a quick-pick, or type directly in the box
        </div>

        <label style={lbl}>Elevation Name & CPH/hr</label>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:24}}>
          {elevations.map((e,i)=>(
            <div key={i} style={{display:"flex",gap:8,alignItems:"center"}}>
              <div style={{width:26,height:26,borderRadius:7,background:"#1e3060",display:"flex",
                alignItems:"center",justifyContent:"center",color:"#5a7aaa",fontSize:11,fontWeight:700,flexShrink:0}}>{i+1}</div>
              <input style={{...inp,flex:2}} placeholder="Elevation name" value={e.name}
                onChange={ev=>updateElev(i,"name",ev.target.value)}/>
              <input style={{...inp,flex:1}} type="number" placeholder="CPH/hr" min="1" value={e.cph}
                onChange={ev=>updateElev(i,"cph",ev.target.value)}/>
            </div>
          ))}
        </div>

        <button onClick={go} disabled={!valid} style={{
          width:"100%",padding:"13px",borderRadius:10,border:"none",
          background:valid?"linear-gradient(135deg,#f5a623,#e8921a)":"#1e3060",
          color:valid?"#0a1228":"#3a5080",fontWeight:700,fontSize:16,
          cursor:valid?"pointer":"not-allowed",letterSpacing:0.5}}>
          Start Tracking →
        </button>
      </div>
    </div>
  );
}

// ─── Main Tracker ─────────────────────────────────────────────────────────────
function Tracker({ profile, onReset }) {
  const { name, tenure, elevations } = profile;

  // entries array + a Set of logged dates stored in a ref for instant dup check
  const [entries,     setEntries]     = useState([]);
  const loggedDates   = useRef(new Set());   // ← THE fix: ref-based set, never stale
  const [loaded,      setLoaded]      = useState(false);
  const [activeTab,   setActiveTab]   = useState("log");
  const [summaryView, setSummaryView] = useState("daily");
  const [showPopup,   setShowPopup]   = useState(false);
  const [popupMsg,    setPopupMsg]    = useState("");
  const [dupError,    setDupError]    = useState("");
  const [saveState,   setSaveState]   = useState("idle"); // idle|saving|saved
  const [editEntry,   setEditEntry]   = useState(null);   // entry being edited in history

  const [form, setForm] = useState({
    date:      todayStr(),
    isWorking: !isWeekend(todayStr()),
    dayType:   "full",
    downtime:  "",
    prohance:  "",
    approvedOT:"",
    counts:    elevations.map(()=>""),
    elevHrs:   elevations.map(()=>""),
    notes:     "",
  });

  // Load saved data
  useEffect(()=>{
    (async()=>{
      const saved = await loadStorage(ENTRIES_KEY);
      if(saved && Array.isArray(saved)) {
        setEntries(saved);
        // Rebuild the date set from loaded entries
        loggedDates.current = new Set(saved.map(e => e.date));
      }
      setLoaded(true);
    })();
  },[]);

  // Auto weekend when date changes
  useEffect(()=>{
    setForm(f=>({...f, isWorking:!isWeekend(f.date)}));
  },[form.date]);

  // ── Derived form values ───────────────────────────────────────────────────
  const shiftHrs    = form.isWorking ? (form.dayType==="full" ? 8.5 : 5) : 0;
  const effHrs      = effHrsCalc(shiftHrs, form.downtime);
  const prohanceVal = Math.max(0, parseFloat(form.prohance)||0);
  const approvedOT  = Math.max(0, parseFloat(form.approvedOT)||0);

  // Production formula: hrsProduced per elev = count ÷ CPH; no manual hrs entry needed
  const achievedPerElev  = form.counts.map(c => Math.max(0, parseFloat(c)||0));
  const hrsPerElev       = elevations.map((e,i) => hrsProduced(achievedPerElev[i], e.cph));
  const totalHrsProd     = fmt2(hrsPerElev.reduce((a,b)=>a+b, 0));
  const prodPct          = effHrs>0 ? fmt2(totalHrsProd / effHrs * 100) : 0;
  const totalAchieved    = fmt2(achievedPerElev.reduce((a,b)=>a+b, 0));
  // "achieved" = production ≥ 100%
  const isAchieved       = effHrs>0 && prodPct >= 100;
  const { otHrs, otAmt } = calcOT(approvedOT, prohanceVal, shiftHrs, tenure);

  const sf = (k,v) => setForm(f=>({...f,[k]:v}));
  const sc = (i,v) => setForm(f=>{ const c=[...f.counts]; c[i]=v; return {...f,counts:c}; });

  // ── Save helper ───────────────────────────────────────────────────────────
  const persistEntries = useCallback(async (updated) => {
    setSaveState("saving");
    await saveStorage(ENTRIES_KEY, updated);
    setSaveState("saved");
    setTimeout(()=>setSaveState("idle"), 2000);
  },[]);

  // ── Log Entry ─────────────────────────────────────────────────────────────
  const handleLog = () => {
    const dateKey = form.date.trim();

    // Primary guard: ref-based set check (always current, never stale)
    if (loggedDates.current.has(dateKey)) {
      setDupError(`⛔ ${dateKey} (${dayName(dateKey)}) already logged. Edit it in History tab.`);
      setTimeout(()=>setDupError(""), 5000);
      return;
    }

    const entry = buildEntry(dateKey);
    const updated = [entry, ...entries].sort((a,b)=>b.date.localeCompare(a.date));

    // Update state + ref atomically
    setEntries(updated);
    loggedDates.current.add(dateKey);
    persistEntries(updated);

    if(isAchieved) { setPopupMsg("Target Achieved! 🎉"); setShowPopup(true); }

    // Reset daily inputs
    setForm(f=>({...f, downtime:"", prohance:"", approvedOT:"", counts:elevations.map(()=>""), notes:""}));
  };

  const buildEntry = (dateKey) => ({
    id:           Date.now(),
    date:         dateKey,
    day:          dayName(dateKey),
    isWorking:    form.isWorking,
    dayType:      form.dayType,
    shiftHrs,
    downtime:     fmt2(parseFloat(form.downtime)||0),
    effHrs,
    prohance:     fmt2(prohanceVal),
    approvedOT:   fmt2(approvedOT),
    counts:       [...achievedPerElev],
    hrsPerElev:   [...hrsPerElev],
    totalHrsProd,
    prodPct,
    totalAchieved,
    otHrs,
    otAmt,
    achieved:     isAchieved,
    notes:        form.notes.trim(),
    week:         getWeekNum(dateKey),
    month:        getMonth(dateKey),
    year:         new Date(dateKey+"T00:00:00").getFullYear(),
  });

  // ── Edit entry (from History) ─────────────────────────────────────────────
  const handleEditSave = (updated) => {
    const newList = entries.map(e=>e.id===updated.id ? updated : e)
                           .sort((a,b)=>b.date.localeCompare(a.date));
    setEntries(newList);
    persistEntries(newList);
    setEditEntry(null);
  };

  // ── Delete entry ──────────────────────────────────────────────────────────
  const handleDelete = (entry) => {
    const newList = entries.filter(e=>e.id!==entry.id);
    loggedDates.current.delete(entry.date);
    setEntries(newList);
    persistEntries(newList);
  };

  // ── Overall stats ─────────────────────────────────────────────────────────
  const workDays     = entries.filter(e=>e.isWorking).length;
  const achDays      = entries.filter(e=>e.achieved).length;
  const totalOTAmt   = fmt2(entries.reduce((a,e)=>a+e.otAmt,0));
  const totalOTHrs   = fmt2(entries.reduce((a,e)=>a+e.otHrs,0));

  // Groupings for summary
  const sorted = [...entries].sort((a,b)=>a.date.localeCompare(b.date));
  const weekGroups={}, monthGroups={};
  sorted.forEach(e=>{
    const wk=`${e.year}-W${String(e.week).padStart(2,"0")}`;
    if(!weekGroups[wk]) weekGroups[wk]=[];
    weekGroups[wk].push(e);
    if(!monthGroups[e.month]) monthGroups[e.month]=[];
    monthGroups[e.month].push(e);
  });

  if(!loaded) return (
    <div style={{minHeight:"100vh",background:"#0a1228",display:"flex",alignItems:"center",
      justifyContent:"center",color:"#5a7aaa",fontSize:16}}>Loading saved data…</div>
  );

  const saveBtnStyle = {
    background: saveState==="saved"?"rgba(76,175,80,0.2)":"rgba(245,166,35,0.15)",
    border:`1px solid ${saveState==="saved"?"#4caf50":"#f5a623"}`,
    color: saveState==="saved"?"#4caf50":"#f5a623",
    borderRadius:8, padding:"6px 16px", cursor:"pointer", fontSize:13, fontWeight:600
  };

  return (
    <div style={{minHeight:"100vh",background:"#0a1228",fontFamily:"'Segoe UI',sans-serif",color:"#c8daf0"}}>
      {showPopup && <AchievementPopup msg={popupMsg} onClose={()=>setShowPopup(false)}/>}

      {/* ── Top Bar ── */}
      <div style={{background:"#111d3a",borderBottom:"1px solid #1e3060",padding:"14px 24px",
        display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:22}}>📊</span>
          <div>
            <div style={{color:"#f5a623",fontWeight:700,fontSize:17}}>Daily Productivity Tracker</div>
            <div style={{color:"#5a7aaa",fontSize:12}}>
              {name} · OT ₹{tenure==="below"?110:200}/hr ·
              <span style={{marginLeft:6,color:tenure==="below"?"#e07050":"#4caf50"}}>
                {tenure==="below"?"Below 1yr":"Above 1yr"}
              </span>
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={()=>persistEntries(entries)} style={saveBtnStyle}>
            {saveState==="saving"?"⏳ Saving…":saveState==="saved"?"✓ Saved!":"💾 Save"}
          </button>
          <button onClick={onReset} style={{background:"transparent",border:"1px solid #1e3060",
            color:"#5a7aaa",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:12}}>
            ← Profile
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{display:"flex",borderBottom:"1px solid #1e3060",background:"#0d1830"}}>
        {[["log","📝 Log Entry"],["history","📋 History"],["summary","📈 Summary"]].map(([k,l])=>(
          <button key={k} onClick={()=>setActiveTab(k)} style={{
            padding:"12px 24px",border:"none",background:"transparent",
            color:activeTab===k?"#f5a623":"#5a7aaa",
            borderBottom:activeTab===k?"2px solid #f5a623":"2px solid transparent",
            cursor:"pointer",fontWeight:activeTab===k?700:400,fontSize:14}}>
            {l}
          </button>
        ))}
      </div>

      <div style={{padding:"28px 20px",maxWidth:940,margin:"0 auto"}}>

        {/* ══════════════════════════════════════════════════════════════════════
            LOG ENTRY TAB
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab==="log" && (
          <div style={{display:"flex",flexDirection:"column",gap:18}}>

            {dupError && (
              <div style={{background:"rgba(224,80,80,0.13)",border:"1.5px solid #e05050",
                borderRadius:10,padding:"13px 18px",color:"#e05050",fontWeight:600,fontSize:14,
                display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:20}}>🚫</span> {dupError}
              </div>
            )}

            {/* Date / Day */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <div>
                <label style={lbl}>Date</label>
                <input style={{...inp,marginBottom:0}} type="date" value={form.date}
                  onChange={e=>sf("date",e.target.value)}/>
              </div>
              <div>
                <label style={lbl}>Day</label>
                <div style={{...inp,display:"flex",alignItems:"center",color:"#a8c4e0",
                  fontWeight:600,height:42,marginBottom:0}}>
                  {dayName(form.date)} {isWeekend(form.date)?"🔴 Weekend":"🟢 Weekday"}
                </div>
              </div>
            </div>

            {/* Status / Shift */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <div>
                <label style={lbl}>Day Status</label>
                <div style={{display:"flex",gap:8}}>
                  {[["true","✅ Working"],["false","🔴 Holiday/Off"]].map(([v,l])=>(
                    <button key={v} onClick={()=>sf("isWorking",v==="true")} style={{
                      flex:1,padding:"9px 4px",borderRadius:8,border:"1.5px solid",
                      borderColor:String(form.isWorking)===v?"#4caf50":"#1e3060",
                      background:String(form.isWorking)===v?"rgba(76,175,80,0.15)":"transparent",
                      color:String(form.isWorking)===v?"#4caf50":"#5a7aaa",
                      cursor:"pointer",fontWeight:600,fontSize:12}}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={lbl}>Shift Type</label>
                <div style={{display:"flex",gap:8}}>
                  {[["full","Full Day (8.5h)"],["half","Half Day (5h)"]].map(([v,l])=>(
                    <button key={v} disabled={!form.isWorking} onClick={()=>sf("dayType",v)} style={{
                      flex:1,padding:"9px 4px",borderRadius:8,border:"1.5px solid",
                      borderColor:form.dayType===v&&form.isWorking?"#f5a623":"#1e3060",
                      background:form.dayType===v&&form.isWorking?"rgba(245,166,35,0.15)":"transparent",
                      color:form.dayType===v&&form.isWorking?"#f5a623":form.isWorking?"#5a7aaa":"#2a4060",
                      cursor:form.isWorking?"pointer":"not-allowed",fontWeight:600,fontSize:12}}>{l}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Downtime / Prohance / Approved OT */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
              <div>
                <label style={lbl}>Downtime (hrs) <span style={{color:"#e05050",textTransform:"none",fontSize:10}}>deducted from target</span></label>
                <input style={{...inp,marginBottom:0}} type="number" min="0" step="0.25" placeholder="0"
                  value={form.downtime} onChange={e=>sf("downtime",e.target.value)}/>
              </div>
              <div>
                <label style={lbl}>Prohance Hours <span style={{color:"#5a9fd4",textTransform:"none",fontSize:10}}>actual hrs worked</span></label>
                <input style={{...inp,marginBottom:0}} type="number" min="0" step="0.25" placeholder="0"
                  value={form.prohance} onChange={e=>sf("prohance",e.target.value)}/>
              </div>
              <div>
                <label style={lbl}>Approved OT Hrs <span style={{color:"#9b59b6",textTransform:"none",fontSize:10}}>for OT pay calc</span></label>
                <input style={{...inp,marginBottom:0}} type="number" min="0" step="0.25" placeholder="0"
                  value={form.approvedOT} onChange={e=>sf("approvedOT",e.target.value)}/>
              </div>
            </div>

            {/* Hours pill row */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {[
                ["Shift Hrs",    shiftHrs+"h",    "#a8c4e0"],
                ["− Downtime",   (parseFloat(form.downtime)||0)+"h","#e05050"],
                ["= Effective",  effHrs+"h",       "#4caf50"],
                ["Prohance",     prohanceVal+"h",  "#5a9fd4"],
                ["Approved OT",  approvedOT+"h",   "#9b59b6"],
                ["OT Amount",    "₹"+otAmt,        "#9b59b6"],
              ].map(([l,v,c])=>(
                <div key={l} style={{background:"#0d1830",border:"1px solid #1e3060",
                  borderRadius:8,padding:"6px 13px",display:"flex",gap:6,alignItems:"center"}}>
                  <span style={{color:"#5a7aaa",fontSize:11}}>{l}:</span>
                  <span style={{color:c,fontWeight:700,fontSize:13}}>{v}</span>
                </div>
              ))}
            </div>

            {/* Elevation count inputs */}
            <div>
              <label style={lbl}>Counts per Elevation
                <span style={{color:"#5a9fd4",textTransform:"none",fontSize:10,marginLeft:6}}>
                  — hrs produced = count ÷ CPH
                </span>
              </label>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {elevations.map((e,i)=>{
                  const ach    = achievedPerElev[i];
                  const hrsPr  = hrsPerElev[i];
                  const elevPct= effHrs>0 ? fmt2(hrsPr/effHrs*100) : 0;
                  return (
                    <div key={i} style={{
                      display:"grid",gridTemplateColumns:"1.4fr 0.6fr 1fr 1fr",
                      gap:10,alignItems:"center",
                      background:"#0d1830",borderRadius:10,padding:"11px 14px",
                      border:`1px solid ${elevPct>=100?"#2a5a2a":"#1e3060"}`}}>
                      {/* Name */}
                      <div style={{color:"#a8c4e0",fontWeight:600,fontSize:13}}>{e.name}</div>
                      {/* CPH */}
                      <div style={{textAlign:"center"}}>
                        <div style={{color:"#5a7aaa",fontSize:9}}>CPH/hr</div>
                        <div style={{color:"#f5a623",fontWeight:700,fontSize:14}}>{e.cph}</div>
                      </div>
                      {/* Achieved input */}
                      <div>
                        <div style={{color:"#5a7aaa",fontSize:9,marginBottom:3}}>Achieved Count</div>
                        <input style={{...inp,marginBottom:0,textAlign:"center"}}
                          type="number" min="0" placeholder="Enter count"
                          value={form.counts[i]} onChange={ev=>sc(i,ev.target.value)}/>
                      </div>
                      {/* Hrs produced auto-calc */}
                      <div style={{textAlign:"center",background:"#0a1228",borderRadius:8,padding:"7px 4px"}}>
                        <div style={{color:"#5a7aaa",fontSize:9}}>{ach>0?`${ach}÷${e.cph}`:"hrs produced"}</div>
                        <div style={{color:elevPct>=100?"#4caf50":ach>0?"#5a9fd4":"#3a5080",
                          fontWeight:700,fontSize:15}}>
                          {ach>0 ? hrsPr+"h" : "—"}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {/* Production total bar */}
                <div style={{background:"#0d1830",border:"1px solid #1e3060",borderRadius:9,
                  padding:"10px 14px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                  <div>
                    <span style={{color:"#5a7aaa",fontSize:11}}>Total hrs produced: </span>
                    <span style={{color:"#5a9fd4",fontWeight:700,fontSize:14}}>{totalHrsProd}h</span>
                  </div>
                  <div>
                    <span style={{color:"#5a7aaa",fontSize:11}}>Effective shift: </span>
                    <span style={{color:"#a8c4e0",fontWeight:700,fontSize:14}}>{effHrs}h</span>
                  </div>
                  <div style={{marginLeft:"auto"}}>
                    <span style={{color:"#5a7aaa",fontSize:11}}>Production: </span>
                    <span style={{fontWeight:700,fontSize:18,
                      color:prodPct>=100?"#4caf50":prodPct>=80?"#f5a623":"#e05050"}}>
                      {prodPct}%{prodPct>=100?" ✅":""}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label style={lbl}>Notes / Remarks (optional)</label>
              <textarea style={{...inp,marginBottom:0,resize:"vertical",minHeight:60}}
                placeholder="e.g. System down for 1hr, Training session, etc."
                value={form.notes} onChange={e=>sf("notes",e.target.value)}/>
            </div>

            {/* Live summary */}
            <div style={{...card,background:"linear-gradient(135deg,#0f2040,#0a1830)"}}>
              <div style={{color:"#5a7aaa",fontSize:11,marginBottom:12,letterSpacing:1,textTransform:"uppercase"}}>
                Live Summary for {form.date}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
                <Stat label="Shift Hrs"       value={shiftHrs+"h"}        color="#a8c4e0" size={15}/>
                <Stat label="Effective Hrs"   value={effHrs+"h"}           color="#4caf50" size={15}/>
                <Stat label="Hrs Produced"    value={totalHrsProd+"h"}     color="#5a9fd4" size={15}/>
                <Stat label="Achieved Count"  value={totalAchieved}        color="#a8c4e0" size={15}/>
                <Stat label="Production %"    value={prodPct+"%"}          color={prodPct>=100?"#4caf50":prodPct>=80?"#f5a623":"#e05050"} size={15}/>
                <Stat label="Approved OT"     value={approvedOT+"h"}       color="#9b59b6" size={15}/>
                <Stat label="OT Amount"       value={"₹"+otAmt}            color="#9b59b6" size={15}/>
                <Stat label="Status"          value={isAchieved?"✅ Met":"⏳ Pending"} color={isAchieved?"#4caf50":"#e07050"} size={15}/>
              </div>
            </div>

            <button onClick={handleLog} style={{
              padding:"14px",borderRadius:10,border:"none",
              background:"linear-gradient(135deg,#f5a623,#e8921a)",
              color:"#0a1228",fontWeight:700,fontSize:16,cursor:"pointer",letterSpacing:0.5}}>
              Log Entry ✓
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            HISTORY TAB
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab==="history" && (
          <div>
            {entries.length===0 ? (
              <div style={{textAlign:"center",color:"#3a5080",padding:"60px 0",fontSize:16}}>
                No entries yet. Log your first day!
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                {[...entries].sort((a,b)=>b.date.localeCompare(a.date)).map(entry=>(
                  <HistoryCard key={entry.id} entry={entry} elevations={elevations}
                    tenure={tenure}
                    onDelete={()=>handleDelete(entry)}
                    onEdit={()=>setEditEntry(entry)}/>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            SUMMARY TAB
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab==="summary" && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>

            {/* Overall bar */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
              <Stat label="📅 Days Logged"   value={entries.length}  color="#a8c4e0" size={22}/>
              <Stat label="💼 Working Days"  value={workDays}         color="#4caf50" size={22}/>
              <Stat label="🏆 Targets Met"   value={achDays}          color="#f5a623" size={22}/>
              <Stat label="💰 Total OT Amt"  value={"₹"+totalOTAmt}  color="#9b59b6" size={22}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
              <Stat label="⏱ Total OT Hrs" value={totalOTHrs+"h"}
                color="#9b59b6" size={18}/>
              <Stat label="📊 Hit Rate"
                value={workDays>0?Math.round(achDays/workDays*100)+"%":"—"}
                color={workDays>0&&achDays/workDays>=0.8?"#4caf50":"#f5a623"} size={18}/>
              <Stat label="📅 Streak"
                value={calcStreak(entries)+" days"}
                color="#5a9fd4" size={18}/>
            </div>

            {/* Period toggle */}
            <div style={{display:"flex",gap:8}}>
              {[["daily","📅 Daily"],["weekly","📆 Weekly"],["monthly","🗓 Monthly"]].map(([v,l])=>(
                <button key={v} onClick={()=>setSummaryView(v)} style={{
                  padding:"8px 20px",borderRadius:8,border:"1.5px solid",
                  borderColor:summaryView===v?"#f5a623":"#1e3060",
                  background:summaryView===v?"rgba(245,166,35,0.15)":"transparent",
                  color:summaryView===v?"#f5a623":"#5a7aaa",
                  cursor:"pointer",fontWeight:600,fontSize:13}}>{l}</button>
              ))}
            </div>

            {summaryView==="daily" && (
              <div>{entries.length===0?(
                <div style={{textAlign:"center",color:"#3a5080",padding:"40px 0"}}>No entries yet.</div>
              ):(
                [...entries].sort((a,b)=>b.date.localeCompare(a.date)).map(e=>(
                  <SummaryBlock key={e.date} entries={[e]} elevations={elevations}
                    label={`${e.date} — ${e.day}${!e.isWorking?" (Holiday/Off)":""}`}/>
                ))
              )}</div>
            )}
            {summaryView==="weekly" && (
              <div>{Object.keys(weekGroups).length===0?(
                <div style={{textAlign:"center",color:"#3a5080",padding:"40px 0"}}>No entries yet.</div>
              ):(
                Object.keys(weekGroups).sort((a,b)=>b.localeCompare(a)).map(k=>(
                  <SummaryBlock key={k} entries={weekGroups[k]} elevations={elevations}
                    label={`Week ${k}  (${weekGroups[k][0].date} → ${weekGroups[k][weekGroups[k].length-1].date})`}/>
                ))
              )}</div>
            )}
            {summaryView==="monthly" && (
              <div>{Object.keys(monthGroups).length===0?(
                <div style={{textAlign:"center",color:"#3a5080",padding:"40px 0"}}>No entries yet.</div>
              ):(
                Object.keys(monthGroups).sort((a,b)=>b.localeCompare(a)).map(k=>(
                  <SummaryBlock key={k} entries={monthGroups[k]} elevations={elevations}
                    label={monthLabel(k)}/>
                ))
              )}</div>
            )}
          </div>
        )}
      </div>

      {/* ── Edit Modal ── */}
      {editEntry && (
        <EditModal entry={editEntry} elevations={elevations} tenure={tenure}
          onSave={handleEditSave} onClose={()=>setEditEntry(null)}/>
      )}
    </div>
  );
}

// ── Streak calculator ─────────────────────────────────────────────────────────
function calcStreak(entries) {
  if(!entries.length) return 0;
  const workDays = [...entries].filter(e=>e.isWorking && e.achieved)
    .sort((a,b)=>b.date.localeCompare(a.date));
  if(!workDays.length) return 0;
  let streak=1;
  for(let i=1;i<workDays.length;i++){
    const prev=new Date(workDays[i-1].date+"T00:00:00");
    const curr=new Date(workDays[i].date+"T00:00:00");
    const diff=(prev-curr)/86400000;
    if(diff<=3) streak++; else break; // allow weekends in gap
  }
  return streak;
}

// ── History Card ──────────────────────────────────────────────────────────────
function HistoryCard({ entry, elevations, tenure, onDelete, onEdit }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{background:"#111d3a",border:`1px solid ${entry.achieved?"#2a5a2a":"#1e3060"}`,
      borderRadius:14,padding:"14px 18px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
        cursor:"pointer"}} onClick={()=>setExpanded(o=>!o)}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div>
            <span style={{color:"#f5a623",fontWeight:700,fontSize:15}}>{entry.date}</span>
            <span style={{color:"#5a7aaa",marginLeft:8,fontSize:12}}>{entry.day}</span>
            {!entry.isWorking&&<span style={{marginLeft:8,fontSize:10,color:"#9b59b6",
              background:"rgba(155,89,182,0.15)",padding:"2px 7px",borderRadius:5}}>Holiday</span>}
            {entry.notes&&<span style={{marginLeft:8,fontSize:10,color:"#5a7aaa"}}>📝</span>}
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,
            background:entry.achieved?"rgba(76,175,80,0.2)":"rgba(224,80,80,0.15)",
            color:entry.achieved?"#4caf50":"#e05050"}}>
            {entry.achieved?"✅ Met":"⏳ Not Met"}
          </span>
          <span style={{color:"#5a7aaa",fontSize:13}}>{expanded?"▲":"▼"}</span>
        </div>
      </div>

      {expanded && (
        <div style={{marginTop:14}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
            {[
              ["Shift Hrs",      entry.shiftHrs+"h"],
              ["Downtime",       (entry.downtime||0)+"h"],
              ["Effective Hrs",  (entry.effHrs||0)+"h"],
              ["Prohance Hrs",   (entry.prohance||0)+"h"],
              ["Hrs Produced",   (entry.totalHrsProd||fmt2(entry.counts?.reduce((a,c,i)=>a+hrsProduced(c,elevations[i]?.cph||1),0)||0))+"h"],
              ["Production %",   (entry.prodPct||0)+"%"],
              ["Approved OT",    (entry.approvedOT||0)+"h"],
              ["OT Amount",      "₹"+(entry.otAmt||0)],
            ].map(([l,v])=>(
              <div key={l} style={{background:"#0a1228",borderRadius:8,padding:"8px 6px",textAlign:"center"}}>
                <div style={{color:"#5a7aaa",fontSize:9}}>{l}</div>
                <div style={{color:"#a8c4e0",fontWeight:600,fontSize:12}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {elevations.map((e,i)=>{
              const cnt   = entry.counts?.[i]??0;
              const hrsPr = entry.hrsPerElev?.[i] ?? hrsProduced(cnt, e.cph);
              const effH  = entry.effHrs||0;
              const epct  = effH>0 ? fmt2(hrsPr/effH*100) : 0;
              return (
                <div key={i} style={{background:"#0d1830",borderRadius:7,padding:"5px 10px",
                  fontSize:11,color:"#a8c4e0",border:`1px solid ${epct>=100?"#2a5a2a":"#1e3060"}`}}>
                  <span style={{color:"#f5a623"}}>{e.name}:</span>{" "}
                  {cnt} counts · {hrsPr}h{epct>=100?" ✅":""}
                </div>
              );
            })}
          </div>
          {entry.notes && (
            <div style={{background:"#0d1830",borderRadius:8,padding:"8px 12px",
              color:"#a8c4e0",fontSize:12,marginBottom:10,borderLeft:"3px solid #f5a623"}}>
              📝 {entry.notes}
            </div>
          )}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={onEdit} style={{background:"rgba(245,166,35,0.12)",border:"1px solid #f5a623",
              color:"#f5a623",borderRadius:7,padding:"5px 14px",cursor:"pointer",fontSize:12,fontWeight:600}}>
              ✏️ Edit
            </button>
            <button onClick={onDelete} style={{background:"rgba(224,80,80,0.1)",border:"1px solid #e05050",
              color:"#e05050",borderRadius:7,padding:"5px 14px",cursor:"pointer",fontSize:12,fontWeight:600}}>
              🗑 Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
function EditModal({ entry, elevations, tenure, onSave, onClose }) {
  const [counts,      setCounts]      = useState(entry.counts.map(String));
  const [downtime,    setDowntime]    = useState(String(entry.downtime));
  const [prohance,    setProhance]    = useState(String(entry.prohance));
  const [approvedOT,  setApprovedOT]  = useState(String(entry.approvedOT));
  const [notes,       setNotes]       = useState(entry.notes||"");
  const [isWorking,   setIsWorking]   = useState(entry.isWorking);
  const [dayType,     setDayType]     = useState(entry.dayType);

  const shiftHrs    = isWorking?(dayType==="full"?8.5:5):0;
  const effHrs      = effHrsCalc(shiftHrs, downtime);
  const achieved    = counts.map(c=>Math.max(0,parseFloat(c)||0));
  const hrsPrElev   = elevations.map((e,i)=>hrsProduced(achieved[i],e.cph));
  const totHrsProd  = fmt2(hrsPrElev.reduce((a,b)=>a+b,0));
  const totAch      = fmt2(achieved.reduce((a,b)=>a+b,0));
  const epct        = effHrs>0?fmt2(totHrsProd/effHrs*100):0;
  const {otHrs,otAmt} = calcOT(approvedOT, prohance, shiftHrs, tenure);

  const save = () => {
    onSave({
      ...entry,
      isWorking, dayType, shiftHrs, effHrs,
      downtime:    fmt2(parseFloat(downtime)||0),
      prohance:    fmt2(parseFloat(prohance)||0),
      approvedOT:  fmt2(parseFloat(approvedOT)||0),
      counts:      [...achieved],
      hrsPerElev:  [...hrsPrElev],
      totalHrsProd:totHrsProd,
      prodPct:     epct,
      totalAchieved:totAch,
      otHrs, otAmt,
      achieved:    epct>=100,
      notes:       notes.trim(),
    });
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(10,18,40,0.88)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:888,padding:16}}>
      <div style={{background:"#111d3a",border:"1px solid #1e3060",borderRadius:18,
        padding:"28px 28px",width:"100%",maxWidth:560,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div style={{color:"#f5a623",fontWeight:700,fontSize:16}}>Edit Entry — {entry.date} ({entry.day})</div>
          <button onClick={onClose} style={{background:"transparent",border:"none",
            color:"#5a7aaa",fontSize:20,cursor:"pointer"}}>✕</button>
        </div>

        {/* Status / Shift */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
          <div>
            <label style={lbl}>Day Status</label>
            <div style={{display:"flex",gap:8}}>
              {[["true","Working"],["false","Holiday"]].map(([v,l])=>(
                <button key={v} onClick={()=>setIsWorking(v==="true")} style={{
                  flex:1,padding:"8px 0",borderRadius:8,border:"1.5px solid",
                  borderColor:String(isWorking)===v?"#4caf50":"#1e3060",
                  background:String(isWorking)===v?"rgba(76,175,80,0.15)":"transparent",
                  color:String(isWorking)===v?"#4caf50":"#5a7aaa",
                  cursor:"pointer",fontWeight:600,fontSize:12}}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={lbl}>Shift Type</label>
            <div style={{display:"flex",gap:8}}>
              {[["full","Full"],["half","Half"]].map(([v,l])=>(
                <button key={v} disabled={!isWorking} onClick={()=>setDayType(v)} style={{
                  flex:1,padding:"8px 0",borderRadius:8,border:"1.5px solid",
                  borderColor:dayType===v&&isWorking?"#f5a623":"#1e3060",
                  background:dayType===v&&isWorking?"rgba(245,166,35,0.15)":"transparent",
                  color:dayType===v&&isWorking?"#f5a623":isWorking?"#5a7aaa":"#2a4060",
                  cursor:isWorking?"pointer":"not-allowed",fontWeight:600,fontSize:12}}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
          {[["Downtime (hrs)",downtime,setDowntime],["Prohance Hrs",prohance,setProhance],
            ["Approved OT Hrs",approvedOT,setApprovedOT]].map(([label,val,setter])=>(
            <div key={label}>
              <label style={lbl}>{label}</label>
              <input style={{...inp,marginBottom:0}} type="number" min="0" step="0.25"
                value={val} onChange={e=>setter(e.target.value)}/>
            </div>
          ))}
        </div>

        <label style={lbl}>Counts per Elevation</label>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
          {elevations.map((e,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"1.3fr 0.6fr 1fr 0.8fr",gap:8,
              alignItems:"center",background:"#0d1830",borderRadius:9,padding:"10px 12px",border:"1px solid #1e3060"}}>
              <div style={{color:"#a8c4e0",fontSize:13,fontWeight:600}}>{e.name}</div>
              <div style={{textAlign:"center"}}>
                <div style={{color:"#5a7aaa",fontSize:9}}>CPH/hr</div>
                <div style={{color:"#f5a623",fontWeight:700,fontSize:13}}>{e.cph}</div>
              </div>
              <input style={{...inp,marginBottom:0,textAlign:"center"}} type="number" min="0"
                placeholder="Achieved count" value={counts[i]}
                onChange={ev=>{const c=[...counts];c[i]=ev.target.value;setCounts(c);}}/>
              <div style={{textAlign:"center"}}>
                <div style={{color:"#5a7aaa",fontSize:9}}>Hrs produced</div>
                <div style={{color:"#5a9fd4",fontWeight:700,fontSize:13}}>{hrsPrElev[i]}h</div>
              </div>
            </div>
          ))}
          <div style={{background:"#0a1228",borderRadius:8,padding:"8px 12px",
            display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{color:"#5a7aaa",fontSize:12}}>Total hrs produced: <b style={{color:"#5a9fd4"}}>{totHrsProd}h</b></span>
            <span style={{color:"#5a7aaa",fontSize:12}}>Production: <b style={{
              color:epct>=100?"#4caf50":epct>=80?"#f5a623":"#e05050"}}>{epct}%</b></span>
          </div>
        </div>

        <label style={lbl}>Notes</label>
        <textarea style={{...inp,marginBottom:14,resize:"vertical",minHeight:50}}
          value={notes} onChange={e=>setNotes(e.target.value)}/>

        <div style={{background:"#0d1830",borderRadius:10,padding:"10px 14px",marginBottom:16,
          display:"flex",gap:16,flexWrap:"wrap"}}>
          {[["Production",epct+"%",epct>=100?"#4caf50":"#e07050"],["Count",totAch,"#a8c4e0"],
            ["OT Hrs",otHrs+"h","#9b59b6"],["OT Amt","₹"+otAmt,"#9b59b6"]].map(([l,v,c])=>(
            <div key={l}><span style={{color:"#5a7aaa",fontSize:11}}>{l}: </span>
              <span style={{color:c,fontWeight:700,fontSize:13}}>{v}</span></div>
          ))}
        </div>

        <div style={{display:"flex",gap:10}}>
          <button onClick={save} style={{flex:1,padding:"11px",borderRadius:9,border:"none",
            background:"linear-gradient(135deg,#f5a623,#e8921a)",color:"#0a1228",
            fontWeight:700,fontSize:14,cursor:"pointer"}}>Save Changes ✓</button>
          <button onClick={onClose} style={{padding:"11px 20px",borderRadius:9,
            border:"1px solid #1e3060",background:"transparent",color:"#5a7aaa",
            cursor:"pointer",fontSize:14}}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [profile, setProfile] = useState(null);
  const [ready,   setReady]   = useState(false);

  useEffect(()=>{
    loadStorage(PROFILE_KEY).then(p=>{ if(p) setProfile(p); setReady(true); });
  },[]);

  if(!ready) return (
    <div style={{minHeight:"100vh",background:"#0a1228",display:"flex",alignItems:"center",
      justifyContent:"center",color:"#5a7aaa",fontSize:16}}>Loading…</div>
  );
  if(!profile) return <SetupScreen onDone={setProfile}/>;
  return <Tracker profile={profile}
    onReset={()=>{ setProfile(null); saveStorage(PROFILE_KEY,null); }}/>;
}
