import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateTime, Interval } from "luxon";
import { v4 as uuid } from "uuid";

// =============================
// Config / Constants
// =============================
const ZONE = "Europe/London"; // Handles GMT/BST automatically
const MAX_SLOTS_PER_WINDOW = 4; // Always 4 × 30‑min slots (even on DST fall‑back)
const SIGNUP_COOLDOWN_SECONDS = 60; // 1 per minute
const ADMIN_PIN = "1796"; // staff pin
const YELLOW = "text-yellow-400"; // heading colour

// =============================
// Time Helpers
// =============================
function nowUK() {
  return DateTime.now().setZone(ZONE);
}

function tonightBase(date = nowUK()) {
  // Treat 00:00–04:59 as part of the previous "night"
  return (date.hour < 5 ? date.minus({ days: 1 }) : date).startOf("day");
}

function tonightWindows(base = tonightBase()) {
  // Draw trigger times
  const draw1Time = base.plus({ hours: 22, minutes: 45 }); // 22:45 tonight
  const draw2Time = base.plus({ days: 1, hours: 0, minutes: 45 }); // 00:45 next day

  // Playing windows
  const window1Start = base.plus({ hours: 23 }); // 23:00
  const window1End = base.plus({ days: 1, hours: 1 }); // 01:00 next day

  const window2Start = base.plus({ days: 1, hours: 1 }); // 01:00 next day
  const window2End = base.plus({ days: 1, hours: 3 }); // 03:00 next day

  return {
    draw1Time,
    draw2Time,
    window1: Interval.fromDateTimes(window1Start, window1End),
    window2: Interval.fromDateTimes(window2Start, window2End),
  };
}

function fmt(dtISO) {
  return DateTime.fromISO(dtISO).setZone(ZONE).toFormat("HH:mm");
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Normalize names to prevent duplicates regardless of case/spacing
function normalizeName(s) {
  return (s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// =============================
// Slot Generation
// =============================
function generateSlots(interval, minutes = 30, maxSlots = MAX_SLOTS_PER_WINDOW) {
  const slots = [];
  let cursor = interval.start;
  while (cursor < interval.end) {
    const end = cursor.plus({ minutes });
    if (end > interval.end) break;
    slots.push({ id: uuid(), startISO: cursor.toISO(), endISO: end.toISO() });
    if (slots.length >= maxSlots) break; // cap
    cursor = end;
  }
  return slots;
}

// =============================
// Throttle Helper
// =============================
function canSubmit(lastISO, current = nowUK(), cooldownSeconds = SIGNUP_COOLDOWN_SECONDS) {
  if (!lastISO) return true;
  const last = DateTime.fromISO(lastISO).setZone(ZONE);
  return current >= last.plus({ seconds: cooldownSeconds });
}

// =============================
// Dev Self‑tests (run with ?selftest)
// =============================
function devSelfTests() {
  try {
    const base = DateTime.fromISO("2025-09-05T12:00", { zone: ZONE }).startOf("day");
    const i1 = Interval.fromDateTimes(base.plus({ hours: 23 }), base.plus({ days: 1, hours: 1 }));
    const slotsStd = generateSlots(i1);
    console.assert(slotsStd.length === 4, "Expected 4 slots for 2h window");
    console.assert(fmt(slotsStd[0].startISO) === "23:00" && fmt(slotsStd[0].endISO) === "23:30", "First slot 23:00–23:30");

    const nrm = (s) => normalizeName(s);
    console.assert(nrm("  DJ  NAME ") === nrm("dj name"), "Normalize duplicates");

    const tbEarly = DateTime.fromISO("2025-09-05T03:00", { zone: ZONE });
    const tbNoon = DateTime.fromISO("2025-09-05T12:00", { zone: ZONE });
    console.assert(tonightBase(tbEarly).equals(tbEarly.minus({ days: 1 }).startOf("day")), "03:00 previous night");
    console.assert(tonightBase(tbNoon).equals(tbNoon.startOf("day")), "Noon same day");

    // Throttle
    const t0 = DateTime.fromISO("2025-09-05T20:00", { zone: ZONE });
    console.assert(canSubmit(null, t0), "Allow if never submitted");
    console.assert(!canSubmit(t0.toISO(), t0.plus({ seconds: 45 })), "Block <60s");
    console.assert(canSubmit(t0.toISO(), t0.plus({ seconds: 60 })), "Allow >=60s");

    // Reroll logic (simple)
    const names = ["A","B","C","D"]; const slots = [1,2,3,4].map(() => ({ id: uuid() }));
    const pick = shuffle(names)[0]; console.assert(names.includes(pick), "Reroll pick from pool");

    console.log("Self‑tests passed ✔");
  } catch (err) {
    console.error("Self‑tests error:", err);
  }
}

// =============================
// Component
// =============================
export default function OpenDecksKiosk() {
  // Session‑only state (clears on refresh)
  const [state, setState] = useState({
    signups: [],
    assigned: { window1: [], window2: [] },
    lastDrawISO: null,
    lastSignupISO: null,
  });
  const [name, setName] = useState("");
  const [pinOK, setPinOK] = useState(false);
  const [pinTry, setPinTry] = useState("");
  const [status, setStatus] = useState("");
  const [drawPin, setDrawPin] = useState("");
  const [drawPasswordMode, setDrawPasswordMode] = useState(null); // 1 or 2
  const [tick, setTick] = useState(0); // re‑render every second for live timers
  const [manualInputs, setManualInputs] = useState({}); // keyed by `${which}-${slotId}`

  // Compute tonight's schedule
  const base = useMemo(() => tonightBase(), []);
  const { draw1Time, draw2Time, window1, window2 } = useMemo(() => tonightWindows(base), [base]);
  const slots1 = useMemo(() => generateSlots(window1), [window1]);
  const slots2 = useMemo(() => generateSlots(window2), [window2]);

  // Live timers tick
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // Optional: run self‑tests
  useEffect(() => {
    try {
      const qp = new URLSearchParams(window.location.search);
      if (qp.has("selftest")) devSelfTests();
    } catch {}
  }, []);

  // Auto‑trigger draws at 22:45 and 00:45 (UK time)
  useEffect(() => {
    const iv = setInterval(() => {
      const t = nowUK();
      if (t >= draw1Time && t < draw1Time.plus({ minutes: 1 }) && state.assigned.window1.length === 0) {
        runDraw(1);
      }
      if (t >= draw2Time && t < draw2Time.plus({ minutes: 1 }) && state.assigned.window2.length === 0) {
        runDraw(2);
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [draw1Time, draw2Time, state.assigned.window1.length, state.assigned.window2.length]);

  // ===== Admin Helpers: reroll / manual replace / redraw =====
  function namesAssignedIn(which) {
    const key = which === 1 ? "window1" : "window2";
    return new Set((state.assigned[key] || []).map((a) => a.participant));
  }

  function remainingNames(which) {
    const assigned = namesAssignedIn(which);
    return state.signups.map((s) => s.name).filter((n) => !assigned.has(n));
  }

  function rerollSlot(which, slotId) {
    const rem = remainingNames(which);
    if (rem.length === 0) { pulse("No remaining unassigned names to pick from."); return; }
    const pick = rem[Math.floor(Math.random() * rem.length)];
    const key = which === 1 ? "window1" : "window2";
    setState((prev) => ({
      ...prev,
      assigned: {
        ...prev.assigned,
        [key]: prev.assigned[key].map((a) => a.slotId === slotId ? { ...a, participant: pick } : a),
      },
    }));
    pulse("Slot re‑rolled.");
  }

  function manualReplace(which, slotId, name) {
    const trimmed = (name || "").trim();
    if (!trimmed) { pulse("Enter a name to replace with."); return; }
    const key = which === 1 ? "window1" : "window2";
    // prevent duplicate within the same window
    const dupe = (state.assigned[key] || []).some((a) => normalizeName(a.participant) === normalizeName(trimmed) && a.slotId !== slotId);
    if (dupe) { pulse("That name is already assigned in this window."); return; }
    setState((prev) => ({
      ...prev,
      assigned: {
        ...prev.assigned,
        [key]: prev.assigned[key].map((a) => a.slotId === slotId ? { ...a, participant: trimmed } : a),
      },
    }));
    pulse("Slot updated.");
  }

  function redrawWindow(which) {
    const poolNames = state.signups.map((s) => s.name);
    if (poolNames.length === 0) { pulse("No sign‑ups yet."); return; }
    const slots = which === 1 ? slots1 : slots2;
    const count = Math.min(poolNames.length, slots.length);
    const shuffledNames = shuffle(poolNames).slice(0, count);
    const assignments = slots.slice(0, count).map((slot, i) => ({
      slotId: slot.id,
      startISO: slot.startISO,
      endISO: slot.endISO,
      participant: shuffledNames[i],
    }));
    const key = which === 1 ? "window1" : "window2";
    setState((prev) => ({
      ...prev,
      assigned: { ...prev.assigned, [key]: assignments },
      lastDrawISO: nowUK().toISO(),
    }));
    pulse("Window re‑drawn.");
  }

  // ===== Actions =====
  function addSignup(e) {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    // Throttle: 1 per minute (device‑wide)
    if (!canSubmit(state.lastSignupISO)) {
      pulse("Please wait a minute before the next sign‑up.");
      return;
    }

    // Duplicate check (case/spacing insensitive)
    const exists = state.signups.some((s) => normalizeName(s.name) === normalizeName(trimmed));
    if (exists) {
      pulse("That name is already signed up.");
      return;
    }

    const entry = { id: uuid(), name: trimmed, createdISO: nowUK().toISO() };
    setState((prev) => ({
      ...prev,
      signups: [...prev.signups, entry],
      lastSignupISO: entry.createdISO,
    }));
    setName("");
    pulse("Added! Good luck in the draw.");
  }

  function clearAll() {
    if (!confirm("Clear ALL sign‑ups and set times?")) return;
    setState({ signups: [], assigned: { window1: [], window2: [] }, lastDrawISO: null, lastSignupISO: null });
    setName("");
    pulse("Everything cleared.");
  }

  function exportCSV() {
    const rows = [["Name", "Signed Up (UK)"]];
    state.signups.forEach((s) => rows.push([s.name, DateTime.fromISO(s.createdISO).setZone(ZONE).toFormat("yyyy-LL-dd HH:mm")]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `open-decks-signups-${nowUK().toFormat("yyyyLLdd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function runDraw(which) {
    const poolNames = state.signups.map((s) => s.name);
    if (poolNames.length === 0) {
      pulse("No sign‑ups yet.");
      return;
    }
    const slots = which === 1 ? slots1 : slots2;
    const count = Math.min(poolNames.length, slots.length);
    const shuffledNames = shuffle(poolNames).slice(0, count);

    const assignments = slots.slice(0, count).map((slot, i) => ({
      slotId: slot.id,
      startISO: slot.startISO,
      endISO: slot.endISO,
      participant: shuffledNames[i],
    }));

    setState((prev) => ({
      ...prev,
      assigned: {
        ...prev.assigned,
        [which === 1 ? "window1" : "window2"]: assignments,
      },
      lastDrawISO: nowUK().toISO(),
    }));
    setDrawPasswordMode(null);
    setDrawPin("");
    pulse(`Draw complete for ${which === 1 ? "23:00 – 01:00" : "01:00 – 03:00"}.`);
  }

  function removeSignup(id) {
    setState((prev) => ({
      ...prev,
      signups: prev.signups.filter((s) => s.id !== id),
    }));
  }

  // UI helpers
  function pulse(msg) {
    setStatus(msg);
    setTimeout(() => setStatus(""), 3000);
  }

  const countdownTo = (target) => {
    const t = nowUK();
    const diff = target.diff(t, ["hours", "minutes", "seconds"]).toObject();
    if (target <= t) return "00:00:00";
    const pad = (n) => String(Math.max(0, Math.floor(n ?? 0))).padStart(2, "0");
    return `${pad(diff.hours)}:${pad(diff.minutes)}:${pad(diff.seconds)}`;
  };

  // =============================
  // Sub‑components
  // =============================
  function KioskHeader() {
    const now = nowUK();
    return (
      <div className="flex items-center justify-between w-full mb-4">
        <div className={`text-2xl font-bold ${YELLOW}`}>Stage & Radio: Open Decks – Registration Draw</div>
        <div className="text-right">
          <div className="text-sm">Local time ({ZONE})</div>
          <div className="font-mono text-lg">{now.toFormat("EEE d LLL yyyy • HH:mm:ss")}</div>
        </div>
      </div>
    );
  }

  function SetTimesList({ title, list }) {
    return (
      <Card className="w-full bg-black border border-white/10 text-white">
        <CardContent className="p-4">
          <div className={`text-xl font-semibold mb-2 ${YELLOW}`}>{title}</div>
          {list.length === 0 ? (
            <div className="text-sm opacity-70">No set times yet. They will appear here after the draw.</div>
          ) : (
            <ul className="space-y-2">
              {list.map((a) => (
                <li key={a.slotId} className="flex items-center justify-between bg-neutral-900 p-3 rounded-xl">
                  <div className="font-mono text-base w-28">{fmt(a.startISO)} – {fmt(a.endISO)}</div>
                  <div className="text-lg font-medium flex-1 text-center">{a.participant}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  const window1Countdown = countdownTo(draw1Time);
  const window2Countdown = countdownTo(draw2Time);

  // =============================
  // Render
  // =============================
  return (
    <div className="min-h-screen w-full bg-black text-white p-4 md:p-8">
      <div className="max-w-5xl mx-auto grid grid-cols-1 gap-4">
        <KioskHeader />

        {/* Big, wide sign‑up box */}
        <Card className="bg-black border-2 border-yellow-400/70 shadow-[0_0_40px_rgba(250,204,21,0.25)] text-white">
          <CardContent className="p-6 md:p-8">
            <div className={`text-2xl md:text-3xl font-bold mb-4 ${YELLOW}`}>Add Your Name</div>
            <form onSubmit={addSignup} className="flex flex-col md:flex-row gap-3">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter DJ name (solo or duo)"
                className="flex-1 text-xl md:text-2xl h-14 md:h-16 bg-neutral-900 border-white/30 text-white placeholder-white/50"
                autoFocus
              />
              <Button type="submit" className="text-lg md:text-xl h-14 md:h-16 px-8">Submit</Button>
              <Button type="button" variant="secondary" className="h-14 md:h-16" onClick={() => { setName(""); }}>Clear</Button>
            </form>
            {status && <div className="mt-3 text-green-400 text-base">{status}</div>}
          </CardContent>
        </Card>

        {/* Live Info + Public sign‑ups side by side */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="bg-black border border-white/10 text-white">
            <CardContent className="p-4 space-y-3">
              <div className={`text-xl font-semibold ${YELLOW}`}>Tonight's Draws</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-neutral-900 shadow-sm">
                  <div className="text-sm opacity-70">Draw for 23:00 – 01:00</div>
                  <div className="text-2xl font-bold font-mono">{draw1Time.toFormat("HH:mm")}</div>
                  <div className="text-xs mt-1">Countdown</div>
                  <div className="font-mono text-lg">{window1Countdown}</div>
                </div>
                <div className="p-3 rounded-xl bg-neutral-900 shadow-sm">
                  <div className="text-sm opacity-70">Draw for 01:00 – 03:00</div>
                  <div className="text-2xl font-bold font-mono">{draw2Time.toFormat("HH:mm")}</div>
                  <div className="text-xs mt-1">Countdown</div>
                  <div className="font-mono text-lg">{window2Countdown}</div>
                </div>
              </div>
              <div className="text-sm opacity-70">Sign‑ups so far: {state.signups.length}</div>
            </CardContent>
          </Card>

          {/* Public: Current sign‑ups list (most recent first) */}
          <Card className="bg-black border border-white/10 text-white">
            <CardContent className="p-4">
              <div className={`text-xl font-semibold mb-2 ${YELLOW}`}>Signed Up (So Far)</div>
              {state.signups.length === 0 ? (
                <div className="text-sm opacity-70">No one has signed up yet. Add your name above.</div>
              ) : (
                <ul className="grid grid-cols-1 gap-2">
                  {[...state.signups]
                    .sort((a, b) => (b.createdISO || "").localeCompare(a.createdISO || ""))
                    .map((s) => (
                      <li key={s.id} className="bg-neutral-900 rounded-xl px-3 py-2 flex items-center justify-between shadow-sm">
                        <span className="font-medium truncate">{s.name}</span>
                        <span className="font-mono text-xs opacity-60 ml-3">{DateTime.fromISO(s.createdISO).setZone(ZONE).toFormat("HH:mm")}</span>
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

        {/* Admin (PIN required) */}
        <Card className="bg-black border border-white/10 text-white">
          <CardContent className="p-4 space-y-3">
            {!pinOK ? (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <div className={`text-sm mb-1 ${YELLOW}`}>Admin PIN</div>
                  <Input value={pinTry} onChange={(e) => setPinTry(e.target.value)} placeholder="Enter staff PIN" type="password" className="bg-neutral-900 border-white/20 text-white placeholder-white/50" />
                </div>
                <Button onClick={() => setPinOK(pinTry === ADMIN_PIN)}>Unlock</Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className={`text-lg font-semibold ${YELLOW}`}>Admin Controls</div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={exportCSV}>Export sign‑ups (CSV)</Button>
                  <Button variant="secondary" onClick={() => setDrawPasswordMode(1)}>Run 23:00 – 01:00 draw now</Button>
                  <Button variant="secondary" onClick={() => setDrawPasswordMode(2)}>Run 01:00 – 03:00 draw now</Button>
                  <Button variant="destructive" onClick={clearAll}>Clear all</Button>
                </div>

                {/* Manual draw confirm */}
                {drawPasswordMode && (
                  <div className="mt-1 space-y-2">
                    <div className="text-sm">Enter staff PIN to confirm draw</div>
                    <Input value={drawPin} onChange={(e) => setDrawPin(e.target.value)} type="password" placeholder="PIN" className="bg-neutral-900 border-white/20 text-white placeholder-white/50" />
                    <div className="flex gap-2">
                      <Button onClick={() => {
                        if (drawPin === ADMIN_PIN) {
                          runDraw(drawPasswordMode);
                        } else {
                          pulse("Wrong PIN");
                        }
                      }}>Confirm Draw</Button>
                      <Button variant="secondary" onClick={() => { setDrawPasswordMode(null); setDrawPin(""); }}>Cancel</Button>
                    </div>
                  </div>
                )}

                {/* Manage set times: reroll or manual replace */}
                <div className="grid md:grid-cols-2 gap-4">
                  {[1,2].map((which) => {
                    const key = which === 1 ? "window1" : "window2";
                    const title = which === 1 ? "Manage 23:00 – 01:00" : "Manage 01:00 – 03:00";
                    const items = state.assigned[key];
                    return (
                      <Card key={which} className="bg-neutral-950 border border-white/10">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className={`font-semibold ${YELLOW}`}>{title}</div>
                            <Button size="sm" variant="secondary" onClick={() => redrawWindow(which)}>Re‑draw window</Button>
                          </div>
                          {(!items || items.length === 0) ? (
                            <div className="text-sm opacity-70">No set times yet for this window.</div>
                          ) : (
                            <ul className="space-y-2">
                              {items.map((a) => {
                                const k = `${which}-${a.slotId}`;
                                return (
                                  <li key={a.slotId} className="bg-neutral-900 rounded-xl p-3">
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="font-mono w-28">{fmt(a.startISO)} – {fmt(a.endISO)}</div>
                                      <div className="flex-1 font-medium">{a.participant}</div>
                                      <div className="flex gap-2">
                                        <Button size="sm" variant="secondary" onClick={() => rerollSlot(which, a.slotId)}>Re‑roll</Button>
                                      </div>
                                    </div>
                                    <div className="mt-2 flex items-center gap-2">
                                      <Input
                                        value={manualInputs[k] || ""}
                                        onChange={(e) => setManualInputs((m) => ({ ...m, [k]: e.target.value }))}
                                        placeholder="Replace with name"
                                        className="h-8 bg-neutral-800 border-white/20 text-white placeholder-white/50"
                                      />
                                      <Button size="sm" onClick={() => manualReplace(which, a.slotId, manualInputs[k])}>Replace</Button>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          <div className="text-xs opacity-60">Unassigned names available: {remainingNames(which).length}</div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Current sign‑ups list */}
                <div>
                  <div className="text-sm font-medium mb-2">Current sign‑ups</div>
                  <ul className="divide-y rounded-xl overflow-hidden border border-white/10">
                    {state.signups.length === 0 && <li className="p-3 text-sm opacity-70">No one yet.</li>}
                    {state.signups.map((s) => (
                      <li key={s.id} className="p-3 flex items-center justify-between bg-neutral-900">
                        <div className="font-medium">{s.name}</div>
                        <div className="flex items-center gap-2">
                          <div className="font-mono text-xs opacity-70">{DateTime.fromISO(s.createdISO).setZone(ZONE).toFormat("HH:mm")}</div>
                          <Button size="sm" variant="destructive" onClick={() => removeSignup(s.id)}>Remove</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="text-xs opacity-60">Tip: Use iPad Guided Access to lock this screen. Data is saved only for this session.</div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="text-center text-xs opacity-60">DST‑aware (GMT/BST) via Luxon • Manual draws require staff PIN • Session‑only • v1.7</div>
      </div>
    </div>
  );
}
