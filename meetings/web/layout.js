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
})();
