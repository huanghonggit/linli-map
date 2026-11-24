import { gunzipBuffer, decodeBuildingBuffers } from "./meshDecoder.js";

class MeshWorkerPool {
  constructor() {
    this.workers = [];
    this.busy = new Set();
    this.queue = [];
    this.seq = 0;
    this.pending = new Map();
    this.disabled = false;
  }

  ensureWorkers() {
    if (this.disabled || this.workers.length) return;
    if (typeof Worker === "undefined") {
      this.disabled = true;
      return;
    }
    const count = Math.max(2, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < count; i++) {
      try {
        const w = new Worker(new URL("./meshWorker.js", import.meta.url), {
          type: "module",
        });
        w.onmessage = (e) => this.handleMessage(w, e.data);
        w.onerror = () => this.handleCrash(w);
        this.workers.push(w);
      } catch {
        this.disabled = true;
        this.dispose();
        break;
      }
    }
  }

  handleMessage(worker, msg) {
    this.busy.delete(worker);
    const entry = this.pending.get(msg.id);
    if (entry) {
      this.pending.delete(msg.id);
      if (msg.ok) {
        entry.resolve({
          positions: msg.positions,
          indices: msg.indices,
          limits: msg.limits,
        });
      } else {
        entry.reject(Error(msg.error || "建筑解析失败"));
      }
    }
    this.drain();
  }

  handleCrash(worker) {
    this.busy.delete(worker);
    const idx = this.workers.indexOf(worker);
    if (idx >= 0) this.workers.splice(idx, 1);
    try {
      worker.terminate();
    } catch {
      /* ignore */
    }
    if (!this.workers.length) {
      this.disabled = true;
      for (const [, entry] of this.pending) {
        entry.reject(Error("Worker 已不可用"));
      }
      this.pending.clear();
      const rest = this.queue.splice(0);
      for (const task of rest) {
        this.decodeFallback(task.buffer).then(task.resolve, task.reject);
      }
    }
  }

  async decodeFallback(buffer) {
    const raw = await gunzipBuffer(buffer);
    return decodeBuildingBuffers(raw);
  }

  drain() {
    while (this.queue.length) {
      const worker = this.workers.find((w) => !this.busy.has(w));
      if (!worker) return;
      const task = this.queue.shift();
      const id = ++this.seq;
      this.busy.add(worker);
      this.pending.set(id, { resolve: task.resolve, reject: task.reject });
      try {
        worker.postMessage({ id, buffer: task.buffer }, [task.buffer]);
      } catch {
        this.busy.delete(worker);
        this.pending.delete(id);
        this.decodeFallback(task.buffer).then(task.resolve, task.reject);
      }
    }
  }

  decode(buffer) {
    this.ensureWorkers();
    if (this.disabled || !this.workers.length) {
      return this.decodeFallback(buffer);
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ buffer, resolve, reject });
      this.drain();
    });
  }

  dispose() {
    for (const w of this.workers) {
      try {
        w.terminate();
      } catch {
        /* ignore */
      }
    }
    this.workers = [];
    this.busy.clear();
  }
}

let sharedPool = null;

export function decodeBuildingAsync(buffer) {
  if (!sharedPool) sharedPool = new MeshWorkerPool();
  return sharedPool.decode(buffer);
}
