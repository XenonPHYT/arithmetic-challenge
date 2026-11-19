/* Dedicated Web Worker that hosts Pyodide and python/difficulty_regulator.py.
 * Added (beyond the base file list) so Python never blocks the page while it loads or runs.
 * Messages in:  {id, cmd:'init', version} | {id, cmd:'evaluate', payload:<JSON string>}
 * Messages out: {id, ok:true, result?} | {id, ok:false, error}
 */
let regulator = null;
let initPromise = null;

async function init(version) {
  const base = new URL('../pyodide/', self.location.href).href;
  importScripts(base + 'pyodide.js');
  const py = await loadPyodide({ indexURL: base });
  const url = new URL('../python/difficulty_regulator.py', self.location.href).href + '?v=' + encodeURIComponent(version || '');
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('regulator source unavailable');
  py.FS.writeFile('/home/pyodide/difficulty_regulator.py', await res.text());
  py.runPython('import sys\nif "/home/pyodide" not in sys.path: sys.path.insert(0, "/home/pyodide")');
  regulator = py.pyimport('difficulty_regulator');
}

self.onmessage = async (e) => {
  const { id, cmd, payload, version } = e.data || {};
  try {
    if (cmd === 'init') {
      initPromise = initPromise || init(version).catch((err) => { initPromise = null; throw err; });
      await initPromise;
      self.postMessage({ id, ok: true });
    } else if (cmd === 'evaluate') {
      if (!regulator) throw new Error('regulator not ready');
      self.postMessage({ id, ok: true, result: regulator.evaluate_json(payload) });
    } else {
      throw new Error('unknown command');
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
