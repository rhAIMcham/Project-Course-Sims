import React, { useMemo, useRef, useState, useEffect } from "react";
import './app.css'; // Import the new stylesheet

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
const INITIAL_PROJECTS: Project[] = [
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

  const projectDuration = Math.max(...Object.values(EF), 0);

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

// --- Simple modal ---
function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: React.ReactNode; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
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
  return <div ref={ref} className="chart-container">{children}</div>;
}

// Task editor modal
function TaskEditorModal({ 
  open, 
  onClose, 
  onSave, 
  task, 
  allTasks 
}: { 
  open: boolean; 
  onClose: () => void; 
  onSave: (task: Task) => void; 
  task: Task | null;
  allTasks: Task[];
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("");
  const [deps, setDeps] = useState<string[]>([]);

  useEffect(() => {
    if (task) {
      setId(task.id);
      setName(task.name);
      setDuration(task.duration.toString());
      setDeps(task.deps);
    } else {
      // Generate next letter ID
      const existingIds = allTasks.map(t => t.id);
      let nextId = "A";
      for (let i = 0; i < 26; i++) {
        const testId = String.fromCharCode(65 + i); // A-Z
        if (!existingIds.includes(testId)) {
          nextId = testId;
          break;
        }
      }
      setId(nextId);
      setName("");
      setDuration("3");
      setDeps([]);
    }
  }, [task, allTasks, open]);

  const handleSave = () => {
    const durationNum = parseInt(duration);
    if (!id || !name || isNaN(durationNum) || durationNum < 1) {
      alert("Please fill in all fields correctly (duration must be at least 1)");
      return;
    }
    onSave({ id, name, duration: durationNum, deps });
    onClose();
  };

  const toggleDep = (depId: string) => {
    if (deps.includes(depId)) {
      setDeps(deps.filter(d => d !== depId));
    } else {
      setDeps([...deps, depId]);
    }
  };

  if (!open) return null;

  const availableDeps = allTasks.filter(t => t.id !== id);

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '600px' }}>
        <div className="modal-header">
          <h3 className="modal-title">{task ? 'Edit Task' : 'Add New Task'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="task-editor-form">
            <div className="form-group">
              <label className="form-label">Task ID</label>
              <input 
                type="text" 
                className="form-input"
                value={id}
                onChange={(e) => setId(e.target.value.toUpperCase())}
                maxLength={3}
                disabled={!!task}
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Task Name</label>
              <input 
                type="text" 
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Prep walls"
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Duration (time units)</label>
              <input 
                type="number" 
                className="form-input"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                min="1"
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Dependencies (predecessors)</label>
              <div className="deps-list">
                {availableDeps.length === 0 ? (
                  <div className="deps-empty">No other tasks available</div>
                ) : (
                  availableDeps.map(t => (
                    <label key={t.id} className="dep-checkbox">
                      <input 
                        type="checkbox"
                        checked={deps.includes(t.id)}
                        onChange={() => toggleDep(t.id)}
                      />
                      <span>{t.id} - {t.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            
            <div className="form-actions">
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={handleSave}>Save Task</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Main component ---
export default function CriticalPathPOC() {
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);
  const [currentProjectId, setCurrentProjectId] = useState<string>(INITIAL_PROJECTS[0].id);
  const project = projects.find(p => p.id === currentProjectId) || projects[0];

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

  // Task editor modal
  const [taskEditorOpen, setTaskEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // AI Evaluation state
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState<string | null>(null);

  // Reset when switching projects
  useEffect(() => {
    setStage("esef");
    setESin({}); setEFin({}); setLSin({}); setLFin({});
    setMinStart({});
  }, [currentProjectId]);

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

  // Project management functions
  function addProject() {
    // Check if custom project already exists
    const hasCustomProject = projects.some(p => !['p1', 'p2', 'p3'].includes(p.id));
    if (hasCustomProject) {
      alert("You can only create one custom project. Delete the existing custom project first.");
      return;
    }
    
    const newId = `p${Date.now()}`;
    const newProject: Project = {
      id: newId,
      name: `Custom Project`,
      tasks: []
    };
    setProjects([...projects, newProject]);
    setCurrentProjectId(newId);
  }

  function deleteProject() {
    // Only allow deletion of custom projects, not the default ones
    if (['p1', 'p2', 'p3'].includes(currentProjectId)) {
      alert("Cannot delete default example projects. You can only delete your custom project.");
      return;
    }
    
    const confirmed = window.confirm(`Delete project "${project.name}"?`);
    if (confirmed) {
      const newProjects = projects.filter(p => p.id !== currentProjectId);
      setProjects(newProjects);
      setCurrentProjectId(newProjects[0].id);
    }
  }

  function resetProject() {
    // Only allow reset of custom projects, not the default ones
    if (['p1', 'p2', 'p3'].includes(currentProjectId)) {
      alert("Cannot reset default example projects. You can only reset your custom project.");
      return;
    }
    
    showModal("Reset Custom Project", (
      <div>
        <p>Are you sure you want to reset this project?</p>
        <p style={{ marginTop: '0.75rem', color: '#dc2626', fontWeight: 500 }}>
          This will delete all tasks and cannot be undone.
        </p>
        <div className="form-actions" style={{ marginTop: '1.5rem' }}>
          <button className="btn-secondary" onClick={() => setModal((m) => ({ ...m, open: false }))}>
            Cancel
          </button>
          <button 
            className="btn-primary" 
            style={{ backgroundColor: '#dc2626' }}
            onClick={() => {
              setProjects(projects.map(p => 
                p.id === currentProjectId ? { ...p, tasks: [] } : p
              ));
              setModal((m) => ({ ...m, open: false }));
              // Also reset the stage and inputs
              setStage("esef");
              setESin({}); setEFin({}); setLSin({}); setLFin({});
              setMinStart({});
            }}
          >
            Yes, Reset Project
          </button>
        </div>
      </div>
    ));
  }

  function updateProjectName(name: string) {
    setProjects(projects.map(p => 
      p.id === currentProjectId ? { ...p, name } : p
    ));
  }

  // Task management functions
  function addTask() {
    setEditingTask(null);
    setTaskEditorOpen(true);
  }

  function editTask(task: Task) {
    setEditingTask(task);
    setTaskEditorOpen(true);
  }

  function deleteTask(taskId: string) {
    const confirmed = window.confirm(`Delete task ${taskId}?`);
    if (confirmed) {
      setProjects(projects.map(p => {
        if (p.id === currentProjectId) {
          // Remove task and clean up dependencies
          const newTasks = p.tasks
            .filter(t => t.id !== taskId)
            .map(t => ({
              ...t,
              deps: t.deps.filter(d => d !== taskId)
            }));
          return { ...p, tasks: newTasks };
        }
        return p;
      }));
    }
  }

  function saveTask(task: Task) {
    setProjects(projects.map(p => {
      if (p.id === currentProjectId) {
        const existingIndex = p.tasks.findIndex(t => t.id === task.id);
        if (existingIndex >= 0) {
          // Update existing task
          const newTasks = [...p.tasks];
          newTasks[existingIndex] = task;
          return { ...p, tasks: newTasks };
        } else {
          // Add new task
          return { ...p, tasks: [...p.tasks, task] };
        }
      }
      return p;
    }));
  }

  // AI Evaluation function
  async function submitForEvaluation() {
    // Only allow for custom projects
    if (['p1', 'p2', 'p3'].includes(currentProjectId)) {
      alert("AI Evaluation is only available for custom projects.");
      return;
    }

    // // Check if user has completed at least the LS/LF stage
    // if (stage === "esef") {
    //   alert("Please complete at least the ES/EF and LS/LF stages before submitting for evaluation.");
    //   return;
    // }

    setIsEvaluating(true);
    
    try {
      // Prepare the data for evaluation
      const evaluationData = {
        projectName: project.name,
        tasks: project.tasks.map(t => ({
          id: t.id,
          name: t.name,
          duration: t.duration,
          dependencies: t.deps
        })),
        userAnswers: {
          ES: ESin,
          EF: EFin,
          LS: LSin,
          LF: LFin
        },
        correctAnswers: {
          ES: computed.ES,
          EF: computed.EF,
          LS: computed.LS,
          LF: computed.LF,
          slack: computed.slack,
          criticalPath: Array.from(computed.critical),
          projectDuration: computed.projectDuration
        },
        stageCompleted: stage
      };

      // Call Claude API
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
    //'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01'
  },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: `You are an expert project management tutor evaluating a student's Critical Path Method (CPM) analysis.

**Project Details:**
Project Name: ${evaluationData.projectName}
Tasks:
${evaluationData.tasks.map(t => `- Task ${t.id} (${t.name}): Duration ${t.duration} units, Dependencies: [${t.dependencies.join(', ') || 'None'}]`).join('\n')}

**Student's Work:**
Stage Completed: ${evaluationData.stageCompleted === 'esef' ? 'ES/EF only' : evaluationData.stageCompleted === 'lslf' ? 'ES/EF and LS/LF' : 'Full CPM with interactive exploration'}

Student's ES values: ${JSON.stringify(evaluationData.userAnswers.ES)}
Student's EF values: ${JSON.stringify(evaluationData.userAnswers.EF)}
Student's LS values: ${JSON.stringify(evaluationData.userAnswers.LS)}
Student's LF values: ${JSON.stringify(evaluationData.userAnswers.LF)}

**Correct Calculations:**
Correct ES: ${JSON.stringify(evaluationData.correctAnswers.ES)}
Correct EF: ${JSON.stringify(evaluationData.correctAnswers.EF)}
Correct LS: ${JSON.stringify(evaluationData.correctAnswers.LS)}
Correct LF: ${JSON.stringify(evaluationData.correctAnswers.LF)}
Slack values: ${JSON.stringify(evaluationData.correctAnswers.slack)}
Critical Path: ${evaluationData.correctAnswers.criticalPath.join(' → ')}
Project Duration: ${evaluationData.correctAnswers.projectDuration} units

**Please provide a comprehensive evaluation that includes:**

1. **Overall Assessment (1-2 sentences)**
   - Brief summary of their performance

2. **Accuracy Analysis**
   - Calculate percentage of correct ES/EF values
   - Calculate percentage of correct LS/LF values
   - Overall accuracy score

3. **Specific Errors (if any)**
   - List each incorrect calculation
   - Explain WHY the error occurred (e.g., "didn't wait for longest predecessor", "miscalculated backward pass")
   - Provide the correct reasoning

4. **Conceptual Understanding**
   - Assess their grasp of forward pass (ES/EF calculation)
   - Assess their grasp of backward pass (LS/LF calculation)
   - Evaluate understanding of dependencies and critical path

5. **Project Structure Evaluation**
   - Comment on whether their task breakdown is logical
   - Assess if dependencies make sense for the project type
   - Note any potential improvements to the network structure

6. **Strengths Observed**
   - What did they do well?
   - Which concepts do they clearly understand?

7. **Recommendations**
   - Specific areas to focus on for improvement
   - Suggested practice exercises or concepts to review

Format your response in clear sections with markdown. Be encouraging but honest. Focus on helping them learn, not just identifying errors.`
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const data = await response.json();
      const evaluation = data.content[0].text;
      
      setEvaluationResult(evaluation);
      setIsEvaluating(false);
      
      // Show evaluation in modal
      showModal("AI Evaluation Results", (
        <div className="evaluation-results">
          <div style={{ 
            maxHeight: '500px', 
            overflowY: 'auto', 
            whiteSpace: 'pre-wrap',
            lineHeight: '1.6'
          }}>
            {evaluation}
          </div>
          <div className="form-actions" style={{ marginTop: '1.5rem' }}>
            <button className="btn-primary" onClick={() => setModal((m) => ({ ...m, open: false }))}>
              Close
            </button>
          </div>
        </div>
      ));
      
    } catch (error) {
      console.error('Evaluation error:', error);
      setIsEvaluating(false);
      alert('Failed to get AI evaluation. Please check your API key and try again.');
    }
  }

  return (
    <div className="app-container" onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
      <div className="main-wrapper">
        <header className="header">
          <h1 className="header-title">Critical Path Planner – POC</h1>
          <div className="stage-indicator">
            <span className="stage-label">Stage:</span>
            <span className="stage-badge">{stage === "esef" ? "Enter ES/EF" : stage === "lslf" ? "Enter LS/LF" : "Interactive dragging"}</span>
          </div>
        </header>

        {/* Project selector */}
        <section className="section-card">
          <div className="project-header">
            <h2 className="section-title">Projects</h2>
            <div className="project-controls">
              <button className="btn-primary btn-sm" onClick={addProject}>+ Add Project</button>
              <button className="btn-secondary btn-sm" onClick={deleteProject}>Delete Project</button>
            </div>
          </div>
          <div className="project-buttons">
            {projects.map((p) => (
              <button
                key={p.id}
                className={`project-button ${currentProjectId === p.id ? 'active' : ''}`}
                onClick={() => setCurrentProjectId(p.id)}
              >
                <div className="project-button-title">{p.name}</div>
                <div className="project-button-subtitle">{p.tasks.length} tasks</div>
              </button>
            ))}
          </div>
          
          {/* Editable project name */}
          <div className="project-name-editor">
            <label className="form-label">Project Name:</label>
            <input 
              type="text"
              className="form-input"
              value={project.name}
              onChange={(e) => updateProjectName(e.target.value)}
            />
          </div>

          <div className="instructions-text">
            1) Enter ES/EF in each bar, then check. 2) Enter LS/LF, then check. 3) Drag bars to explore slack & critical path changes.
          </div>
        </section>

        {/* Task management */}
        <section className="section-card">
          <div className="project-header">
            <h2 className="section-title">Tasks</h2>
            <button className="btn-primary btn-sm" onClick={addTask}>+ Add Task</button>
          </div>
          
          {project.tasks.length === 0 ? (
            <div className="empty-state">No tasks yet. Click "Add Task" to get started.</div>
          ) : (
            <div className="task-list">
              {project.tasks.map(t => (
                <div key={t.id} className="task-list-item">
                  <div className="task-list-info">
                    <span className="task-id">{t.id}</span>
                    <span className="task-name">{t.name}</span>
                    <span className="task-duration">Duration: {t.duration}</span>
                    <span className="task-deps">
                      {t.deps.length > 0 ? `Depends on: ${t.deps.join(', ')}` : 'No dependencies'}
                    </span>
                  </div>
                  <div className="task-list-actions">
                    <button className="btn-secondary btn-xs" onClick={() => editTask(t)}>Edit</button>
                    <button className="btn-secondary btn-xs" onClick={() => deleteTask(t.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Gantt */}
        {project.tasks.length > 0 && (
          <section className="section-card">
            <div className="gantt-header">
              <h2 className="section-title">Gantt Chart</h2>
              <div className="duration-display">Project duration: <span className="duration-value">{computed.projectDuration}</span> units</div>
            </div>

            <ChartArea maxTime={maxTime} padding={padding} unitWidth={unitWidth} setUnitWidth={setUnitWidth}>
              {/* Scale header (stretches across width) */}
              <div className="scale-header">
                <div className="scale-grid" style={{ marginLeft: padding, gridTemplateColumns: `repeat(${maxTime + 1}, 1fr)` }}>
                  {Array.from({ length: maxTime + 1 }, (_, i) => (
                    <div key={i} className="scale-label">{i}</div>
                  ))}
                </div>
              </div>

              {/* Rows + dependency arrows */}
              <div className="rows-container" style={{ height: project.tasks.length * rowHeight }}>
                {/* Grid columns */}
                <div className="grid-overlay" style={{ marginLeft: padding }}>
                  <div className="grid-inner" style={{ gridTemplateColumns: `repeat(${maxTime}, 1fr)` }}>
                    {Array.from({ length: maxTime }, (_, i) => (
                      <div key={i} className="grid-line" />
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
                    <div key={t.id} className="task-row" style={{ top, height: rowHeight }}>
                      <div
                        className={`task-bar ${isCritical ? 'critical' : 'non-critical'} ${stage === 'interactive' ? 'interactive' : 'static'}`}
                        style={{ left, width: t.duration * unitWidth }}
                        onMouseDown={(e) => onBarMouseDown(e, t.id)}
                        title={isCritical ? "Critical task" : "Task"}
                      >
                        {/* Centered label */}
                        <div className="task-label-container">
                          <div className="task-name">{t.id} – {t.name}</div>
                          <div className="task-info">dur {t.duration} • slack {computed.slack[t.id]}</div>
                        </div>

                        {/* Corner inputs */}
                        <input
                          value={ESin[t.id] ?? ""}
                          onChange={(e) => setESin((s) => ({ ...s, [t.id]: e.target.value }))}
                          disabled={['p1', 'p2', 'p3'].includes(currentProjectId) && stage !== "esef"}
                          placeholder="ES"
                          onMouseDown={(e) => e.stopPropagation()}
                          className={`corner-input es ${(['p1', 'p2', 'p3'].includes(currentProjectId) && stage === 'esef') || !['p1', 'p2', 'p3'].includes(currentProjectId) ? 'active' : 'disabled'}`}
                        />
                        <input
                          value={EFin[t.id] ?? ""}
                          onChange={(e) => setEFin((s) => ({ ...s, [t.id]: e.target.value }))}
                          disabled={['p1', 'p2', 'p3'].includes(currentProjectId) && stage !== "esef"}
                          placeholder="EF"
                          onMouseDown={(e) => e.stopPropagation()}
                          className={`corner-input ef ${(['p1', 'p2', 'p3'].includes(currentProjectId) && stage === 'esef') || !['p1', 'p2', 'p3'].includes(currentProjectId) ? 'active' : 'disabled'}`}
                        />
                        <input
                          value={LSin[t.id] ?? ""}
                          onChange={(e) => setLSin((s) => ({ ...s, [t.id]: e.target.value }))}
                          disabled={['p1', 'p2', 'p3'].includes(currentProjectId) && stage === "esef"}
                          placeholder="LS"
                          onMouseDown={(e) => e.stopPropagation()}
                          className={`corner-input ls ${(['p1', 'p2', 'p3'].includes(currentProjectId) && stage !== 'esef') || !['p1', 'p2', 'p3'].includes(currentProjectId) ? 'active' : 'disabled'}`}
                        />
                        <input
                          value={LFin[t.id] ?? ""}
                          onChange={(e) => setLFin((s) => ({ ...s, [t.id]: e.target.value }))}
                          disabled={['p1', 'p2', 'p3'].includes(currentProjectId) && stage === "esef"}
                          placeholder="LF"
                          onMouseDown={(e) => e.stopPropagation()}
                          className={`corner-input lf ${(['p1', 'p2', 'p3'].includes(currentProjectId) && stage !== 'esef') || !['p1', 'p2', 'p3'].includes(currentProjectId) ? 'active' : 'disabled'}`}
                        />
                      </div>
                    </div>
                  );
                })}

                {/* Dependency arrows overlay */}
                <svg className="arrows-overlay" viewBox={`0 0 ${padding + maxTime * unitWidth} ${project.tasks.length * rowHeight}`}> 
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
            <div className="controls-container">
              {/* For default projects: show staged validation buttons */}
              {['p1', 'p2', 'p3'].includes(currentProjectId) && (
                <>
                  {stage === "esef" && (
                    <button
                      className="btn-primary"
                      onClick={() => {
                        const res = checkESEF();
                        if (res.ok) {
                          showModal("Nice! ES/EF are correct", (
                            <div>
                              <p>Great work. Total duration is <b>{computed.projectDuration}</b> units.</p>
                              <p>Now enter LS/LF for each task.</p>
                            </div>
                          ));
                          setStage("lslf");
                        } else {
                          showModal("Not quite yet", (
                            <div className="space-y-2">
                              <p>Some ES/EF entries don't match the network calculation. Check:</p>
                              <ul>
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
                      className="btn-success"
                      onClick={() => {
                        const res = checkLSLF();
                        if (res.ok) {
                          showModal("All correct!", (
                            <div>
                              <p>You've nailed the full CPM. Slack is shown inside each task. </p>
                              <p>Drag tasks earlier/later to explore what happens within vs. beyond slack. Critical path tasks are red.</p>
                            </div>
                          ));
                          setStage("interactive");
                        } else {
                          showModal("LS/LF have issues", (
                            <div className="space-y-2">
                              <p>Compare your LS/LF to the expected values:</p>
                              <ul>
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
                    <div className="interactive-hint">
                      Drag any bar. If you move a task beyond its slack, successors will shift and the critical path may change.
                    </div>
                  )}
                </>
              )}

              {/* For custom projects: show AI evaluation button if all fields filled */}
              {!['p1', 'p2', 'p3'].includes(currentProjectId) && (() => {
                const allFieldsFilled = project.tasks.every(t => 
                  ESin[t.id] && EFin[t.id] && LSin[t.id] && LFin[t.id]
                );
                return allFieldsFilled ? (
                  <button
                    className="btn-primary"
                    onClick={submitForEvaluation}
                    disabled={isEvaluating}
                    style={{ 
                      backgroundColor: '#7c3aed',
                      opacity: isEvaluating ? 0.6 : 1,
                      cursor: isEvaluating ? 'wait' : 'pointer'
                    }}
                  >
                    {isEvaluating ? 'Evaluating...' : 'Submit for AI Evaluation'}
                  </button>
                ) : (
                  <div className="interactive-hint">
                    Fill in all ES, EF, LS, and LF values to submit for AI evaluation.
                  </div>
                );
              })()}

              <button
                className="btn-secondary btn-reset"
                onClick={() => {
                  setESin({}); setEFin({}); setLSin({}); setLFin({}); setMinStart({}); setStage("esef");
                }}
              >
                Reset project
              </button>
            </div>
          </section>
        )}

        {/* Legend & tips */}
        <section className="section-card mt-4">
          <div className="legend-container">
            <div className="legend-item">
              <span className="legend-swatch critical" />
              <span>Critical path</span>
            </div>
            <div className="legend-item">
              <span className="legend-swatch non-critical" />
              <span>Non-critical task</span>
            </div>
            <div className="legend-text">Slack = LS − ES (shown inside each task bar).</div>
            <button className="btn-secondary btn-sm" onClick={resetProject}>Reset Project</button>
          </div>
        </section>
      </div>

      <Modal open={modal.open} title={modal.title} onClose={() => setModal((m) => ({ ...m, open: false }))}>
        {modal.body}
      </Modal>

      <TaskEditorModal 
        open={taskEditorOpen}
        onClose={() => setTaskEditorOpen(false)}
        onSave={saveTask}
        task={editingTask}
        allTasks={project.tasks}
      />
    </div>
  );
}