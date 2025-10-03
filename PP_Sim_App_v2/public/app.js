// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} name
 * @property {number} duration
 * @property {string[]} deps
 */

/**
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} name
 * @property {Task[]} tasks
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const INITIAL_PROJECTS = [
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

const DEFAULT_PROJECT_IDS = ['p1', 'p2', 'p3'];
const ROW_HEIGHT = 112;
const BAR_HEIGHT = 64;
const PADDING = 24;

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const state = {
  projects: JSON.parse(JSON.stringify(INITIAL_PROJECTS)),
  currentProjectId: INITIAL_PROJECTS[0].id,
  stage: "esef",
  ESin: {},
  EFin: {},
  LSin: {},
  LFin: {},
  minStart: {},
  unitWidth: 28,
  dragging: null,
  editingTask: null,
  isEvaluating: false
};

function getCurrentProject() {
  return state.projects.find(p => p.id === state.currentProjectId) || state.projects[0];
}

function isDefaultProject(projectId) {
  return DEFAULT_PROJECT_IDS.includes(projectId);
}

function resetProjectState() {
  state.ESin = {};
  state.EFin = {};
  state.LSin = {};
  state.LFin = {};
  state.minStart = {};
  state.stage = "esef";
}

// ============================================================================
// CPM ALGORITHM
// ============================================================================

function topoSort(tasks) {
  const indeg = {};
  const graph = {};
  
  tasks.forEach(t => {
    indeg[t.id] = indeg[t.id] || 0;
    t.deps.forEach(d => {
      indeg[t.id] = (indeg[t.id] || 0) + 1;
      graph[d] = graph[d] || [];
      graph[d].push(t.id);
    });
  });
  
  const q = tasks.filter(t => (indeg[t.id] || 0) === 0).map(t => t.id);
  const order = [];
  
  while (q.length) {
    const u = q.shift();
    order.push(u);
    (graph[u] || []).forEach(v => {
      indeg[v] -= 1;
      if (indeg[v] === 0) q.push(v);
    });
  }
  
  if (order.length !== tasks.length) {
    console.warn("Cycle detected or missing tasks");
  }
  
  return order;
}

function computeCPM(tasks, minStart = {}) {
  const order = topoSort(tasks);
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  
  const ES = {};
  const EF = {};
  
  // Forward pass
  for (const id of order) {
    const t = byId[id];
    const preds = t.deps;
    const predEF = preds.length ? Math.max(...preds.map(p => EF[p])) : 0;
    const start = Math.max(predEF, minStart[id] || 0);
    ES[id] = start;
    EF[id] = start + t.duration;
  }
  
  const projectDuration = Math.max(...Object.values(EF), 0);
  
  // Backward pass
  const succs = {};
  tasks.forEach(t => t.deps.forEach(d => {
    succs[d] = succs[d] || [];
    succs[d].push(t.id);
  }));
  
  const LS = {};
  const LF = {};
  const rev = [...order].reverse();
  
  for (const id of rev) {
    const t = byId[id];
    const s = succs[id] || [];
    LF[id] = s.length === 0 ? projectDuration : Math.min(...s.map(v => LS[v]));
    LS[id] = LF[id] - t.duration;
  }
  
  // Calculate slack and critical path
  const slack = {};
  const critical = new Set();
  for (const t of tasks) {
    slack[t.id] = LS[t.id] - ES[t.id];
    if (Math.abs(slack[t.id]) < 1e-9) critical.add(t.id);
  }
  
  return { ES, EF, LS, LF, slack, critical, projectDuration };
}

// ============================================================================
// RENDERING - MAIN
// ============================================================================

function render() {
  renderHeader();
  renderProjectSelector();
  renderTaskList();
  renderGantt();
}

function renderHeader() {
  const stageNames = {
    esef: "Enter ES/EF",
    lslf: "Enter LS/LF",
    interactive: "Interactive dragging"
  };
  document.getElementById('stage-badge').textContent = stageNames[state.stage];
}

// ============================================================================
// RENDERING - PROJECT SELECTOR
// ============================================================================

function renderProjectSelector() {
  const container = document.getElementById('project-buttons');
  container.innerHTML = '';
  
  state.projects.forEach(p => {
    const btn = document.createElement('button');
    btn.className = `project-button ${state.currentProjectId === p.id ? 'active' : ''}`;
    btn.innerHTML = `
      <div class="project-button-title">${p.name}</div>
      <div class="project-button-subtitle">${p.tasks.length} tasks</div>
    `;
    btn.onclick = () => switchProject(p.id);
    container.appendChild(btn);
  });
  
  const project = getCurrentProject();
  document.getElementById('project-name').value = project.name;
  
  // Show/hide task add section based on project type
  const taskAddSection = document.getElementById('taskAddSection');
  if (taskAddSection) {
    taskAddSection.style.display = isDefaultProject(state.currentProjectId) ? 'none' : 'block';
  }
}

function switchProject(projectId) {
  state.currentProjectId = projectId;
  resetProjectState();
  render();
}

// ============================================================================
// RENDERING - TASK LIST
// ============================================================================

function renderTaskList() {
  const project = getCurrentProject();
  const container = document.getElementById('task-list');
  
  if (project.tasks.length === 0) {
    container.innerHTML = '<div class="empty-state">No tasks yet. Click "Add Task" to get started.</div>';
    return;
  }
  
  container.innerHTML = '';
  project.tasks.forEach(t => {
    const div = document.createElement('div');
    div.className = 'task-list-item';
    div.innerHTML = `
      <div class="task-list-info">
        <span class="task-id">${t.id}</span>
        <span class="task-name">${t.name}</span>
        <span class="task-duration">Duration: ${t.duration}</span>
        <span class="task-deps">
          ${t.deps.length > 0 ? `Depends on: ${t.deps.join(', ')}` : 'No dependencies'}
        </span>
      </div>
      <div class="task-list-actions">
        <button class="btn-secondary btn-xs" onclick="editTask('${t.id}')">Edit</button>
        <button class="btn-secondary btn-xs" onclick="deleteTask('${t.id}')">Delete</button>
      </div>
    `;
    container.appendChild(div);
  });
}

// ============================================================================
// RENDERING - GANTT CHART
// ============================================================================

function renderGantt() {
  const project = getCurrentProject();
  const container = document.getElementById('gantt-section');
  
  if (project.tasks.length === 0) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'block';
  
  const computed = computeCPM(project.tasks, state.minStart);
  const maxTime = Math.max(computed.projectDuration + 3, 12);
  
  document.getElementById('project-duration').textContent = computed.projectDuration;
  
  // Update unit width based on container size
  const chartContainer = document.getElementById('chart-container');
  const available = Math.max(0, chartContainer.clientWidth - PADDING);
  if (maxTime > 0) {
    state.unitWidth = available / maxTime;
  }
  
  renderScale(maxTime);
  renderTaskBars(project, computed, maxTime);
  renderArrows(project, computed, maxTime);
  renderControls(project, computed);
}

function renderScale(maxTime) {
  const scaleGrid = document.getElementById('scale-grid');
  scaleGrid.style.marginLeft = PADDING + 'px';
  scaleGrid.style.gridTemplateColumns = `repeat(${maxTime + 1}, 1fr)`;
  scaleGrid.innerHTML = '';
  
  for (let i = 0; i <= maxTime; i++) {
    const label = document.createElement('div');
    label.className = 'scale-label';
    label.textContent = i;
    scaleGrid.appendChild(label);
  }
}

function renderTaskBars(project, computed, maxTime) {
  const container = document.getElementById('rows-container');
  container.style.height = (project.tasks.length * ROW_HEIGHT) + 'px';
  
  renderGridOverlay(maxTime);
  
  const barsContainer = document.getElementById('task-bars');
  barsContainer.innerHTML = '';
  
  project.tasks.forEach((t, rowIdx) => {
    const bar = createTaskBar(t, rowIdx, computed, project);
    barsContainer.appendChild(bar);
  });
  
  attachTaskBarListeners();
}

function renderGridOverlay(maxTime) {
  const gridInner = document.getElementById('grid-inner');
  gridInner.style.gridTemplateColumns = `repeat(${maxTime}, 1fr)`;
  gridInner.innerHTML = '';
  
  for (let i = 0; i < maxTime; i++) {
    const line = document.createElement('div');
    line.className = 'grid-line';
    gridInner.appendChild(line);
  }
}

function createTaskBar(task, rowIdx, computed, project) {
  const es = computed.ES[task.id];
  const curStart = state.stage === "interactive" ? (state.minStart[task.id] || es) : es;
  const isCritical = computed.critical.has(task.id);
  const left = PADDING + curStart * state.unitWidth;
  const top = rowIdx * ROW_HEIGHT + 2;
  
  const row = document.createElement('div');
  row.className = 'task-row';
  row.style.top = top + 'px';
  row.style.height = ROW_HEIGHT + 'px';
  
  const bar = document.createElement('div');
  bar.className = `task-bar ${isCritical ? 'critical' : 'non-critical'} ${state.stage === 'interactive' ? 'interactive' : 'static'}`;
  bar.style.left = left + 'px';
  bar.style.width = (task.duration * state.unitWidth) + 'px';
  bar.dataset.taskId = task.id;
  
  bar.innerHTML = createTaskBarContent(task, computed, project);
  row.appendChild(bar);
  
  return row;
}

function createTaskBarContent(task, computed, project) {
  const isDefault = isDefaultProject(state.currentProjectId);
  const inESEFStage = state.stage === 'esef';
  
  const esActive = (isDefault && inESEFStage) || !isDefault;
  const lsActive = (isDefault && !inESEFStage) || !isDefault;
  
  return `
    <div class="task-label-container">
      <div class="task-name">${task.id} – ${task.name}</div>
      <div class="task-info">dur ${task.duration} • slack ${computed.slack[task.id]}</div>
    </div>
    ${createCornerInput('ES', task.id, state.ESin[task.id], esActive, isDefault && !inESEFStage)}
    ${createCornerInput('EF', task.id, state.EFin[task.id], esActive, isDefault && !inESEFStage)}
    ${createCornerInput('LS', task.id, state.LSin[task.id], lsActive, isDefault && inESEFStage)}
    ${createCornerInput('LF', task.id, state.LFin[task.id], lsActive, isDefault && inESEFStage)}
  `;
}

function createCornerInput(field, taskId, value, active, disabled) {
  return `
    <input class="corner-input ${field.toLowerCase()} ${active ? 'active' : 'disabled'}"
           placeholder="${field}" 
           value="${value || ''}"
           data-task-id="${taskId}"
           data-field="${field}"
           ${disabled ? 'disabled' : ''}>
  `;
}

function attachTaskBarListeners() {
  document.querySelectorAll('.corner-input').forEach(input => {
    input.addEventListener('input', handleInputChange);
    input.addEventListener('mousedown', e => e.stopPropagation());
  });
  
  document.querySelectorAll('.task-bar').forEach(bar => {
    bar.addEventListener('mousedown', handleBarMouseDown);
  });
}

// ============================================================================
// RENDERING - ARROWS
// ============================================================================

function renderArrows(project, computed, maxTime) {
  const svg = document.getElementById('arrows-svg');
  const viewBoxWidth = PADDING + maxTime * state.unitWidth;
  const viewBoxHeight = project.tasks.length * ROW_HEIGHT;
  svg.setAttribute('viewBox', `0 0 ${viewBoxWidth} ${viewBoxHeight}`);
  
  const paths = project.tasks.flatMap((task, tgtIdx) => 
    createArrowPaths(task, tgtIdx, project, computed)
  ).join('');
  
  document.getElementById('arrow-paths').innerHTML = paths;
}

function createArrowPaths(task, tgtIdx, project, computed) {
  const tgtStart = state.stage === "interactive" 
    ? (state.minStart[task.id] || computed.ES[task.id]) 
    : computed.ES[task.id];
  const tgtStartX = PADDING + tgtStart * state.unitWidth;
  const tgtY = tgtIdx * ROW_HEIGHT + 2 + BAR_HEIGHT / 2;
  
  return task.deps.map(depId => {
    const pred = project.tasks.find(x => x.id === depId);
    if (!pred) return '';
    
    const predStart = state.stage === "interactive" 
      ? (state.minStart[pred.id] || computed.ES[pred.id]) 
      : computed.ES[pred.id];
    const predStartX = PADDING + predStart * state.unitWidth;
    const predEndX = predStartX + pred.duration * state.unitWidth;
    const predIdx = project.tasks.findIndex(x => x.id === depId);
    const predY = predIdx * ROW_HEIGHT + 2 + BAR_HEIGHT / 2;
    
    const elbowX = Math.max(predEndX + 8, Math.min(tgtStartX - 8, predEndX + (tgtStartX - predEndX) / 2));
    const isCritLink = computed.critical.has(depId) && computed.critical.has(task.id);
    const stroke = isCritLink ? "#ef4444" : "#9ca3af";
    const marker = isCritLink ? "url(#arrow-red)" : "url(#arrow)";
    
    const dPath = `M ${predEndX} ${predY} H ${elbowX} V ${tgtY} H ${tgtStartX}`;
    return `<path d="${dPath}" fill="none" stroke="${stroke}" stroke-width="2" marker-end="${marker}" />`;
  });
}

// ============================================================================
// RENDERING - CONTROLS
// ============================================================================

function renderControls(project, computed) {
  const container = document.getElementById('controls-container');
  container.innerHTML = '';
  
  if (isDefaultProject(state.currentProjectId)) {
    renderDefaultProjectControls(container);
  } else {
    renderCustomProjectControls(container, project);
  }
  
  addResetButton(container);
}

function renderDefaultProjectControls(container) {
  const controls = {
    esef: { text: 'Check ES/EF', handler: checkESEF, className: 'btn-primary' },
    lslf: { text: 'Check LS/LF', handler: checkLSLF, className: 'btn-success' },
    interactive: { 
      text: 'Drag any bar. If you move a task beyond its slack, successors will shift and the critical path may change.',
      isHint: true 
    }
  };
  
  const control = controls[state.stage];
  if (control.isHint) {
    const hint = document.createElement('div');
    hint.className = 'interactive-hint';
    hint.textContent = control.text;
    container.appendChild(hint);
  } else {
    const btn = document.createElement('button');
    btn.className = control.className;
    btn.textContent = control.text;
    btn.onclick = control.handler;
    container.appendChild(btn);
  }
}

function renderCustomProjectControls(container, project) {
  const allFieldsFilled = project.tasks.every(t => 
    state.ESin[t.id] && state.EFin[t.id] && state.LSin[t.id] && state.LFin[t.id]
  );
  
  if (allFieldsFilled) {
    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.textContent = state.isEvaluating ? 'Evaluating...' : 'Submit for AI Evaluation';
    btn.disabled = state.isEvaluating;
    btn.style.backgroundColor = '#7c3aed';
    btn.style.opacity = state.isEvaluating ? '0.6' : '1';
    btn.style.cursor = state.isEvaluating ? 'wait' : 'pointer';
    btn.onclick = submitForEvaluation;
    container.appendChild(btn);
  } else {
    const hint = document.createElement('div');
    hint.className = 'interactive-hint';
    hint.textContent = 'Fill in all ES, EF, LS, and LF values to submit for AI evaluation.';
    container.appendChild(hint);
  }
}

function addResetButton(container) {
  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn-secondary btn-reset';
  resetBtn.textContent = 'Reset project';
  resetBtn.onclick = () => {
    resetProjectState();
    render();
  };
  container.appendChild(resetBtn);
}

// ============================================================================
// EVENT HANDLERS - INPUT
// ============================================================================

function handleInputChange(e) {
  const { taskId, field } = e.target.dataset;
  const value = e.target.value;
  
  const fieldMap = {
    ES: 'ESin',
    EF: 'EFin',
    LS: 'LSin',
    LF: 'LFin'
  };
  
  if (fieldMap[field]) {
    state[fieldMap[field]][taskId] = value;
  }
}

// ============================================================================
// EVENT HANDLERS - DRAGGING
// ============================================================================

function handleBarMouseDown(e) {
  if (state.stage !== "interactive") return;
  
  const taskId = e.currentTarget.dataset.taskId;
  const project = getCurrentProject();
  const computed = computeCPM(project.tasks, state.minStart);
  const orig = state.minStart[taskId] || computed.ES[taskId];
  
  state.dragging = { id: taskId, startX: e.clientX, origStart: orig };
}

function handleMouseMove(e) {
  if (!state.dragging) return;
  
  const { id, startX, origStart } = state.dragging;
  const project = getCurrentProject();
  const computed = computeCPM(project.tasks, state.minStart);
  
  const dx = e.clientX - startX;
  const deltaUnits = Math.round(dx / state.unitWidth);
  const tentative = Math.max(0, origStart + deltaUnits);
  
  const preds = project.tasks.find(t => t.id === id).deps;
  const predEF = preds.length ? Math.max(...preds.map(p => computed.EF[p])) : 0;
  const newStart = Math.max(tentative, predEF);
  
  const newMinStart = { ...state.minStart, [id]: newStart };
  propagateConstraints(id, project, computed, newMinStart);
  
  state.minStart = newMinStart;
  render();
}

function propagateConstraints(taskId, project, computed, newMinStart) {
  const succs = project.tasks.filter(t => t.deps.includes(taskId)).map(t => t.id);
  
  for (const succId of succs) {
    const succTask = project.tasks.find(t => t.id === succId);
    const succPreds = succTask.deps;
    const succPredEF = Math.max(...succPreds.map(p => {
      const override = newMinStart[p] || computed.ES[p];
      const dur = project.tasks.find(t => t.id === p).duration;
      return Math.max(override, computed.ES[p]) + dur;
    }));
    const cur = newMinStart[succId] || computed.ES[succId];
    
    if (succPredEF > cur) {
      newMinStart[succId] = succPredEF;
      propagateConstraints(succId, project, computed, newMinStart);
    }
  }
}

function handleMouseUp() {
  state.dragging = null;
}

// ============================================================================
// VALIDATION
// ============================================================================

function parseIntOrNaN(v) {
  const parsed = parseInt(v);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function checkESEF() {
  const project = getCurrentProject();
  const computed = computeCPM(project.tasks, state.minStart);
  const { ok, details } = validateFields(project, computed, ['ES', 'EF']);
  
  if (ok) {
    showModal("Nice! ES/EF are correct", `
      <div>
        <p>Great work. Total duration is <b>${computed.projectDuration}</b> units.</p>
        <p>Now enter LS/LF for each task.</p>
      </div>
    `);
    state.stage = "lslf";
    render();
  } else {
    showModal("Not quite yet", `
      <div class="space-y-2">
        <p>Some ES/EF entries don't match the network calculation. Check:</p>
        <ul>${details.map(d => `<li>${d}</li>`).join('')}</ul>
      </div>
    `);
  }
}

function checkLSLF() {
  const project = getCurrentProject();
  const computed = computeCPM(project.tasks, state.minStart);
  const { ok, details } = validateFields(project, computed, ['LS', 'LF']);
  
  if (ok) {
    showModal("All correct!", `
      <div>
        <p>You've nailed the full CPM. Slack is shown inside each task.</p>
        <p>Drag tasks earlier/later to explore what happens within vs. beyond slack. Critical path tasks are red.</p>
      </div>
    `);
    state.stage = "interactive";
    render();
  } else {
    showModal("LS/LF have issues", `
      <div class="space-y-2">
        <p>Compare your LS/LF to the expected values:</p>
        <ul>${details.map(d => `<li>${d}</li>`).join('')}</ul>
      </div>
    `);
  }
}

function validateFields(project, computed, fields) {
  const details = [];
  let ok = true;
  
  for (const task of project.tasks) {
    const errors = fields.filter(field => {
      const userValue = parseIntOrNaN(state[`${field}in`][task.id]);
      return userValue !== computed[field][task.id];
    });
    
    if (errors.length > 0) {
      ok = false;
      const expected = fields.map(f => `${f}=${computed[f][task.id]}`).join(', ');
      details.push(`${task.id} (${task.name}): expected ${expected}`);
    }
  }
  
  return { ok, details };
}

// ============================================================================
// MODAL
// ============================================================================

function showModal(title, body) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
}

// ============================================================================
// PROJECT MANAGEMENT
// ============================================================================

function addProject() {
  const hasCustomProject = state.projects.some(p => !isDefaultProject(p.id));
  if (hasCustomProject) {
    alert("You can only create one custom project. Delete the existing custom project first.");
    return;
  }
  
  const newProject = {
    id: `p${Date.now()}`,
    name: 'Custom Project',
    tasks: []
  };
  state.projects.push(newProject);
  state.currentProjectId = newProject.id;
  render();
}

function deleteProject() {
  if (isDefaultProject(state.currentProjectId)) {
    alert("Cannot delete default example projects. You can only delete your custom project.");
    return;
  }
  
  const project = getCurrentProject();
  if (confirm(`Delete project "${project.name}"?`)) {
    state.projects = state.projects.filter(p => p.id !== state.currentProjectId);
    state.currentProjectId = state.projects[0].id;
    render();
  }
}

function resetProjectData() {
  if (isDefaultProject(state.currentProjectId)) {
    alert("Cannot reset default example projects. You can only reset your custom project.");
    return;
  }
  
  showModal("Reset Custom Project", `
    <div>
      <p>Are you sure you want to reset this project?</p>
      <p style="margin-top: 0.75rem; color: #dc2626; font-weight: 500;">
        This will delete all tasks and cannot be undone.
      </p>
      <div class="form-actions" style="margin-top: 1.5rem;">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" style="background-color: #dc2626;" onclick="confirmResetProject()">
          Yes, Reset Project
        </button>
      </div>
    </div>
  `);
}

function confirmResetProject() {
  state.projects = state.projects.map(p => 
    p.id === state.currentProjectId ? { ...p, tasks: [] } : p
  );
  resetProjectState();
  closeModal();
  render();
}

function updateProjectName(name) {
  state.projects = state.projects.map(p => 
    p.id === state.currentProjectId ? { ...p, name } : p
  );
}

// ============================================================================
// TASK MANAGEMENT
// ============================================================================

function addTask() {
  state.editingTask = null;
  openTaskEditor();
}

function editTask(taskId) {
  const project = getCurrentProject();
  state.editingTask = project.tasks.find(t => t.id === taskId);
  openTaskEditor();
}

function deleteTask(taskId) {
  if (confirm(`Delete task ${taskId}?`)) {
    state.projects = state.projects.map(p => {
      if (p.id === state.currentProjectId) {
        const newTasks = p.tasks
          .filter(t => t.id !== taskId)
          .map(t => ({ ...t, deps: t.deps.filter(d => d !== taskId) }));
        return { ...p, tasks: newTasks };
      }
      return p;
    });
    render();
  }
}

function openTaskEditor() {
  const project = getCurrentProject();
  const modal = document.getElementById('task-editor-modal');
  
  if (state.editingTask) {
    document.getElementById('task-id').value = state.editingTask.id;
    document.getElementById('task-id').disabled = true;
    document.getElementById('task-name-input').value = state.editingTask.name;
    document.getElementById('task-duration').value = state.editingTask.duration;
    document.getElementById('task-editor-title').textContent = 'Edit Task';
  } else {
    const nextId = generateNextTaskId(project);
    document.getElementById('task-id').value = nextId;
    document.getElementById('task-id').disabled = false;
    document.getElementById('task-name-input').value = '';
    document.getElementById('task-duration').value = '3';
    document.getElementById('task-editor-title').textContent = 'Add New Task';
  }
  
  renderDependencyList();
  modal.style.display = 'flex';
}

function generateNextTaskId(project) {
  const existingIds = project.tasks.map(t => t.id);
  for (let i = 0; i < 26; i++) {
    const testId = String.fromCharCode(65 + i);
    if (!existingIds.includes(testId)) {
      return testId;
    }
  }
  return "Z";
}

function renderDependencyList() {
  const project = getCurrentProject();
  const container = document.getElementById('deps-list');
  const currentId = document.getElementById('task-id').value;
  const availableDeps = project.tasks.filter(t => t.id !== currentId);
  
  if (availableDeps.length === 0) {
    container.innerHTML = '<div class="deps-empty">No other tasks available</div>';
    return;
  }
  
  const currentDeps = state.editingTask ? state.editingTask.deps : [];
  container.innerHTML = '';
  
  availableDeps.forEach(t => {
    const label = document.createElement('label');
    label.className = 'dep-checkbox';
    label.innerHTML = `
      <input type="checkbox" value="${t.id}" ${currentDeps.includes(t.id) ? 'checked' : ''}>
      <span>${t.id} - ${t.name}</span>
    `;
    container.appendChild(label);
  });
}

function closeTaskEditor() {
  document.getElementById('task-editor-modal').style.display = 'none';
  state.editingTask = null;
}

function saveTask() {
  const id = document.getElementById('task-id').value;
  const name = document.getElementById('task-name-input').value;
  const duration = parseInt(document.getElementById('task-duration').value);
  
  if (!id || !name || isNaN(duration) || duration < 1) {
    alert("Please fill in all fields correctly (duration must be at least 1)");
    return;
  }
  
  const deps = Array.from(document.querySelectorAll('#deps-list input:checked')).map(cb => cb.value);
  const task = { id, name, duration, deps };
  
  state.projects = state.projects.map(p => {
    if (p.id === state.currentProjectId) {
      const existingIndex = p.tasks.findIndex(t => t.id === task.id);
      if (existingIndex >= 0) {
        const newTasks = [...p.tasks];
        newTasks[existingIndex] = task;
        return { ...p, tasks: newTasks };
      } else {
        return { ...p, tasks: [...p.tasks, task] };
      }
    }
    return p;
  });
  
  closeTaskEditor();
  render();
}

// ============================================================================
// AI EVALUATION
// ============================================================================

async function submitForEvaluation() {
  try {
    const project = getCurrentProject();
    const computed = computeCPM(project.tasks, state.minStart);
    
    // Format project data for analysis
    const evaluationData = {
      projectName: project.name,
      tasks: project.tasks.map(task => ({
        id: task.id,
        name: task.name,
        duration: task.duration,
        dependencies: task.deps,
        computedValues: {
          ES: computed.ES[task.id],
          EF: computed.EF[task.id],
          LS: computed.LS[task.id],
          LF: computed.LF[task.id],
          slack: computed.slack[task.id]
        }
      })),
      criticalPath: Array.from(computed.critical),
      projectDuration: computed.projectDuration
    };

    const response = await fetch('/api/evaluate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "claude-3-sonnet-20240229",
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Please analyze this project's Critical Path Method (CPM) calculations:

Project: ${evaluationData.projectName}

Tasks:
${evaluationData.tasks.map(t => 
  `Task ${t.id}: "${t.name}"
   - Duration: ${t.duration}
   - Dependencies: [${t.dependencies.join(', ') || 'None'}]
   - ES: ${t.computedValues.ES}
   - EF: ${t.computedValues.EF}
   - LS: ${t.computedValues.LS}
   - LF: ${t.computedValues.LF}
   - Slack: ${t.computedValues.slack}`
).join('\n\n')}

Critical Path: ${evaluationData.criticalPath.join(' → ')}
Project Duration: ${evaluationData.projectDuration} units

Please provide:
1. Verification of CPM calculations
2. Analysis of slack for each task
3. Critical path explanation and validation
4. Schedule optimization opportunities
5. Resource leveling suggestions based on slack times
6. Overall schedule risk assessment

Format your response with markdown headings and bullet points for clarity.`
        }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.details || 'API request failed');
    }
    
    const data = await response.json();
    showModal("Project Schedule Analysis", `
      <div class="evaluation-results">
        <div class="evaluationContents">
         <p>${data.content}</p>
        </div>
        <div class="form-actions" style="margin-top: 1.5rem;">
          <button class="btn-primary" onclick="closeModal()">Close</button>
        </div>
      </div>
    `);
  } catch (error) {
    console.error('Evaluation error:', error);
    alert(`Failed to get AI evaluation: ${error.message}`);
  }
}

// ============================================================================
// WINDOW HANDLERS
// ============================================================================

function handleResize() {
  const project = getCurrentProject();
  if (project.tasks.length > 0) {
    renderGantt();
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Set up global event listeners
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
  window.addEventListener('resize', handleResize);
  
  // Project name input
  document.getElementById('project-name').addEventListener('input', (e) => {
    updateProjectName(e.target.value);
  });
  
  // Initial render
  render();
});