/*
 * Accesso a cartelle e file (File System Access API di Chrome),
 * elenco progetti (IndexedDB) e cache delle miniature.
 */
(function (root) {
  'use strict';

  var DB_NAME = 'impaginatore', DB_VER = 1;
  var CACHE_DIR = '.impaginatore';
  var THUMB_EDGE = 360, PREVIEW_EDGE = 1800;

  // ---------- IndexedDB: elenco progetti ----------
  function db() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), s = t.objectStore(store), out;
        var r = fn(s);
        if (r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { res(out); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  var Projects = {
    list: function () { return tx('projects', 'readonly', function (s) { return s.getAll(); }).then(function (l) { return (l || []).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }); }); },
    put: function (p) { return tx('projects', 'readwrite', function (s) { return s.put(p); }); },
    remove: function (id) { return tx('projects', 'readwrite', function (s) { return s.delete(id); }); }
  };
  var KV = {
    get: function (k) { return tx('kv', 'readonly', function (s) { return s.get(k); }); },
    set: function (k, v) { return tx('kv', 'readwrite', function (s) { return s.put(v, k); }); }
  };

  // ---------- Cartelle ----------
  function supported() { return typeof root.showDirectoryPicker === 'function' || !!root.__TEST_PICK_DIR; }

  function pickDirectory(opts) {
    if (root.__TEST_PICK_DIR) return root.__TEST_PICK_DIR(opts || {});
    var o = { mode: 'readwrite' };
    if (opts && opts.startIn) o.startIn = opts.startIn;
    if (opts && opts.id) o.id = opts.id;
    return root.showDirectoryPicker(o);
  }

  function permission(handle, ask) {
    if (!handle.queryPermission) return Promise.resolve(true);
    return handle.queryPermission({ mode: 'readwrite' }).then(function (p) {
      if (p === 'granted') return true;
      if (!ask) return false;
      return handle.requestPermission({ mode: 'readwrite' }).then(function (q) { return q === 'granted'; });
    });
  }

  function dirAt(rootDir, parts, create) {
    var p = Promise.resolve(rootDir);
    parts.forEach(function (name) {
      p = p.then(function (d) { return d.getDirectoryHandle(name, { create: !!create }); });
    });
    return p;
  }

  function fileAt(rootDir, path) {
    var parts = path.split('/');
    var name = parts.pop();
    return dirAt(rootDir, parts, false).then(function (d) { return d.getFileHandle(name); }).then(function (fh) { return fh.getFile(); });
  }

  function writeFile(dir, name, data) {
    return dir.getFileHandle(name, { create: true }).then(function (fh) {
      return fh.createWritable().then(function (w) {
        return w.write(data).then(function () { return w.close(); });
      });
    });
  }

  function readText(dir, name) {
    return dir.getFileHandle(name).then(function (fh) { return fh.getFile(); }).then(function (f) { return f.text(); });
  }

  // Elenca i JPEG in una cartella e nelle sottocartelle.
  function scanJpegs(dir, prefix, out) {
    out = out || [];
    var it = dir.values();
    function step() {
      return it.next().then(function (r) {
        if (r.done) return out;
        var h = r.value;
        if (h.name.charAt(0) === '.') return step();
        if (h.kind === 'file') {
          if (/\.jpe?g$/i.test(h.name)) out.push({ path: prefix + h.name, handle: h });
          return step();
        }
        return scanJpegs(h, prefix + h.name + '/', out).then(step);
      });
    }
    return step().then(function () {
      return out.sort(function (a, b) { return a.path.localeCompare(b.path, undefined, { numeric: true }); });
    });
  }

  // ---------- File progetto ----------
  function projectFileName(name) {
    var clean = String(name || 'Progetto').replace(/[\/\\:*?"<>|]/g, '-').trim() || 'Progetto';
    return clean + '.album';
  }
  function findAlbumFiles(dir) {
    var it = dir.values(), out = [];
    function step() {
      return it.next().then(function (r) {
        if (r.done) return out;
        if (r.value.kind === 'file' && /\.album$/i.test(r.value.name) && r.value.name.charAt(0) !== '.') out.push(r.value.name);
        return step();
      });
    }
    return step();
  }


  // ---------- Archivi collegati (per usare lo stesso disco su piu' Mac) ----------
  var SKIP_SCAN = { 'Tavole stampa': 1, 'node_modules': 1 };
  var Roots = {
    list: function () { return KV.get('roots').then(function (l) { return l || []; }); },
    save: function (l) { return KV.set('roots', l); }
  };
  // Cerca i file .album dentro una cartella, fino a una certa profondita'.
  function scanAlbums(rootDir, maxDepth, onProgress) {
    var found = [], visited = 0, LIMIT = 30000;
    function walk(dir, rel, depth) {
      if (visited >= LIMIT) return Promise.resolve();
      visited++;
      if (onProgress && visited % 50 === 0) onProgress(visited, found.length);
      var it = dir.values(), subs = [], albums = [];
      function step() {
        return it.next().then(function (r) {
          if (r.done) return;
          var h = r.value, n = h.name;
          if (n.charAt(0) !== '.') {
            if (h.kind === 'file') { if (/\.album$/i.test(n)) albums.push(n); }
            else if (depth < maxDepth && !SKIP_SCAN[n]) subs.push(h);
          }
          return step();
        });
      }
      return step().catch(function () { }).then(function () {
        if (albums.length) found.push({ dir: dir, rel: rel, files: albums });
        var p = Promise.resolve();
        subs.forEach(function (sub) { p = p.then(function () { return walk(sub, rel.concat([sub.name]), depth + 1); }); });
        return p;
      });
    }
    return walk(rootDir, [], 0).then(function () { return found; });
  }

  // ---------- Immagini e cache ----------
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }
  function photoKey(ph) { return hash((ph.src && ph.src !== 'svc' ? ph.src + ':' : '') + ph.path + '|' + ph.size + '|' + ph.lastModified); }

  function cacheDir(service) { return dirAt(service, [CACHE_DIR, 'cache'], true); }

  function resizeToJpeg(bitmap, maxEdge, quality) {
    var s = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    var w = Math.max(1, Math.round(bitmap.width * s)), h = Math.max(1, Math.round(bitmap.height * s));
    var c = new OffscreenCanvas(w, h), ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    return c.convertToBlob({ type: 'image/jpeg', quality: quality });
  }

  // Legge una foto, ne ricava dimensioni e miniatura (dalla cache se c'e').
  function thumbFor(service, cache, ph, file) {
    var key = photoKey(ph), name = 't_' + key + '.jpg';
    var cached = ph.ar ? cache.getFileHandle(name).then(function (fh) { return fh.getFile(); }) : Promise.reject();
    return cached.catch(function () {
      var src = typeof file === 'function' ? file() : (file ? Promise.resolve(file) : fileAt(service, ph.path));
      return src.then(function (f) { return createImageBitmap(f); }).then(function (bmp) {
        ph.w = bmp.width; ph.h = bmp.height; ph.ar = bmp.width / bmp.height;
        return resizeToJpeg(bmp, THUMB_EDGE, 0.8).then(function (blob) {
          bmp.close();
          return writeFile(cache, name, blob).then(function () { return blob; });
        });
      });
    });
  }

  function previewFor(service, ph, getFile) {
    var name = 'p_' + photoKey(ph) + '.jpg';
    return cacheDir(service).then(function (cache) {
      return cache.getFileHandle(name).then(function (fh) { return fh.getFile(); }).catch(function () {
        return (getFile ? getFile() : fileAt(service, ph.path)).then(function (f) { return createImageBitmap(f); }).then(function (bmp) {
          return resizeToJpeg(bmp, PREVIEW_EDGE, 0.85).then(function (blob) {
            bmp.close();
            return writeFile(cache, name, blob).then(function () { return blob; });
          });
        });
      });
    });
  }

  // Esegue un lavoro su una lista con N operazioni in parallelo.
  function pool(items, n, fn, onProgress) {
    var i = 0, done = 0;
    function worker() {
      if (i >= items.length) return Promise.resolve();
      var k = i++;
      return Promise.resolve().then(function () { return fn(items[k], k); }).catch(function (e) { console.warn('Errore su', items[k], e); })
        .then(function () { done++; if (onProgress) onProgress(done, items.length); return worker(); });
    }
    var ws = [];
    for (var w = 0; w < Math.min(n, items.length); w++) ws.push(worker());
    return Promise.all(ws);
  }

  root.Store = {
    Projects: Projects, KV: KV, supported: supported, pickDirectory: pickDirectory, permission: permission,
    dirAt: dirAt, fileAt: fileAt, writeFile: writeFile, readText: readText, scanJpegs: scanJpegs,
    projectFileName: projectFileName, findAlbumFiles: findAlbumFiles, photoKey: photoKey,
    cacheDir: cacheDir, thumbFor: thumbFor, previewFor: previewFor, pool: pool, hash: hash,
    Roots: Roots, scanAlbums: scanAlbums
  };
})(this);
