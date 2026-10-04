/*
 * Sessione di lavoro su un progetto aperto: dati, salvataggio automatico,
 * annulla/ripeti, cartelle delle foto, miniature e anteprime.
 */
(function (root) {
  'use strict';
  var Store = root.Store, Layout = root.Layout;
  var SKIP_DIRS = { 'Tavole stampa': 1 };

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function newSpread(style) {
    return { id: uid(), items: [], split: false, s: clone(style), sL: clone(style), sR: clone(style), combo: 0, comboL: 0, comboR: 0 };
  }

  function newProject(o) {
    var style = { gap: o.gap, margin: o.margin, border: o.border, borderColor: '#ffffff', mode: 'fit', align: 'center' };
    var size = o.measure === 'single' ? { w: o.inputW * 2, h: o.inputH } : { w: o.inputW, h: o.inputH };
    var spreads = [];
    for (var i = 0; i < o.sheets; i++) spreads.push(newSpread(style));
    return {
      format: 'impaginatore-album', version: 2, id: uid(), name: o.name,
      measure: o.measure, inputW: o.inputW, inputH: o.inputH, size: size,
      style: style, safety: { enabled: !!o.safetyOn, show: !!o.safetyOn, top: o.safety.top, bottom: o.safety.bottom, left: o.safety.left, right: o.safety.right },
      useChapters: !!o.useChapters, chapters: [], sources: [], photos: [], spreads: spreads,
      createdAt: Date.now(), updatedAt: Date.now()
    };
  }

  // Aggiorna progetti creati con versioni precedenti.
  function migrate(p) {
    p.sources = p.sources || [];
    p.chapters = p.chapters || [];
    p.spreads.forEach(function (sp) {
      sp.items.forEach(function (it) { if (!it.id) it.id = uid(); });
      if (!sp.sL) sp.sL = clone(sp.s);
      if (!sp.sR) sp.sR = clone(sp.s);
    });
    p.version = 2;
    return p;
  }

  function sizeLabel(p) {
    var f = function (n) { return String(Math.round(n * 100) / 100).replace('.', ','); };
    return f(p.inputW) + ' × ' + f(p.inputH) + ' cm';
  }

  function Session(service, fileName, project, entryId) {
    this.service = service; this.fileName = fileName; this.project = migrate(project); this.entryId = entryId || project.id;
    this.thumbs = {}; this.previews = {}; this.pending = {};
    this.undoStack = []; this.redoStack = [];
    this.listeners = []; this.version = 0;
    this.saveState = 'saved'; this.saveTimer = null; this.saving = null;
    this.progress = null;
    this.srcHandles = {}; this.srcState = {}; this.roots = [];
    this.byId = {};
    var self = this;
    this.project.photos.forEach(function (ph) { self.byId[ph.id] = ph; });
  }
  var S = Session.prototype;

  S.on = function (fn) { var l = this.listeners; l.push(fn); return function () { var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; };
  S.notify = function () { this.version++; var v = this.version; this.listeners.slice().forEach(function (f) { f(v); }); };
  // notifica al prossimo fotogramma (per trascinamenti e cursori fluidi)
  S.notifySoon = function () {
    var self = this;
    if (this._raf) return;
    this._raf = requestAnimationFrame(function () { self._raf = null; self.notify(); });
  };

  S.snapshot = function () {
    var p = this.project;
    return JSON.stringify({ spreads: p.spreads, chapters: p.chapters, pc: p.photos.map(function (x) { return x.chapter || null; }), safety: p.safety });
  };
  S.restore = function (snap) {
    var d = JSON.parse(snap), p = this.project;
    p.spreads = d.spreads; p.chapters = d.chapters; p.safety = d.safety;
    p.photos.forEach(function (x, i) { x.chapter = d.pc[i] || null; });
  };
  S.commit = function (fn, opts) {
    if (!(opts && opts.noUndo)) this.pushUndo();
    fn(this.project);
    this.changed();
  };
  S.pushUndo = function () {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  };
  S.undo = function () { if (!this.undoStack.length) return false; this.redoStack.push(this.snapshot()); this.restore(this.undoStack.pop()); this.changed(); return true; };
  S.redo = function () { if (!this.redoStack.length) return false; this.undoStack.push(this.snapshot()); this.restore(this.redoStack.pop()); this.changed(); return true; };

  S.changed = function () {
    this.project.updatedAt = Date.now();
    this.saveState = 'dirty';
    this.notify();
    var self = this;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(function () { self.save(); }, 700);
  };

  // I salvataggi vengono messi in fila: mai due scritture insieme sullo stesso file.
  S.save = function () {
    var self = this;
    clearTimeout(this.saveTimer);
    var run = function () {
      self.saveState = 'saving'; self.notify();
      var json = JSON.stringify(self.project, null, 1);
      return Store.writeFile(self.service, self.fileName, json).then(function () {
        if (self.saveState === 'saving') self.saveState = 'saved';
        return self.updateEntry();
      }).catch(function (e) { console.error(e); self.saveState = 'error'; })
        .then(function () { self.notify(); });
    };
    this.saving = (this.saving || Promise.resolve()).then(run, run);
    return this.saving;
  };

  S.updateEntry = function () {
    var p = this.project, self = this;
    var entry = {
      id: this.entryId, name: p.name, fileName: this.fileName, handle: this.service, folderName: this.service.name,
      summary: { size: sizeLabel(p), measure: p.measure, sheets: p.spreads.length, photos: p.photos.length },
      updatedAt: p.updatedAt || Date.now()
    };
    var roots = this.roots, i = 0;
    function next() {
      if (i >= roots.length) return null;
      var r = roots[i++];
      return r.handle.resolve(self.service).then(function (rel) { if (!rel) return next(); entry.rootId = r.id; entry.rootName = r.name; entry.rel = rel; }, next);
    }
    return Promise.resolve(next()).then(function () { return Store.Projects.put(entry); });
  };

  S.arOf = function (pid) { var ph = this.byId[pid]; return ph && ph.ar; };

  S.usedCount = function () {
    var used = {};
    this.project.spreads.forEach(function (sp) { sp.items.forEach(function (it) { used[it.pid] = (used[it.pid] || 0) + 1; }); });
    return used;
  };

  // ---------- cartelle delle foto ----------
  function srcKey(self, id) { return 'src:' + self.project.id + ':' + id; }

  // Cerca una cartella foto dentro gli archivi collegati (stesso percorso relativo).
  S.findInRoots = function (src) {
    var self = this;
    if (!src.rel) return Promise.resolve(null);
    var roots = this.roots.slice().sort(function (a, b) { return (b.name === src.root ? 1 : 0) - (a.name === src.root ? 1 : 0); });
    var i = 0;
    function next() {
      if (i >= roots.length) return null;
      var r = roots[i++];
      return Store.dirAt(r.handle, src.rel, false).then(function (d) { return d; }, next);
    }
    return Promise.resolve(next());
  };
  // Ricorda dove si trova la cartella rispetto a un archivio, cosi' un altro Mac la ritrova.
  S.tagRoot = function (src, dir) {
    var roots = this.roots, i = 0;
    function next() {
      if (i >= roots.length) return false;
      var r = roots[i++];
      return r.handle.resolve(dir).then(function (rel) {
        if (!rel) return next();
        var changed = src.root !== r.name || JSON.stringify(src.rel) !== JSON.stringify(rel);
        src.root = r.name; src.rel = rel;
        return changed;
      }, next);
    }
    return Promise.resolve(next());
  };
  S.loadSources = function () {
    var self = this, dirty = false;
    return Promise.all(this.project.sources.map(function (src) {
      return Store.KV.get(srcKey(self, src.id)).catch(function () { return null; }).then(function (h) {
        var viaHandle = h ? Store.permission(h, false).then(function (ok) { return ok ? h : null; }, function () { return null; }) : Promise.resolve(null);
        return viaHandle.then(function (okHandle) {
          if (okHandle) {
            self.srcHandles[src.id] = okHandle; self.srcState[src.id] = 'ok';
            return self.tagRoot(src, okHandle).then(function (ch) { if (ch) dirty = true; });
          }
          return self.findInRoots(src).then(function (d) {
            if (d) {
              self.srcHandles[src.id] = d; self.srcState[src.id] = 'ok';
              return Store.KV.set(srcKey(self, src.id), d).catch(function () { });
            }
            if (h) { self.srcHandles[src.id] = h; self.srcState[src.id] = 'locked'; }
            else self.srcState[src.id] = 'missing';
          });
        });
      }).catch(function () { self.srcState[src.id] = 'missing'; });
    })).then(function () { if (dirty) self.changed(); else self.notify(); });
  };
  S.problemSources = function () {
    var self = this;
    return this.project.sources.filter(function (s) { return self.srcState[s.id] && self.srcState[s.id] !== 'ok'; });
  };
  S.unlockSource = function (src) {
    var self = this, h = this.srcHandles[src.id];
    if (!h) return Promise.resolve(false);
    return Store.permission(h, true).then(function (ok) { self.srcState[src.id] = ok ? 'ok' : 'locked'; self.previews = {}; self.notify(); return ok; });
  };
  S.relinkSource = function (src, dir) {
    var self = this;
    this.srcHandles[src.id] = dir; this.srcState[src.id] = 'ok';
    src.name = dir.name;
    return Store.KV.set(srcKey(this, src.id), dir).then(function () { return self.tagRoot(src, dir); }).then(function () { self.changed(); });
  };
  S.dirOf = function (srcId) {
    if (!srcId || srcId === 'svc') return Promise.resolve(this.service);
    var h = this.srcHandles[srcId];
    if (!h || this.srcState[srcId] !== 'ok') {
      var src = this.project.sources.filter(function (s) { return s.id === srcId; })[0];
      var e = new Error('Cartella delle foto non raggiungibile: «' + (src ? src.name : '?') + '». Riattivala dal pulsante in alto.');
      e.code = 'source'; return Promise.reject(e);
    }
    return Promise.resolve(h);
  };
  S.fileOf = function (ph) {
    return this.dirOf(ph.src).then(function (d) { return Store.fileAt(d, ph.path); });
  };

  // ---------- miniature ----------
  S.loadThumbs = function () {
    var self = this, photos = this.project.photos.filter(function (ph) { return !self.thumbs[ph.id]; });
    if (!photos.length) return Promise.resolve();
    return Store.cacheDir(this.service).then(function (cache) {
      var batch = 0;
      self.progress = { label: 'Caricamento miniature', done: 0, total: photos.length }; self.notify();
      return Store.pool(photos, 6, function (ph) {
        return Store.thumbFor(self.service, cache, ph, function () { return self.fileOf(ph); }).then(function (blob) {
          self.thumbs[ph.id] = URL.createObjectURL(blob);
        });
      }, function (done, total) {
        self.progress = { label: 'Caricamento miniature', done: done, total: total };
        if (++batch % 25 === 0 || done === total) self.notify();
      }).then(function () { self.progress = null; self.thumbsVersion = (self.thumbsVersion || 0) + 1; self.notify(); });
    });
  };

  S.needPreview = function (pid) {
    if (this.previews[pid] || this.pending[pid]) return;
    var self = this, ph = this.byId[pid];
    if (!ph) return;
    this.pending[pid] = true;
    Store.previewFor(this.service, ph, function () { return self.fileOf(ph); }).then(function (blob) {
      self.previews[pid] = URL.createObjectURL(blob); self.notifySoon();
    }).catch(function (e) { console.warn('Anteprima non creata', ph.path, e && e.message); })
      .then(function () { setTimeout(function () { delete self.pending[pid]; }, 5000); });
  };

  S.imageUrl = function (pid) { return this.previews[pid] || this.thumbs[pid] || ''; };

  // ---------- import da qualsiasi cartella ----------
  // Cerca a quale cartella nota appartiene dir: servizio o una cartella gia' collegata.
  S.locate = function (dir) {
    var self = this;
    return this.service.resolve(dir).then(function (rel) {
      if (rel) return { src: 'svc', rel: rel };
      var srcs = self.project.sources.filter(function (s) { return self.srcHandles[s.id] && self.srcState[s.id] === 'ok'; });
      var i = 0;
      function next() {
        if (i >= srcs.length) return null;
        var s = srcs[i++];
        return self.srcHandles[s.id].resolve(dir).then(function (r) { return r ? { src: s.id, rel: r } : next(); }, next);
      }
      return next();
    });
  };

  S.importFolder = function (dir) {
    var self = this, p = this.project;
    return this.locate(dir).then(function (loc) {
      if (loc) return loc;
      var src = { id: uid(), name: dir.name };
      p.sources.push(src);
      self.srcHandles[src.id] = dir; self.srcState[src.id] = 'ok';
      return Store.KV.set(srcKey(self, src.id), dir).then(function () { return self.tagRoot(src, dir); }).then(function () { return { src: src.id, rel: [] }; });
    }).then(function (loc) {
      var prefix = loc.rel.length ? loc.rel.join('/') + '/' : '';
      return Store.scanJpegs(dir, prefix).then(function (files) {
        if (loc.src === 'svc') files = files.filter(function (f) { return !SKIP_DIRS[f.path.split('/')[0]]; });
        var known = {}; p.photos.forEach(function (ph) { known[(ph.src || 'svc') + '|' + ph.path] = 1; });
        var fresh = files.filter(function (f) { return !known[loc.src + '|' + f.path]; });
        if (!fresh.length) { self.changed(); return { added: 0, found: files.length }; }
        return Store.cacheDir(self.service).then(function (cache) {
          var added = [], n = 0;
          self.progress = { label: 'Importazione foto', done: 0, total: fresh.length }; self.notify();
          return Store.pool(fresh, 3, function (f) {
            return f.handle.getFile().then(function (file) {
              var ph = { id: 'p' + Store.hash(loc.src + f.path) + uid().slice(0, 3), src: loc.src, path: f.path, name: f.handle.name, size: file.size, lastModified: file.lastModified, chapter: null };
              return Store.thumbFor(self.service, cache, ph, file).then(function (blob) {
                self.thumbs[ph.id] = URL.createObjectURL(blob);
                added.push(ph);
              });
            });
          }, function (done, total) {
            self.progress = { label: 'Importazione foto', done: done, total: total };
            if (++n % 10 === 0 || done === total) self.notify();
          }).then(function () {
            added.forEach(function (ph) { p.photos.push(ph); self.byId[ph.id] = ph; });
            p.photos.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }) || a.path.localeCompare(b.path); });
            self.progress = null;
            self.thumbsVersion = (self.thumbsVersion || 0) + 1;
            self.changed();
            return { added: added.length, found: files.length };
          });
        });
      });
    });
  };

  root.Session = Session;
  root.SessionUtil = { newProject: newProject, newSpread: newSpread, sizeLabel: sizeLabel, uid: uid, clone: clone, migrate: migrate };
})(this);
