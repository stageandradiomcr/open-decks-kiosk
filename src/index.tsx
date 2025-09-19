/* === Open Decks – Kiosk Sign-up & Random Slot Picker (Europe/London) === */
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateTime, Interval } from "luxon";
import { v4 as uuid } from "uuid";

// ===== Config
const ZONE = "Europe/London";
const MAX_SLOTS_PER_WINDOW = 4; // 4 × 30m
const SIGNUP_COOLDOWN_SECONDS = 60; // default 1-minute cooldown (toggle in Admin)
const ADMIN_PIN = "1796";
const YELLOW = "text-yellow-400";

// Yellow/Black theme helpers
const BTN_PRIMARY = "bg-yellow-400 text-black font-semibold hover:bg-yellow-300";
const BTN_SECONDARY = "bg-black text-yellow-400 border border-yellow-400 hover:bg-yellow-600 hover:text-black";

// Types
type Gender = "male" | "female" | "non-binary" | "prefer-not-to-say" | "duo";
type GenderOrBlank = Gender | ""; // blank forces selection
const isMaleish = (g: Gender) => g === "male" || g === "duo";

// ===== Time helpers
function nowUK() { return DateTime.now().setZone(ZONE); }
function tonightBase(date = nowUK()) { return (date.hour < 5 ? date.minus({ days: 1 }) : date).startOf("day"); }
function tonightWindows(base = tonightBase()) {
  const draw1Time = base.plus({ hours: 22, minutes: 45 });
  const draw2Time = base.plus({ days: 1, hours: 0, minutes: 45 });
  const window1 = Interval.fromDateTimes(base.plus({ hours: 23 }), base.plus({ days: 1, hours: 1 }));
  const window2 = Interval.fromDateTimes(base.plus({ days: 1, hours: 1 }), base.plus({ days: 1, hours: 3 }));
  return { draw1Time, draw2Time, window1, window2 };
}
const fmt = (iso: string) => DateTime.fromISO(iso).setZone(ZONE).toFormat("HH:mm");
const shuffle = <T,>(arr: T[]) => { const a = [...arr]; for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const normalizeName = (s: string) => (s||"").trim().replace(/\s+/g," ").toLowerCase();
function generateSlots(interval: Interval, minutes=30, maxSlots=MAX_SLOTS_PER_WINDOW){
  const slots: {id:string; startISO:string; endISO:string}[] = [];
  let c = interval.start; while (c < interval.end){ const e=c.plus({minutes}); if(e>interval.end) break; slots.push({id:uuid(), startISO:c.toISO()!, endISO:e.toISO()!}); if(slots.length>=maxSlots) break; c=e; }
  return slots;
}
function canSubmit(lastISO: string|null, current=nowUK(), cooldownSeconds=SIGNUP_COOLDOWN_SECONDS){ if(!lastISO) return true; const last=DateTime.fromISO(lastISO).setZone(ZONE); return current >= last.plus({seconds: cooldownSeconds}); }

export default function OpenDecksKiosk(){
  // Session state
  const [state, setState] = useState({
    signups: [] as {id:string; name:string; gender:Gender; createdISO:string}[],
    assigned: { window1: [] as any[], window2: [] as any[] },
    lastDrawISO: null as string | null,
    lastSignupISO: null as string | null,
  });
  const [name, setName] = useState("");
  const [gender, setGender] = useState<GenderOrBlank>(""); // blank until user chooses
  const [status, setStatus] = useState("");
  const [pinOK, setPinOK] = useState(false);
  const [pinTry, setPinTry] = useState("");
  const [drawPin, setDrawPin] = useState("");
  const [drawPasswordMode, setDrawPasswordMode] = useState<1|2|null>(null);
  const [manualInputs, setManualInputs] = useState<Record<string,string>>({});
  const [cooldownEnabled, setCooldownEnabled] = useState(true);
  const [tick, setTick] = useState(0); // live timers

  // helper: look up if a name is male-ish (male or duo)
  const isMaleishName = (n:string) => {
    const g = state.signups.find(s=>normalizeName(s.name)===normalizeName(n))?.gender as Gender | undefined;
    return g === "male" || g === "duo";
  };

  // Schedule + slots
  const base = useMemo(() => tonightBase(), []);
  const { draw1Time, draw2Time, window1, window2 } = useMemo(() => tonightWindows(base), [base]);
  const slots1 = useMemo(() => generateSlots(window1), [window1]);
  const slots2 = useMemo(() => generateSlots(window2), [window2]);

  // Live tick
  useEffect(()=>{ const iv = setInterval(()=>setTick(t=>t+1),1000); return ()=>clearInterval(iv); },[]);

  // Auto draws when open at the minute
  useEffect(()=>{ const iv = setInterval(()=>{
    const t = nowUK();
    if (t >= draw1Time && t < draw1Time.plus({minutes:1}) && state.assigned.window1.length===0) runDraw(1);
    if (t >= draw2Time && t < draw2Time.plus({minutes:1}) && state.assigned.window2.length===0) runDraw(2);
  }, 5000); return ()=>clearInterval(iv); }, [draw1Time, draw2Time, state.assigned.window1.length, state.assigned.window2.length]);

  // Helpers for global uniqueness (one slot per artist across night)
  const assignedNamesIn = (which:1|2) => new Set((state.assigned[which===1?"window1":"window2"]||[]).map((a:any)=>normalizeName(a.participant)));
  const assignedNamesGlobal = () => new Set([...assignedNamesIn(1), ...assignedNamesIn(2)]);
  const availablePoolForWindow = (which:1|2) => state.signups.filter(s => !(which===1?assignedNamesIn(2):assignedNamesIn(1)).has(normalizeName(s.name)));
  const remainingNames = (which:1|2) => state.signups.filter(s => !assignedNamesGlobal().has(normalizeName(s.name))).map(s=>s.name);

  // UI helpers
  function pulse(msg:string){ setStatus(msg); setTimeout(()=>setStatus(""), 3000); }
  const countdownTo = (target:DateTime)=>{ const t=nowUK(); const diff=target.diff(t,["hours","minutes","seconds"]).toObject(); if(target<=t) return "00:00:00"; const pad=(n?:number)=>String(Math.max(0,Math.floor(n??0))).padStart(2,"0"); return `${pad(diff.hours)}:${pad(diff.minutes)}:${pad(diff.seconds)}`; };

  // Core gender-aware pick helper (≤50% male unless other categories are insufficient)
  function pickWithGenderCap(entries: {name:string; gender:Gender}[], count:number){
    const male = entries.filter(e=>isMaleish(e.gender));
    const other = entries.filter(e=>!isMaleish(e.gender));
    const maleCap = Math.floor(count/2);
    let pickMale = Math.min(maleCap, male.length);
    let pickOther = Math.min(count - pickMale, other.length);
    let remaining = count - (pickMale + pickOther);
    if (remaining > 0){
      const extraMale = Math.min(remaining, male.length - pickMale); pickMale += extraMale; remaining -= extraMale;
      const extraOther = Math.min(remaining, other.length - pickOther); pickOther += extraOther; remaining -= extraOther;
    }
    const malePicks = shuffle(male).slice(0, pickMale);
    const otherPicks = shuffle(other).slice(0, pickOther);
    return shuffle([...malePicks, ...otherPicks]);
  }

  // Actions
  function addSignup(e?:React.FormEvent){
    e?.preventDefault();
    const trimmed = name.trim();
    if(!trimmed){ pulse("Please enter a DJ name."); return; }
    if (gender === ""){ pulse("Please select a gender option."); return; }
    if (!canSubmit(state.lastSignupISO, undefined, cooldownEnabled?SIGNUP_COOLDOWN_SECONDS:0)) { pulse("Please wait a minute before the next sign-up."); return; }
    const exists = state.signups.some(s=>normalizeName(s.name)===normalizeName(trimmed)); if(exists){ pulse("That name is already signed up."); return; }
    const entry = { id: uuid(), name: trimmed, gender: gender as Gender, createdISO: nowUK().toISO()! };
    setState(prev=>({...prev, signups:[...prev.signups, entry], lastSignupISO: entry.createdISO }));
    setName(""); setGender("");
    pulse("Added! Good luck in the draw.");
  }

  function clearAll(){ if(!confirm("Clear ALL sign-ups and set times?")) return; setState({ signups:[], assigned:{window1:[], window2:[]}, lastDrawISO:null, lastSignupISO:null }); setName(""); pulse("Everything cleared."); }

  function exportCSV(){ const rows=[["Name","Gender","Signed Up (UK)"]]; state.signups.forEach(s=>rows.push([s.name, s.gender, DateTime.fromISO(s.createdISO).setZone(ZONE).toFormat("yyyy-LL-dd HH:mm")])); const csv=rows.map(r=>r.map(c=>`"${String(c).replaceAll('"','""')}"`).join(",")).join("\n"); const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`open-decks-signups-${nowUK().toFormat("yyyyLLdd-HHmm")}.csv`; a.click(); URL.revokeObjectURL(url); }

  function runDraw(which:1|2){
    const pool = availablePoolForWindow(which);
    if(pool.length===0){ pulse("No sign-ups available for this window."); return; }
    const slots = which===1?slots1:slots2;
    const n=Math.min(pool.length, slots.length);
    const picks = pickWithGenderCap(pool, n);
    const assignments = slots.slice(0, picks.length).map((slot,i)=>({slotId:slot.id,startISO:slot.startISO,endISO:slot.endISO,participant:picks[i].name}));
    const key=which===1?"window1":"window2";
    setState(prev=>({...prev, assigned:{...prev.assigned,[key]:assignments}, lastDrawISO: nowUK().toISO()}));
    setDrawPasswordMode(null); setDrawPin("");
    pulse(`Draw complete for ${which===1?"23:00 – 01:00":"01:00 – 03:00"}.`);
  }

  function redrawWindow(which:1|2){
    const pool=availablePoolForWindow(which);
    if(pool.length===0){ pulse("No sign-ups available for this window."); return; }
    const slots=which===1?slots1:slots2; const n=Math.min(pool.length, slots.length);
    const picks = pickWithGenderCap(pool, n);
    const assigns=slots.slice(0,picks.length).map((slot,i)=>({slotId:slot.id,startISO:slot.startISO,endISO:slot.endISO,participant:picks[i].name}));
    const key=which===1?"window1":"window2";
    setState(prev=>({...prev, assigned:{...prev.assigned, [key]: assigns}, lastDrawISO: nowUK().toISO()}));
    pulse("Window re-drawn.");
  }

  function rerollSlot(which:1|2, slotId:string){
    const key = which===1?"window1":"window2" as const;
    const current = state.assigned[key]||[];
    const size=current.length; if(size===0) return;
    const cap=Math.floor(size/2);
    const currentMaleExcl = current.filter((a:any)=> a.slotId!==slotId && isMaleishName(a.participant)).length;
    const candidates = availablePoolForWindow(which).filter(c=> !isMaleish(c.gender) || currentMaleExcl < cap );
    if(candidates.length===0){ pulse("No remaining candidates that satisfy the 50% male cap."); return; }
    const pick = candidates[Math.floor(Math.random()*candidates.length)];
    setState(prev=>({...prev, assigned:{...prev.assigned,[key]: prev.assigned[key].map((a:any)=> a.slotId===slotId?{...a, participant: pick.name}:a)}}));
    pulse("Slot re-rolled.");
  }

  function manualReplace(which:1|2, slotId:string, newName:string){
    const trimmed=(newName||"").trim(); if(!trimmed){ pulse("Enter a name to replace with."); return; }
    const key=which===1?"window1":"window2" as const; const otherKey=which===1?"window2":"window1" as const;
    const norm=normalizeName(trimmed);
    const dupeInThis=(state.assigned[key]||[]).some((a:any)=>normalizeName(a.participant)===norm && a.slotId!==slotId);
    const dupeInOther=(state.assigned[otherKey]||[]).some((a:any)=>normalizeName(a.participant)===norm);
    if(dupeInThis||dupeInOther){ pulse("That artist already has a slot tonight."); return; }
    const size=(state.assigned[key]||[]).length; const cap=Math.floor(size/2);
    const currentMaleExcl=(state.assigned[key]||[]).filter((a:any)=>a.slotId!==slotId && isMaleishName(a.participant)).length;
    const replacingGender = state.signups.find(s=>normalizeName(s.name)===norm)?.gender || "prefer-not-to-say";
    if (isMaleish(replacingGender as Gender) && currentMaleExcl>=cap){ pulse("Male cap (50%) reached for this window. Choose a different artist."); return; }
    setState(prev=>({...prev, assigned:{...prev.assigned,[key]: prev.assigned[key].map((a:any)=> a.slotId===slotId?{...a, participant: trimmed}:a)}}));
    pulse("Slot updated.");
  }

  // UI bits
  function KioskHeader(){ const now = nowUK(); return (
    <div className="flex items-center justify-between w-full mb-4">
      <div className={`text-2xl font-bold ${YELLOW}`}>Stage & Radio: Open Decks – Registration Draw</div>
      <div className="text-right">
        <div className="text-sm">Local time ({ZONE})</div>
        <div className="font-mono text-lg">{now.toFormat("EEE d LLL yyyy • HH:mm:ss")}</div>
      </div>
    </div>
  ); }

  function SetTimesList({title, list}:{title:string; list:any[]}){ return (
    <Card className="w-full bg-black border border-white/10 text-white">
      <CardContent className="p-4">
        <div className={`text-xl font-semibold mb-2 ${YELLOW}`}>{title}</div>
        {list.length===0? <div className="text-base text-white/90">No set times yet. They will appear here after the draw.</div> : (
          <ul className="space-y-2">
            {list.map((a:any)=> (
              <li key={a.slotId} className="flex items-center justify-between bg-neutral-800 p-3 rounded-xl">
                <div className="font-mono text-lg w-28 text-white">{fmt(a.startISO)} – {fmt(a.endISO)}</div>
                <div className="text-xl font-semibold flex-1 text-center text-white">{a.participant}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  ); }

  const window1Countdown = countdownTo(draw1Time);
  const window2Countdown = countdownTo(draw2Time);
  const canSubmitForm = name.trim().length > 0 && gender !== "";

  return (
    <div className="min-h-screen w-full bg-black text-white p-4 md:p-8">
      <div className="max-w-5xl mx-auto grid grid-cols-1 gap-4">
        <KioskHeader />

        {/* Big, wide sign-up box */}
        <Card className="bg-black border-2 border-yellow-400/70 shadow-[0_0_40px_rgba(250,204,21,0.25)] text-white">
          <CardContent className="p-6 md:p-8">
            <div className={`text-2xl md:text-3xl font-bold mb-4 ${YELLOW}`}>Add Your Name</div>
            <form onSubmit={addSignup} className="flex flex-col lg:flex-row gap-3">
              <Input
                value={name}
                onChange={(e)=>setName(e.target.value)}
                placeholder="Enter DJ name (solo or duo)"
                required
                className="flex-1 text-xl md:text-2xl h-14 md:h-16 bg-neutral-900 border-white/40 text-white placeholder-white/70"
              />

              <select
                value={gender}
                onChange={(e)=>setGender(e.target.value as GenderOrBlank)}
                required
                className="appearance-none h-14 md:h-16 rounded-lg px-3 font-semibold bg-black text-yellow-400 border border-yellow-400 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                style={{ WebkitAppearance: "none" }}
              >
                <option value="" disabled>Select gender…</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="non-binary">Non-binary</option>
                <option value="duo">Duo</option>
                <option value="prefer-not-to-say">Prefer not to say</option>
              </select>

              <Button type="submit" disabled={!canSubmitForm} className={`${BTN_PRIMARY} disabled:opacity-50 disabled:pointer-events-none text-lg md:text-xl h-14 md:h-16 px-8`}>
                Submit
              </Button>
              <Button type="button" variant="secondary" className={`${BTN_SECONDARY} h-14 md:h-16 px-6`} onClick={()=>{ setName(""); setGender(""); }}>
                Clear
              </Button>
            </form>
            {status && <div className="mt-3 text-green-400 text-base">{status}</div>}
          </CardContent>
        </Card>

        {/* Live Info + Public sign-ups */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="bg-black border border-white/10 text-white">
            <CardContent className="p-4 space-y-3">
              <div className={`text-xl font-semibold ${YELLOW}`}>Tonight's Draws</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-neutral-800 shadow-sm">
                  <div className="text-base text-white/80">Draw for 23:00 – 01:00</div>
                  <div className="text-2xl font-bold font-mono text-white">{draw1Time.toFormat("HH:mm")}</div>
                  <div className="text-sm mt-1 text-white/80">Countdown</div>
                  <div className="font-mono text-lg text-white">{window1Countdown}</div>
                </div>
                <div className="p-3 rounded-xl bg-neutral-800 shadow-sm">
                  <div className="text-base text-white/80">Draw for 01:00 – 03:00</div>
                  <div className="text-2xl font-bold font-mono text-white">{draw2Time.toFormat("HH:mm")}</div>
                  <div className="text-sm mt-1 text-white/80">Countdown</div>
                  <div className="font-mono text-lg text-white">{window2Countdown}</div>
                </div>
              </div>
              <div className="text-base text-white/80">Sign-ups so far: {state.signups.length}</div>
            </CardContent>
          </Card>

          <Card className="bg-black border border-white/10 text-white">
            <CardContent className="p-4">
              <div className={`text-xl font-semibold mb-2 ${YELLOW}`}>Signed Up (So Far)</div>
              {state.signups.length===0? (
                <div className="text-base text-white/80">No one has signed up yet. Add your name above.</div>
              ) : (
                <ul className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto">
                  {[...state.signups].sort((a,b)=> (b.createdISO||"").localeCompare(a.createdISO||""))
                    .map(s=> (
                      <li key={s.id} className="bg-neutral-800 rounded-xl px-3 py-2 flex items-center justify-between shadow-sm">
                        <span className="font-medium truncate text-white">{s.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm text-white/70">{DateTime.fromISO(s.createdISO).setZone(ZONE).toFormat("HH:mm")}</span>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Set Times */}
        <div className="grid md:grid-cols-2 gap-4">
          <SetTimesList title="23:00 – 01:00 Set Times" list={state.assigned.window1} />
          <SetTimesList title="01:00 – 03:00 Set Times" list={state.assigned.window2} />
        </div>

        {/* Admin Section */}
        <Card className="bg-black border border-white/10 text-white">
          <CardContent className="p-4 space-y-4">
            {!pinOK ? (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <div className={`text-base mb-1 ${YELLOW}`}>Admin PIN</div>
                  <Input value={pinTry} onChange={(e)=>setPinTry(e.target.value)} placeholder="Enter staff PIN" type="password" className="bg-neutral-900 border-white/30 text-white placeholder-white/60" />
                </div>
                <Button className={`${BTN_PRIMARY} px-5 py-2`} onClick={()=>setPinOK(pinTry===ADMIN_PIN)}>Unlock</Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className={`text-xl font-semibold ${YELLOW}`}>Admin Controls</div>
                <div className="flex flex-wrap gap-2 items-center">
                  <Button variant="secondary" className={`${BTN_SECONDARY} px-4 py-2`} onClick={exportCSV}>Export sign-ups (CSV)</Button>
                  <Button variant="secondary" className={`${BTN_SECONDARY} px-4 py-2`} onClick={()=>setDrawPasswordMode(1)}>Run 23:00 – 01:00 draw now</Button>
                  <Button variant="secondary" className={`${BTN_SECONDARY} px-4 py-2`} onClick={()=>setDrawPasswordMode(2)}>Run 01:00 – 03:00 draw now</Button>
                  <Button variant="destructive" className="bg-red-600 hover:bg-red-500 px-4 py-2" onClick={clearAll}>Clear all</Button>

                  <div className="ml-auto flex items-center gap-2 bg-neutral-800 border border-white/20 rounded-lg px-3 py-2">
                    <span className="text-sm text-white/80">Sign-up cooldown</span>
                    <Button variant={cooldownEnabled?"secondary":"default"} className={`${cooldownEnabled?BTN_SECONDARY:BTN_PRIMARY} px-3 py-1 text-sm`} onClick={()=>setCooldownEnabled(v=>!v)}>
                      {cooldownEnabled?"On (1 min)":"Off"}
                    </Button>
                  </div>
                </div>

                {drawPasswordMode && (
                  <div className="mt-1 space-y-2">
                    <div className="text-base text-white/90">Enter staff PIN to confirm draw</div>
                    <Input value={drawPin} onChange={(e)=>setDrawPin(e.target.value)} type="password" placeholder="PIN" className="bg-neutral-900 border-white/30 text-white placeholder-white/60" />
                    <div className="flex gap-2">
                      <Button className={`${BTN_PRIMARY} px-5 py-2`} onClick={()=>{ if(drawPin===ADMIN_PIN){ runDraw(drawPasswordMode!); } else { pulse("Wrong PIN"); } }}>Confirm Draw</Button>
                      <Button variant="secondary" className={`${BTN_SECONDARY} px-4 py-2`} onClick={()=>{ setDrawPasswordMode(null); setDrawPin(""); }}>Cancel</Button>
                    </div>
                  </div>
                )}

                <div className="grid md:grid-cols-2 gap-4">
                  {[1,2].map(w=>{ const which = w as 1|2; const key = which===1?"window1":"window2" as const; const title = which===1?"Manage 23:00 – 01:00":"Manage 01:00 – 03:00"; const items = state.assigned[key]; return (
                    <Card key={which} className="bg-neutral-900 border border-white/20">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className={`text-lg font-semibold ${YELLOW}`}>{title}</div>
                          <Button variant="secondary" className={`${BTN_SECONDARY} px-4 py-2 text-base`} onClick={()=>redrawWindow(which)}>Re-draw window</Button>
                        </div>
                        {(!items||items.length===0)? (
                          <div className="text-base text-white/80">No set times yet for this window.</div>
                        ) : (
                          <ul className="space-y-2">
                            {items.map((a:any)=>{ const k=`${which}-${a.slotId}`; const badge = state.signups.find(s=>normalizeName(s.name)===normalizeName(a.participant))?.gender; return (
                              <li key={a.slotId} className="bg-neutral-800 rounded-xl p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="font-mono w-28 text-white text-lg">{fmt(a.startISO)} – {fmt(a.endISO)}</div>
                                  <div className="flex-1 font-semibold text-white text-lg flex items-center gap-2">
                                    <span>{a.participant}</span>
                                    {badge && <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-700 text-white/90 capitalize">{badge.replace("prefer-not-to-say","prefer not")}</span>}
                                  </div>
                                  <div className="flex gap-2">
                                    <Button variant="secondary" className={`${BTN_SECONDARY} px-4 py-2 text-base`} onClick={()=>rerollSlot(which, a.slotId)}>Re-roll</Button>
                                  </div>
                                </div>
                                <div className="mt-2 flex items-center gap-2">
                                  <Input value={manualInputs[k]||""} onChange={(e)=>setManualInputs(m=>({...m,[k]:e.target.value}))} placeholder="Replace with name" className="h-10 bg-neutral-800 border-white/30 text-white placeholder-white/60 flex-1 px-3" />
                                  <Button className={`${BTN_PRIMARY} px-4 py-2 text-base`} onClick={()=>manualReplace(which, a.slotId, manualInputs[k])}>Replace</Button>
                                </div>
                              </li>
                            ); })}
                          </ul>
                        )}
                        <div className="text-sm text-white/80">Unassigned names available: {remainingNames(which).length}</div>
                      </CardContent>
                    </Card>
                  ); })}
                </div>

                <div>
                  <div className="text-base font-semibold mb-2">Current sign-ups</div>
                  <ul className="divide-y rounded-xl overflow-hidden border border-white/10">
                    {state.signups.length===0 && <li className="p-3 text-base text-white/70">No one yet.</li>}
                    {state.signups.map(s=> (
                      <li key={s.id} className="p-3 flex items-center justify-between bg-neutral-800">
                        <div className="font-medium text-white flex items-center gap-2">
                          <span>{s.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-700 text-white/90 capitalize">{s.gender.replace("prefer-not-to-say","prefer not")}</span>
                        </div>
                        <div className="font-mono text-sm text-white/70">{DateTime.fromISO(s.createdISO).setZone(ZONE).toFormat("HH:mm")}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}