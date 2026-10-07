// Shared accessible splitters: actual hit area, pointer capture, keyboard and persistence.
(() => {
  let preferences = {};
  const splitters = [];
  try { preferences = JSON.parse(sessionStorage.getItem('norte.layout.v1')) || {}; } catch (_) {}
  function bind({ id, host, property, initial, axis = () => 'x', min = 15, max = 85, pixels = () => [80, 80], gutter = 8 }) {
    const node = document.querySelector(id), parent = document.querySelector(host);
    let currentAxis, value, dragAxis;
    function persist() {
      try { sessionStorage.setItem('norte.layout.v1', JSON.stringify(preferences)); } catch (_) {}
    }
    function initialValue() { return typeof initial === 'function' ? initial(currentAxis) : initial; }
    function limits() {
      const rect = parent.getBoundingClientRect();
      const length = currentAxis === 'y' ? rect.height : rect.width;
      const [first, second] = pixels(currentAxis);
      if (length <= 0) return { low: min, high: max, length };
      const scale = Math.min(1, Math.max(0, length - gutter) / (first + second));
      return { low: Math.max(min, first * scale / length * 100), high: Math.min(max, (length - gutter - second * scale) / length * 100), length };
    }
    function set(next, save = true) {
      const { low, high } = limits();
      value = Math.max(low, Math.min(Math.max(low, high), next));
      parent.style.setProperty(property, value + '%');
      node.setAttribute('aria-valuenow', String(Math.round(value)));
      node.setAttribute('aria-valuemin', String(Math.ceil(low)));
      node.setAttribute('aria-valuemax', String(Math.floor(high)));
      if (save) preferences[id + ':' + currentAxis] = value;
    }
    function sync(reset = false) {
      const next = axis();
      if (next !== currentAxis || reset === true) {
        currentAxis = next;
        node.setAttribute('aria-orientation', next === 'y' ? 'horizontal' : 'vertical');
        const saved = preferences[id + ':' + currentAxis];
        value = Number.isFinite(saved) ? saved : initialValue();
      }
      if (parent.clientWidth && parent.clientHeight) set(value, false);
    }
    node.title = 'Arraste para redimensionar · duplo clique para restaurar';
    node.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      sync(); dragAxis = currentAxis;
      node.setPointerCapture(event.pointerId); event.preventDefault();
      document.body.dataset.resizing = currentAxis;
    });
    node.addEventListener('pointermove', event => {
      if (!node.hasPointerCapture(event.pointerId) || currentAxis !== dragAxis) return;
      const rect = parent.getBoundingClientRect(), { length } = limits();
      if (length) set(((currentAxis === 'y' ? event.clientY - rect.top : event.clientX - rect.left) - gutter / 2) / length * 100);
    });
    function finish() { delete document.body.dataset.resizing; persist(); }
    node.addEventListener('pointerup', event => { if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId); finish(); });
    node.addEventListener('pointercancel', finish);
    node.addEventListener('lostpointercapture', finish);
    node.addEventListener('dblclick', () => { sync(); set(initialValue()); persist(); });
    node.addEventListener('keydown', event => {
      sync();
      const steps = currentAxis === 'y' ? { ArrowUp: -5, ArrowDown: 5 } : { ArrowLeft: -5, ArrowRight: 5 };
      if (steps[event.key]) { event.preventDefault(); set(value + steps[event.key]); persist(); }
      if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); set(event.key === 'Home' ? limits().low : limits().high); persist(); }
    });
    new ResizeObserver(sync).observe(parent);
    sync();
    const splitter = { id, set, sync, reset(next) { sync(); set(next ?? initialValue()); persist(); } }; splitters.push(splitter); return splitter;
  }
  window.NorteLayout = { bind, refresh: () => splitters.forEach(splitter => splitter.sync(true)), reset: (id,value) => splitters.find(splitter=>splitter.id===id)?.reset(value) };
  bind({ id: '#logDivider', host: '#sessionContent', property: '--workbench-height', initial: 67, axis: () => 'y', pixels: () => [210, 100], gutter: 12 });
})();
(() => {
  const panels = document.querySelector('#workspacePanels');
  const split = document.querySelector('#workspaceSplit');
  const divider = document.querySelector('#workspaceDivider');
  const tabs = [...document.querySelectorAll('.workspace-tab')];
  function setSplit(value, dragged = 'canvas', side = 'left') {
    panels.classList.toggle('split', value);
    panels.classList.toggle('reversed', value && ((dragged === 'classifier' && side === 'left') || (dragged === 'canvas' && side === 'right')));
    split.setAttribute('aria-pressed', String(value));
    split.setAttribute('aria-label', value ? 'Unir área de trabalho em abas' : 'Dividir área de trabalho');
  }
  function activate(tab) {
    tabs.forEach(item => { item.classList.toggle('active', item === tab); item.setAttribute('aria-selected', String(item === tab)); item.tabIndex = item === tab ? 0 : -1; });
    document.querySelectorAll('.workspace-pane').forEach(pane => pane.classList.toggle('active', pane.dataset.workspace === tab.dataset.workspace));
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const target = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + 1) % tabs.length]; activate(target); target.focus();
      }
    });
    tab.addEventListener('dragstart', event => event.dataTransfer.setData('application/x-norte-workspace', tab.dataset.workspace));
    tab.addEventListener('dragend', () => delete panels.dataset.drop);
    tab.addEventListener('dragover', event => event.preventDefault());
    tab.addEventListener('drop', event => { const source = event.dataTransfer.getData('application/x-norte-workspace'); if (source) { event.preventDefault(); setSplit(false); activate(tabs.find(item => item.dataset.workspace === source)); } });
  });
  panels.addEventListener('dragover', event => {
    if (!Array.from(event.dataTransfer.types).includes('application/x-norte-workspace')) return;
    event.preventDefault(); const rect = panels.getBoundingClientRect(); panels.dataset.drop = event.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
  });
  panels.addEventListener('dragleave', event => { if (!panels.contains(event.relatedTarget)) delete panels.dataset.drop; });
  panels.addEventListener('drop', event => {
    const source = event.dataTransfer.getData('application/x-norte-workspace');
    if (source) { event.preventDefault(); setSplit(true, source, panels.dataset.drop); }
    delete panels.dataset.drop;
  });
  split.addEventListener('click', () => setSplit(!panels.classList.contains('split')));
  NorteLayout.bind({ id: '#workspaceDivider', host: '#workspacePanels', property: '--left-pane', initial: 45, min: 20, max: 80, pixels: () => [100, 160] });
  activate(tabs[1]);
})();
