import React, { useMemo, useRef, useState, useEffect } from "react";

// --- Helper types ---
type Task = {
  id: string;
  name: string;
  duration: number; // in days (or generic time units)
  deps: string[]; // predecessor task ids
};

type Project = {
  id: string;
  name: string;
  tasks: Task[];
};

// --- Sample projects ---
// (Smallest task >= 3 days as requested)
const PROJECTS: Project[] = [
  {
    id: "p1",
    name: "House Painting Mini-Project",
    tasks: [
      { id: "A", name: "Prep walls", duration: 4, deps: [] },
      { id: "B", name: "Mask & cover", duration: 3, deps: ["A"] },
      { id: "C", name: "Buy paint", duration: 3, deps: ["A"] },
      { id: "D", name: "Roll first coat", duration: 5, deps: ["B", "C"] },
      { id: "E", name: "Second coat", duration: 3, deps: ["D"] },
    ],
  },
  {
    id: "p2",
    name: "Website Landing Page",
    tasks: [
      { id: "A", name: "Requirements", duration: 3, deps: [] },
      { id: "B", name: "Wireframes", duration: 3, deps: ["A"] },
      { id: "C", name: "Copywriting", duration: 4, deps: ["A"] },
      { id: "D", name: "Visual Design", duration: 5, deps: ["B"] },
      { id: "E", name: "Frontend Build", duration: 6, deps: ["D", "C"] },
      { id: "F", name: "QA & Fixes", duration: 3, deps: ["E"] },
      { id: "G", name: "Launch", duration: 3, deps: ["F"] },
    ],
  },
  {
    id: "p3",
    name: "Event Planning Weekend",
    tasks: [
      { id: "A", name: "Book venue", duration: 3, deps: [] },
      { id: "B", name: "Catering quotes", duration: 3, deps: [] },
      { id: "C", name: "Speakers", duration: 4, deps: ["A"] },
      { id: "D", name: "Marketing", duration: 5, deps: ["A"] },
      { id: "E", name: "Confirm catering", duration: 3, deps: ["B"] },
      { id: "F", name: "Run of show", duration: 3, deps: ["C", "E"] },
      { id: "G", name: "Dry run", duration: 3, deps: ["F", "D"] },
    ],
  },
];

// --- Utility: Topological order ---
function topoSort(tasks: Task[]): string[] {
  const indeg: Record<string, number> = {};
  const graph: Record<string, string[]> = {};
  tasks.forEach((t) => {
    indeg[t.id] = indeg[t.id] ?? 0;
    t.deps.forEach((d) => {
      indeg[t.id] = (indeg[t.id] ?? 0) + 1;
      graph[d] = graph[d] || [];
      graph[d].push(t.id);
    });
  });
  const q: string[] = tasks.filter((t) => (indeg[t.id] ?? 0) === 0).map((t) => t.id);
  const order: string[] = [];
  while (q.length) {
    const u = q.shift()!;
    order.push(u);
    (graph[u] || []).forEach((v) => {
      indeg[v] -= 1;
      if (indeg[v] === 0) q.push(v);
    });
  }
  if (order.length !== tasks.length) {
    console.warn("Cycle detected or missing tasks");
  }
  return order;
}

// --- CPM calculations ---
type PassResults = {
  ES: Record<string, number>;
  EF: Record<string, number>;
  LS: Record<string, number>;
  LF: Record<string, number>;
  slack: Record<string, number>;
  critical: Set<string>;
  projectDuration: number;
};

/**
 * Compute CPM given tasks and optional minStart overrides (e.g., after dragging).
 * minStart[id] is the earliest allowed start for that task.
 */
function computeCPM(tasks: Task[], minStart: Record<string, number> = {}): PassResults {
  const order = topoSort(tasks);
  const byId: Record<string, Task> = Object.fromEntries(tasks.map((t) => [t.id, t]));

  const ES: Record<string, number> = {};
  const EF: Record<string, number> = {};

  // Forward pass
  for (const id of order) {
    const t = byId[id];
    const preds = t.deps;
    const predEF = preds.length ? Math.max(...preds.map((p) => EF[p])) : 0;
    const start = Math.max(predEF, minStart[id] ?? 0);
    ES[id] = start;
    EF[id] = start + t.duration;
  }

  const projectDuration = Math.max(...Object.values(EF));

  const LS: Record<string, number> = {};
  const LF: Record<string, number> = {};

  // Backward pass
  const succs: Record<string, string[]> = {};
  tasks.forEach((t) => t.deps.forEach((d) => {
    succs[d] = succs[d] || [];
    succs[d].push(t.id);
  }));

  const rev = [...order].reverse();
  for (const id of rev) {
    const t = byId[id];
    const s = succs[id] || [];
    if (s.length === 0) {
      LF[id] = projectDuration;
    } else {
      LF[id] = Math.min(...s.map((v) => LS[v]));
    }
    LS[id] = LF[id] - t.duration;
  }

  const slack: Record<string, number> = {};
  const critical: Set<string> = new Set();
  for (const t of tasks) {
    slack[t.id] = LS[t.id] - ES[t.id];
    if (Math.abs(slack[t.id]) < 1e-9) critical.add(t.id);
  }

  return { ES, EF, LS, LF, slack, critical, projectDuration };
}

// --- Minimal test harness (non-UI) ---
// Kept off the UI per your request; just runs once to catch regressions.
type Test = { name: string; pass: boolean; msg?: string };
function runCPMTests(): Test[] {
  const tests: Test[] = [];
  function add(name: string, pass: boolean, msg?: string) { tests.push({ name, pass, msg }); }

  // Test 1: p1 duration & critical set
  const p1 = computeCPM(PROJECTS[0].tasks);
  add("p1 duration == 15", p1.projectDuration === 15, `got ${p1.projectDuration}`);
  const p1crit = new Set(Array.from(p1.critical));
  add("p1: B and C critical", p1crit.has("B") && p1crit.has("C"));

  // Test 2: p2 duration
  const p2 = computeCPM(PROJECTS[1].tasks);
  add("p2 duration == 23", p2.projectDuration === 23, `got ${p2.projectDuration}`);

  // Test 3: p3 duration
  const p3 = computeCPM(PROJECTS[2].tasks);
  add("p3 duration == 13", p3.projectDuration === 13, `got ${p3.projectDuration}`);

  // Test 4: free network (diamond) sanity
  const diamond: Task[] = [
    { id: "A", name: "Start", duration: 1, deps: [] },
    { id: "B", name: "B", duration: 3, deps: ["A"] },
    { id: "C", name: "C", duration: 3, deps: ["A"] },
    { id: "D", name: "Merge", duration: 1, deps: ["B", "C"] },
  ];
  const dm = computeCPM(diamond);
  add("diamond duration == 5", dm.projectDuration === 5, `got ${dm.projectDuration}`);
  add("diamond: B & C critical", dm.critical.has("B") && dm.critical.has("C"));

  return tests;
}

// --- Simple modal ---
function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: React.ReactNode; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold">{title}</h3>
          <button className="px-3 py-1 rounded-full bg-gray-100 hover:bg-gray-200" onClick={onClose}>✕</button>
        </div>
        <div className="text-gray-700">{children}</div>
      </div>
    </div>
  );
}

// Responsive chart area component to stretch the days across available width
function ChartArea({ maxTime, padding, unitWidth, setUnitWidth, children }:{ maxTime:number; padding:number; unitWidth:number; setUnitWidth:(n:number)=>void; children: React.ReactNode; }){
  const ref = useRef<HTMLDivElement|null>(null);
  useEffect(() => {
    function recalc(){
      if(!ref.current) return;
      const full = ref.current.clientWidth;
      const available = Math.max(0, full - padding);
      if(maxTime>0){ setUnitWidth(available / maxTime); }
    }
    recalc();
    const obs = new ResizeObserver(recalc);
    if(ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [maxTime, padding, setUnitWidth]);
  return <div ref={ref} className="relative w-full">{children}</div>;
}

// --- Main component ---
export default function CriticalPathPOC() {
  const [project, setProject] = useState<Project>(PROJECTS[0]);

  // Stage: "esef" -> "lslf" -> "interactive"
  const [stage, setStage] = useState<"esef" | "lslf" | "interactive">("esef");

  // User inputs for ES/EF and LS/LF
  const [ESin, setESin] = useState<Record<string, string>>({});
  const [EFin, setEFin] = useState<Record<string, string>>({});
  const [LSin, setLSin] = useState<Record<string, string>>({});
  const [LFin, setLFin] = useState<Record<string, string>>({});

  // Dragging: user-constrained earliest start per task (minStart). When unlocked, students drag bars.
  const [minStart, setMinStart] = useState<Record<string, number>>({});

  const computed = useMemo(() => computeCPM(project.tasks, minStart), [project, minStart]);

  // Run regression tests once (does not render UI)
  useEffect(() => {
    const results = runCPMTests();
    if (results.some((t) => !t.pass)) {
      // eslint-disable-next-line no-console
      console.warn("CPM tests failing:", results);
    }
  }, []);

  // Reset when switching projects
  useEffect(() => {
    setStage("esef");
    setESin({}); setEFin({}); setLSin({}); setLFin({});
    setMinStart({});
  }, [project.id]);

  // Responsive sizing
  const [unitWidth, setUnitWidth] = useState(28); // computed by ChartArea
  const rowHeight = 112; // taller to fit corner inputs + labels
  const padding = 24; // left gutter (space for scale labels)

  const maxTime = Math.max(computed.projectDuration + 3, 12);

  // Visual constants
  const BAR_PX = 64; // matches h-16

  // Validation helpers
  function parseIntOrNaN(v: string): number { return Number.isFinite(parseInt(v)) ? parseInt(v) : NaN; }

  function checkESEF(): { ok: boolean; details: string[] } {
    const details: string[] = [];
    let ok = true;
    for (const t of project.tasks) {
      const es = parseIntOrNaN(ESin[t.id]);
      const ef = parseIntOrNaN(EFin[t.id]);
      if (es !== computed.ES[t.id] || ef !== computed.EF[t.id]) {
        ok = false;
        details.push(`${t.id} (${t.name}): expected ES=${computed.ES[t.id]}, EF=${computed.EF[t.id]}`);
      }
    }
    return { ok, details };
  }

  function checkLSLF(): { ok: boolean; details: string[] } {
    const details: string[] = [];
    let ok = true;
    for (const t of project.tasks) {
      const ls = parseIntOrNaN(LSin[t.id]);
      const lf = parseIntOrNaN(LFin[t.id]);
      if (ls !== computed.LS[t.id] || lf !== computed.LF[t.id]) {
        ok = false;
        details.push(`${t.id} (${t.name}): expected LS=${computed.LS[t.id]}, LF=${computed.LF[t.id]}`);
      }
    }
    return { ok, details };
  }

  // Confirmation modal state
  const [modal, setModal] = useState<{ open: boolean; title: string; body: React.ReactNode }>({ open: false, title: "", body: null });
  function showModal(title: string, body: React.ReactNode) { setModal({ open: true, title, body }); }

  // Drag handling
  const draggingRef = useRef<{ id: string; startX: number; origStart: number } | null>(null);

  function onBarMouseDown(e: React.MouseEvent, id: string) {
    if (stage !== "interactive") return;
    const orig = minStart[id] ?? computed.ES[id];
    draggingRef.current = { id, startX: e.clientX, origStart: orig };
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!draggingRef.current) return;
    const { id, startX, origStart } = draggingRef.current;
    const dx = e.clientX - startX;
    const deltaUnits = Math.round(dx / unitWidth);
    const tentative = Math.max(0, origStart + deltaUnits);

    // Enforce precedence: cannot start before max(EF of predecessors)
    const preds = project.tasks.find((t) => t.id === id)!.deps;
    const predEF = preds.length ? Math.max(...preds.map((p) => computed.EF[p])) : 0;
    let newStart = Math.max(tentative, predEF);

    // If moving later beyond slack, propagate to successors
    const newMinStart = { ...minStart, [id]: newStart };

    function propagate(u: string) {
      const succs: string[] = project.tasks.filter((t) => t.deps.includes(u)).map((t) => t.id);
      for (const v of succs) {
        const vPreds = project.tasks.find((t) => t.id === v)!.deps;
        const vPredEF = Math.max(...vPreds.map((p) => {
          const override = newMinStart[p] ?? computed.ES[p];
          const dur = project.tasks.find((t) => t.id === p)!.duration;
          return Math.max(override, computed.ES[p]) + dur; // conservative EF
        }));
        const cur = newMinStart[v] ?? computed.ES[v];
        if (vPredEF > cur) {
          newMinStart[v] = vPredEF;
          propagate(v);
        }
      }
    }

    propagate(id);
    setMinStart(newMinStart);
  }

  function onMouseUp() {
    draggingRef.current = null;
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900" onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
      <div className="max-w-7xl mx-auto p-6">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Critical Path Planner – POC</h1>
          <div className="flex gap-3 items-center">
            <span className="text-sm text-gray-600">Stage:</span>
            <span className="px-3 py-1 rounded-full text-sm bg-gray-200">{stage === "esef" ? "Enter ES/EF" : stage === "lslf" ? "Enter LS/LF" : "Interactive dragging"}</span>
          </div>
        </header>

        {/* Project selector */}
        <section className="bg-white rounded-2xl shadow p-4 mb-4">
          <h2 className="font-medium mb-2">Project examples</h2>
          <div className="flex flex-wrap gap-2">
            {PROJECTS.map((p) => (
              <button
                key={p.id}
                className={`px-3 py-2 rounded-xl border ${project.id === p.id ? "bg-indigo-50 border-indigo-300" : "hover:bg-gray-50"}`}
                onClick={() => setProject(p)}
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-gray-500 text-left">{p.tasks.length} tasks</div>
              </button>
            ))}
          </div>
          <div className="mt-3 text-sm text-gray-600">
            1) Enter ES/EF in each bar, then check. 2) Enter LS/LF, then check. 3) Drag bars to explore slack & critical path changes.
          </div>
        </section>

        {/* Gantt */}
        <section className="bg-white rounded-2xl shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Gantt Chart</h2>
            <div className="text-sm text-gray-600">Project duration: <span className="font-semibold">{computed.projectDuration}</span> units</div>
          </div>

          <ChartArea maxTime={maxTime} padding={padding} unitWidth={unitWidth} setUnitWidth={setUnitWidth}>
            {/* Scale header (stretches across width) */}
            <div className="sticky top-0 z-10 bg-white/90 backdrop-blur rounded-t-xl">
              <div className="grid" style={{ marginLeft: padding, gridTemplateColumns: `repeat(${maxTime + 1}, 1fr)` }}>
                {Array.from({ length: maxTime + 1 }, (_, i) => (
                  <div key={i} className="text-xs text-center text-gray-500">{i}</div>
                ))}
              </div>
            </div>

            {/* Rows + dependency arrows */}
            <div className="mt-1 relative" style={{ height: project.tasks.length * rowHeight }}>
              {/* Grid columns */}
              <div className="absolute left-0 right-0 top-0 bottom-0" style={{ marginLeft: padding }}>
                <div className="h-full grid" style={{ gridTemplateColumns: `repeat(${maxTime}, 1fr)` }}>
                  {Array.from({ length: maxTime }, (_, i) => (
                    <div key={i} className="border-r border-dashed border-gray-200" />
                  ))}
                </div>
              </div>

              {/* Task bars */}
              {project.tasks.map((t, rowIdx) => {
                const es = computed.ES[t.id];
                const curStart = stage === "interactive" ? (minStart[t.id] ?? es) : es;
                const isCritical = computed.critical.has(t.id);
                const left = padding + curStart * unitWidth;
                const top = rowIdx * rowHeight + 2;
                return (
                  <div key={t.id} className="absolute left-0" style={{ top, height: rowHeight }}>
                    <div
                      className={`relative h-16 rounded-2xl shadow ${isCritical ? "bg-red-500" : "bg-indigo-500"} text-white flex items-center justify-center px-3 cursor-${stage === "interactive" ? "grab" : "default"} z-10`}
                      style={{ left, width: t.duration * unitWidth }}
                      onMouseDown={(e) => onBarMouseDown(e, t.id)}
                      title={isCritical ? "Critical task" : "Task"}
                    >
                      {/* Centered label */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <div className="text-xs font-medium text-white">{t.id} – {t.name}</div>
                        <div className="text-[10px] opacity-90">dur {t.duration} • slack {computed.slack[t.id]}</div>
                      </div>

                      {/* Corner inputs (half width) */}
                      <input
                        value={ESin[t.id] ?? ""}
                        onChange={(e) => setESin((s) => ({ ...s, [t.id]: e.target.value }))}
                        disabled={stage !== "esef"}
                        placeholder="ES"
                        onMouseDown={(e) => e.stopPropagation()}
                        className={`absolute top-1 left-1 w-8 px-1 py-0.5 rounded-md border text-[10px] ${stage !== "esef" ? "bg-white/40 text-white/80 border-white/20" : "bg-white text-gray-800"}`}
                      />
                      <input
                        value={EFin[t.id] ?? ""}
                        onChange={(e) => setEFin((s) => ({ ...s, [t.id]: e.target.value }))}
                        disabled={stage !== "esef"}
                        placeholder="EF"
                        onMouseDown={(e) => e.stopPropagation()}
                        className={`absolute top-1 right-1 w-8 px-1 py-0.5 rounded-md border text-[10px] text-right ${stage !== "esef" ? "bg-white/40 text-white/80 border-white/20" : "bg-white text-gray-800"}`}
                      />
                      <input
                        value={LSin[t.id] ?? ""}
                        onChange={(e) => setLSin((s) => ({ ...s, [t.id]: e.target.value }))}
                        disabled={stage === "esef"}
                        placeholder="LS"
                        onMouseDown={(e) => e.stopPropagation()}
                        className={`absolute bottom-1 left-1 w-8 px-1 py-0.5 rounded-md border text-[10px] ${stage === "esef" ? "bg-white/40 text-white/80 border-white/20" : "bg-white text-gray-800"}`}
                      />
                      <input
                        value={LFin[t.id] ?? ""}
                        onChange={(e) => setLFin((s) => ({ ...s, [t.id]: e.target.value }))}
                        disabled={stage === "esef"}
                        placeholder="LF"
                        onMouseDown={(e) => e.stopPropagation()}
                        className={`absolute bottom-1 right-1 w-8 px-1 py-0.5 rounded-md border text-[10px] text-right ${stage === "esef" ? "bg-white/40 text-white/80 border-white/20" : "bg-white text-gray-800"}`}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Dependency arrows overlay */}
              <svg className="absolute left-0 top-0 w-full h-full pointer-events-none" viewBox={`0 0 ${padding + maxTime * unitWidth} ${project.tasks.length * rowHeight}`}> 
                <defs>
                  <marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto-start-reverse">
                    <path d="M0,0 L8,4 L0,8 Z" fill="#9ca3af" />
                  </marker>
                  <marker id="arrow-red" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto-start-reverse">
                    <path d="M0,0 L8,4 L0,8 Z" fill="#ef4444" />
                  </marker>
                </defs>
                {project.tasks.flatMap((t, tgtIdx) => {
                  const tgtStart = stage === "interactive" ? (minStart[t.id] ?? computed.ES[t.id]) : computed.ES[t.id];
                  const tgtStartX = padding + tgtStart * unitWidth;
                  const tgtY = tgtIdx * rowHeight + 2 + BAR_PX / 2;
                  return t.deps.map((d) => {
                    const pred = project.tasks.find((x) => x.id === d)!;
                    const predStart = stage === "interactive" ? (minStart[pred.id] ?? computed.ES[pred.id]) : computed.ES[pred.id];
                    const predStartX = padding + predStart * unitWidth;
                    const predEndX = predStartX + pred.duration * unitWidth;
                    const predIdx = project.tasks.findIndex((x) => x.id === d);
                    const predY = predIdx * rowHeight + 2 + BAR_PX / 2;
                    const elbowX = Math.max(predEndX + 8, Math.min(tgtStartX - 8, predEndX + (tgtStartX - predEndX) / 2));
                    const isCritLink = computed.critical.has(d) && computed.critical.has(t.id);
                    const stroke = isCritLink ? "#ef4444" : "#9ca3af";
                    const marker = isCritLink ? "url(#arrow-red)" : "url(#arrow)";
                    const dPath = `M ${predEndX} ${predY} H ${elbowX} V ${tgtY} H ${tgtStartX}`;
                    return (
                      <path key={`${d}->${t.id}`} d={dPath} fill="none" stroke={stroke} strokeWidth={2} markerEnd={marker} />
                    );
                  });
                })}
              </svg>
            </div>
          </ChartArea>

          {/* Controls */}
          <div className="mt-4 flex items-center gap-3">
            {stage === "esef" && (
              <button
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
                onClick={() => {
                  const res = checkESEF();
                  if (res.ok) {
                    showModal("Nice! ES/EF are correct", (
                      <div>
                        <p className="mb-2">Great work. Total duration is <b>{computed.projectDuration}</b> units.</p>
                        <p>Now enter LS/LF for each task.</p>
                      </div>
                    ));
                    setStage("lslf");
                  } else {
                    showModal("Not quite yet", (
                      <div className="space-y-2">
                        <p>Some ES/EF entries don't match the network calculation. Check:</p>
                        <ul className="list-disc pl-5 text-sm">
                          {res.details.map((d, i) => (<li key={i}>{d}</li>))}
                        </ul>
                      </div>
                    ));
                  }
                }}
              >
                Check ES/EF
              </button>
            )}

            {stage === "lslf" && (
              <button
                className="px-4 py-2 rounded-xl bg-green-600 text-white hover:bg-green-700"
                onClick={() => {
                  const res = checkLSLF();
                  if (res.ok) {
                    showModal("All correct!", (
                      <div>
                        <p className="mb-2">You've nailed the full CPM. Slack is shown inside each task. </p>
                        <p>Drag tasks earlier/later to explore what happens within vs. beyond slack. Critical path tasks are red.</p>
                      </div>
                    ));
                    setStage("interactive");
                  } else {
                    showModal("LS/LF have issues", (
                      <div className="space-y-2">
                        <p>Compare your LS/LF to the expected values:</p>
                        <ul className="list-disc pl-5 text-sm">
                          {res.details.map((d, i) => (<li key={i}>{d}</li>))}
                        </ul>
                      </div>
                    ));
                  }
                }}
              >
                Check LS/LF
              </button>
            )}

            {stage === "interactive" && (
              <div className="text-sm text-gray-700">
                Drag any bar. If you move a task beyond its slack, successors will shift and the critical path may change.
              </div>
            )}

            <button
              className="ml-auto px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200"
              onClick={() => {
                setESin({}); setEFin({}); setLSin({}); setLFin({}); setMinStart({}); setStage("esef");
              }}
            >
              Reset project
            </button>
          </div>
        </section>

        {/* Legend & tips */}
        <section className="bg-white rounded-2xl shadow p-4 mt-4">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2"><span className="inline-block w-4 h-4 rounded bg-red-500" /> Critical path</div>
            <div className="flex items-center gap-2"><span className="inline-block w-4 h-4 rounded bg-indigo-500" /> Non-critical task</div>
            <div className="text-gray-600">Slack = LS − ES (shown inside each task bar).</div>
          </div>
        </section>
      </div>

      <Modal open={modal.open} title={modal.title} onClose={() => setModal((m) => ({ ...m, open: false }))}>
        {modal.body}
      </Modal>
    </div>
  );
}
