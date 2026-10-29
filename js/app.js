/* Interfaccia dell'impaginatore (Preact + htm, senza compilazione). v0.2 */
(function (root) {
  'use strict';
  var P = root.htmPreact, html = P.html, render = P.render, Component = P.Component;
  var useState = P.useState, useEffect = P.useEffect, useRef = P.useRef;
  var Store = root.Store, Layout = root.Layout, Exporter = root.Exporter, Session = root.Session, U = root.SessionUtil;
  var O = Layout.ops;

  var CHAPTER_COLORS = ['#7aa7e0', '#c98bd6', '#6fc2a8', '#e07a6b', '#d9c35c', '#8fb3a0', '#b59ad9', '#e0935f'];
  var ALIGNS = [['center', 'Centro'], ['top', 'Alto'], ['bottom', 'Basso'], ['left', 'Sinistra'], ['right', 'Destra']];
  var TREE_FIELD = { S: 'tree', L: 'treeL', R: 'treeR' };
  var COMBO_FIELD = { S: 'combo', L: 'comboL', R: 'comboR' };
  var STYLE_FIELD = { S: 's', L: 'sL', R: 'sR' };

  function num(v) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; }
  function fmt(n) { return String(Math.round(n * 100) / 100).replace('.', ','); }
  function cls() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }

  // Stato del trascinamento (i dati di dataTransfer non sono leggibili durante dragover)
  var drag = null;

  function useSession(session) {
    var st = useState(0);
    useEffect(function () { return session ? session.on(function (v) { st[1](v); }) : undefined; }, [session]);
    return session;
  }

  // ---------- operazioni sulla tavola (usate sia per l'anteprima sia per il rilascio) ----------
  function regionOf(sp, item) { return sp.split ? (item.side === 'R' ? 'R' : 'L') : 'S'; }
  function itemsOf(sp, key) { return sp.items.filter(function (it) { return regionOf(sp, it) === key; }); }
  function currentTree(sp, key, size, arOf) {
    var lay = Layout.layoutSpread(sp, size, arOf);
    var r = lay.regions.filter(function (x) { return x.key === key; })[0];
    return r && r.tree ? O.clone(r.tree) : null;
  }
  function materialize(sp, key, size, arOf) {
    var f = TREE_FIELD[key];
    var items = itemsOf(sp, key);
    if (sp[f] && items.length && O.sameIds(sp[f], items)) return;
    sp[f] = items.length ? currentTree(sp, key, size, arOf) : null;
  }
  function syncItems(sp) {
    var order = [];
    ['S', 'L', 'R'].forEach(function (k) { if (sp[TREE_FIELD[k]]) O.leafIds(sp[TREE_FIELD[k]], order); });
    var pos = {}; order.forEach(function (id, i) { pos[id] = i; });
    sp.items.sort(function (a, b) {
      var pa = pos[a.id] != null ? pos[a.id] : 1e6, pb = pos[b.id] != null ? pos[b.id] : 1e6;
      return pa - pb;
    });
  }
  // target: {kind:'edge'|'center'|'append', id, dir, side}; payload: drag
  function applyDrop(sp, t, payload, size, arOf) {
    var tKey = sp.split ? (t.side === 'R' ? 'R' : 'L') : 'S';
    var tf = TREE_FIELD[tKey];
    var touched = [];
    if (payload.kind === 'photos') {
      var fresh = payload.pids.map(function (pid, i) {
        var it = { id: payload.ids && payload.ids[i] ? payload.ids[i] : U.uid(), pid: pid, crop: null, bw: false };
        if (sp.split) it.side = tKey;
        return it;
      });
      var ids = fresh.map(function (x) { return x.id; });
      if (t.kind === 'center') {
        var target = sp.items.filter(function (x) { return x.id === t.id; })[0];
        materialize(sp, tKey, size, arOf);
        target.pid = fresh[0].pid; target.crop = null; target.bw = false; touched.push(target.id);
        if (fresh.length > 1) {
          var rest = fresh.slice(1);
          rest.forEach(function (x) { sp.items.push(x); });
          sp[tf] = O.insertAt(sp[tf], t.id, 'right', rest.map(function (x) { return x.id; }));
          touched = touched.concat(rest.map(function (x) { return x.id; }));
        }
      } else if (t.kind === 'edge') {
        materialize(sp, tKey, size, arOf);
        fresh.forEach(function (x) { sp.items.push(x); });
        sp[tf] = O.insertAt(sp[tf], t.id, t.dir, ids);
        touched = ids;
      } else {
        // aggiunta (doppio clic o rilascio in uno spazio vuoto): la tavola si ricompone
        // con la combinazione migliore, foto intere e ordinate
        fresh.forEach(function (x) { sp.items.push(x); });
        sp[tf] = null; sp[COMBO_FIELD[tKey]] = 0; sp.eng = 3;
        touched = ids;
      }
    } else if (payload.kind === 'item') {
      var mv = sp.items.filter(function (x) { return x.id === payload.id; })[0];
      if (!mv || t.id === mv.id) return [];
      var sKey = regionOf(sp, mv), sf = TREE_FIELD[sKey];
      materialize(sp, sKey, size, arOf);
      if (tKey !== sKey) materialize(sp, tKey, size, arOf);
      if (t.kind === 'center') {
        var other = sp.items.filter(function (x) { return x.id === t.id; })[0];
        if (sKey === tKey) sp[sf] = O.swapLeaves(sp[sf], mv.id, other.id);
        else {
          sp[sf] = O.replaceLeaf(sp[sf], mv.id, other.id);
          sp[tf] = O.replaceLeaf(sp[tf], other.id, mv.id);
          var s1 = mv.side; mv.side = other.side; other.side = s1;
        }
        touched = [mv.id, other.id];
      } else {
        sp[sf] = O.removeLeaf(sp[sf], mv.id);
        if (sp.split) mv.side = tKey;
        if (t.kind === 'edge') sp[tf] = O.insertAt(sKey === tKey ? sp[sf] : sp[tf], t.id, t.dir, [mv.id]);
        else sp[tf] = O.appendLeaves(sKey === tKey ? sp[sf] : sp[tf], [mv.id]);
        touched = [mv.id];
      }
    }
    syncItems(sp);
    return touched;
  }
  function remapTree(t, map) {
    if (!t) return t;
    if (t.t === 'leaf') return Object.assign({}, t, { id: map[t.id] || t.id });
    return Object.assign({}, t, { c: t.c.map(function (c) { return remapTree(c, map); }) });
  }
  function removeItem(sp, id, size, arOf) {
    var it = sp.items.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    var key = regionOf(sp, it), f = TREE_FIELD[key];
    var custom = sp[f] && O.sameIds(sp[f], itemsOf(sp, key));
    sp.items = sp.items.filter(function (x) { return x.id !== id; });
    if (custom) sp[f] = O.removeLeaf(sp[f], id);
  }

  // ======================================================================
  // Vista di una tavola (editor, striscia, combinazioni)
  // ======================================================================
  function photoImg(session, ph, item, cw, ch, hires, extraStyle) {
    if (!ph || !ph.w) return null;
    if (hires) session.needPreview(ph.id);
    var url = hires ? session.imageUrl(ph.id) : (session.thumbs[ph.id] || '');
    if (!url) return null;
    var t = Exporter.cropTransform(ph.w, ph.h, cw, ch, item.crop);
    var st = { width: (ph.w * t.s) + 'px', height: (ph.h * t.s) + 'px', transform: Exporter.cssTransform(t, cw, ch), filter: item.bw ? 'grayscale(1)' : 'none' };
    if (extraStyle) Object.assign(st, extraStyle);
    return html`<img src=${url} draggable=${false} style=${st} />`;
  }

  function SpreadView(props) {
    var session = props.session, p = session.project, spread = props.spread, scale = props.scale;
    var size = p.size;
    var sp = props.comboOverride ? Object.assign({}, spread, props.comboOverride) : spread;
    var lay = props.lay || Layout.layoutSpread(sp, size, function (pid) { return session.arOf(pid); });
    var W = size.w * scale, H = size.h * scale;
    var hl = props.highlight || [];

    function styleOf(item) { return sp[STYLE_FIELD[regionOf(sp, item)]] || sp.s; }

    var items = lay.placed.map(function (pl) {
      var it = pl.item, ph = session.byId[it.pid];
      var cw = pl.w * scale, ch = pl.h * scale;
      var s = styleOf(it);
      var b = s.border > 0 ? Math.max(1, s.border * scale) : 0;
      var selected = props.selectedIds ? props.selectedIds.indexOf(it.id) >= 0 : props.selectedId === it.id;
      return html`<div class=${cls('ph', selected && 'sel', hl.indexOf(it.id) >= 0 && 'incoming')} key=${it.id}
        style=${{ left: pl.x * scale + 'px', top: pl.y * scale + 'px', width: cw + 'px', height: ch + 'px' }}
        draggable=${!!(props.interactive && !props.cropId)}
        onDragStart=${props.interactive ? function (e) { drag = { kind: 'item', id: it.id }; e.dataTransfer.setData('text/plain', 'item'); e.dataTransfer.effectAllowed = 'move'; if (props.onDragStartItem) props.onDragStartItem(it); } : null}
        onDragEnd=${props.interactive ? function () { drag = null; if (props.onDragEnd) props.onDragEnd(); } : null}
        onClick=${props.onItemClick ? function (e) { e.stopPropagation(); props.onItemClick(it, e); } : null}
        onDblClick=${props.onItemDbl ? function (e) { e.stopPropagation(); props.onItemDbl(it); } : null}>
        ${photoImg(session, ph, it, cw, ch, props.hires)}
        ${b ? html`<div class="border" style=${{ borderWidth: b + 'px', borderColor: s.borderColor }}></div>` : null}
        ${hl.indexOf(it.id) >= 0 ? html`<div class="mark inc"></div>` : selected ? html`<div class="mark sel"></div>` : null}
      </div>`;
    });

    var guides = null;
    if (props.guides && p.safety && p.safety.enabled) {
      // Un solo contorno sulla tavola intera: al centro (piega) non c'e' taglio
      var sf = p.safety;
      guides = html`<div class="guide" key="g" style=${{ left: sf.left * scale + 'px', top: sf.top * scale + 'px', width: (size.w - sf.left - sf.right) * scale + 'px', height: (size.h - sf.top - sf.bottom) * scale + 'px' }}></div>`;
    }

    var dividers = null;
    if (props.onDividerDown && !props.cropId) {
      dividers = lay.dividers.map(function (d, i) {
        var hz = d.axis === 'h', T = 12;
        var st = hz
          ? { left: (d.x + d.w / 2) * scale - T / 2 + 'px', top: d.y * scale + 'px', width: T + 'px', height: d.h * scale + 'px' }
          : { left: d.x * scale + 'px', top: (d.y + d.h / 2) * scale - T / 2 + 'px', width: d.w * scale + 'px', height: T + 'px' };
        return html`<div class=${cls('divider', hz ? 'dh' : 'dv')} key=${'d' + i} style=${st}
          title="Trascina per cambiare le proporzioni · doppio clic per ripristinare"
          onPointerDown=${function (e) { props.onDividerDown(d, e); }}
          onDblClick=${function (e) { e.stopPropagation(); if (props.onDividerReset) props.onDividerReset(d); }}><i></i></div>`;
      });
    }

    var crop = null;
    if (props.cropId) {
      var pc = lay.placed.filter(function (x) { return x.item.id === props.cropId; })[0];
      if (pc) {
        var cph = session.byId[pc.item.pid], ccw = pc.w * scale, cch = pc.h * scale;
        var box = { left: pc.x * scale + 'px', top: pc.y * scale + 'px', width: ccw + 'px', height: cch + 'px' };
        var cr = props.cropRect || { x: 0, y: 0, w: ccw, h: cch };
        var ox = pc.x * scale, oy = pc.y * scale;
        var rectStyle = { left: (ox + cr.x) + 'px', top: (oy + cr.y) + 'px', width: cr.w + 'px', height: cr.h + 'px' };
        var corners = [['nw', 0, 0], ['ne', 1, 0], ['sw', 0, 1], ['se', 1, 1]];
        crop = html`<div class=${cls('crop-layer', props.cropRect && 'resizing')} onClick=${function (e) { if (props.cropRect) e.stopPropagation(); }}>
          <div class="crop-dim"></div>
          <div class="crop-ghost" style=${box}>${photoImg(session, cph, pc.item, ccw, cch, true)}</div>
          <div class="crop-cell" style=${box} onPointerDown=${props.onCropDown} onWheel=${props.onCropWheel} onClick=${function (e) { e.stopPropagation(); }}>
            ${photoImg(session, cph, pc.item, ccw, cch, true)}
          </div>
          <div class="crop-rect" style=${rectStyle}><div class="thirds"><i></i><i></i><i></i><i></i></div></div>
          ${corners.map(function (c) {
            return html`<div class=${'crop-handle ' + c[0]} key=${c[0]} title="Trascina per ritagliare"
              style=${{ left: (ox + cr.x + c[1] * cr.w) + 'px', top: (oy + cr.y + c[2] * cr.h) + 'px' }}
              onPointerDown=${function (e) { props.onCropCorner(c[0], e); }} onClick=${function (e) { e.stopPropagation(); }}></div>`;
          })}
          ${[['n', .5, 0], ['s', .5, 1], ['w', 0, .5], ['e', 1, .5]].map(function (c) {
            return html`<div class=${'crop-side ' + c[0]} key=${c[0]} title="Trascina per tagliare da questo lato"
              style=${{ left: (ox + cr.x + c[1] * cr.w) + 'px', top: (oy + cr.y + c[2] * cr.h) + 'px' }}
              onPointerDown=${function (e) { props.onCropSide(c[0], e); }} onClick=${function (e) { e.stopPropagation(); }}></div>`;
          })}
        </div>`;
      }
    }

    return html`<div class=${cls('spread', props.className, props.live && 'live')} style=${{ width: W + 'px', height: H + 'px' }}
      onDragOver=${props.onDragOver} onDragLeave=${props.onDragLeave} onDrop=${props.onDrop} onClick=${props.onBgClick}>
      ${items}
      <div class="fold" style=${{ left: (W / 2) + 'px' }}></div>
      ${guides}${dividers}${crop}
      ${!spread.items.length && props.emptyText ? html`<div class="empty">${props.emptyText}</div>` : null}
    </div>`;
  }

  // ======================================================================
  // Elenco progetti
  // ======================================================================
  // Archivi collegati con accesso gia' concesso (senza chiedere permessi).
  function activeRoots() {
    return Store.Roots.list().then(function (l) {
      return Promise.all(l.map(function (r) {
        return Store.permission(r.handle, false).then(function (ok) { return ok ? r : null; }, function () { return null; });
      })).then(function (x) { return x.filter(Boolean); });
    }).catch(function () { return []; });
  }
  function readProject(dir, fileName) {
    return Store.readText(dir, fileName).then(function (txt) {
      var proj;
      try { proj = JSON.parse(txt); } catch (e) { throw new Error('Il file «' + fileName + '» non è un progetto leggibile.'); }
      if (!proj || !proj.spreads || !proj.photos) throw new Error('Il file «' + fileName + '» non è un progetto dell’impaginatore.');
      return proj;
    });
  }
  function openSession(dir, fileName, entryId) {
    return readProject(dir, fileName).then(function (proj) {
      var sess = new Session(dir, fileName, proj, entryId || proj.id);
      return activeRoots().then(function (roots) { sess.roots = roots; return sess.loadSources(); })
        .then(function () { return sess.updateEntry(); }).then(function () { return sess; });
    });
  }
  // Cerca i progetti dentro un archivio e li mette in elenco.
  function scanRoot(rootEntry, onProgress) {
    return Store.scanAlbums(rootEntry.handle, 6, onProgress).then(function (found) {
      var jobs = [];
      found.forEach(function (f) { f.files.forEach(function (name) { jobs.push({ dir: f.dir, rel: f.rel, name: name }); }); });
      var n = 0;
      return Store.pool(jobs, 4, function (j) {
        return readProject(j.dir, j.name).then(function (proj) {
          n++;
          return Store.Projects.put({
            id: proj.id, name: proj.name, fileName: j.name, handle: j.dir, folderName: j.dir.name,
            rootId: rootEntry.id, rootName: rootEntry.name, rel: j.rel,
            summary: { size: U.sizeLabel(proj), measure: proj.measure, sheets: proj.spreads.length, photos: proj.photos.length },
            updatedAt: proj.updatedAt || 0
          });
        });
      }).then(function () { return n; });
    });
  }

  function ProjectList(props) {
    var s = useState([]), list = s[0], setList = s[1];
    var st = useState({}), status = st[0], setStatus = st[1];
    var m = useState(''), msg = m[0], setMsg = m[1];
    var q = useState(''), query = q[0], setQuery = q[1];
    var ch = useState(null), chooser = ch[0], setChooser = ch[1];
    var rt = useState([]), roots = rt[0], setRoots = rt[1];
    var rs = useState({}), rootState = rs[0], setRootState = rs[1];
    function setRS(id, v) { setRootState(function (o) { var n = Object.assign({}, o); n[id] = v; return n; }); }

    function scan(r) {
      setRS(r.id, 'scan');
      return scanRoot(r, function () { }).then(function (n) { setRS(r.id, 'ok'); refresh(); return n; })
        .catch(function () { setRS(r.id, 'missing'); });
    }
    function loadRoots(andScan) {
      Store.Roots.list().then(function (l) {
        setRoots(l);
        l.forEach(function (r) {
          Store.permission(r.handle, false).then(function (ok) {
            if (!ok) { setRS(r.id, 'locked'); return; }
            if (andScan) return scan(r);
            setRS(r.id, 'ok');
          }).catch(function () { setRS(r.id, 'missing'); });
        });
      });
    }
    useEffect(function () { loadRoots(true); }, []);
    function linkRoot() {
      setMsg('');
      Store.pickDirectory({ id: 'archivio' }).then(function (dir) {
        return Store.Roots.list().then(function (l) {
          var i = 0;
          function same() {
            if (i >= l.length) return null;
            var r = l[i++];
            return r.handle.isSameEntry ? r.handle.isSameEntry(dir).then(function (y) { return y ? r : same(); }, same) : same();
          }
          return Promise.resolve(same()).then(function (ex) {
            var r = ex || { id: U.uid(), name: dir.name, handle: dir };
            if (!ex) l.push(r);
            return Store.Roots.save(l).then(function () { setRoots(l.slice()); return scan(r); }).then(function (n) {
              setMsg('Archivio «' + r.name + '» collegato: ' + (n || 0) + (n === 1 ? ' progetto trovato.' : ' progetti trovati.'));
            });
          });
        });
      }).catch(function (e) { if (e && e.name !== 'AbortError') setMsg('Impossibile collegare: ' + e.message); });
    }
    function rootClick(r) {
      var st0 = rootState[r.id];
      if (st0 === 'locked' || st0 === 'missing') {
        Store.permission(r.handle, true).then(function (ok) { if (ok) scan(r); else setRS(r.id, 'locked'); }).catch(function () { setRS(r.id, 'missing'); });
      } else scan(r);
    }
    function unlinkRoot(r, ev) {
      ev.stopPropagation();
      if (!root.confirm('Scollegare l’archivio «' + r.name + '»? I progetti restano sul disco.')) return;
      Store.Roots.list().then(function (l) { l = l.filter(function (x) { return x.id !== r.id; }); return Store.Roots.save(l).then(function () { setRoots(l); }); });
    }

    function refresh() {
      Store.Projects.list().then(function (l) {
        setList(l);
        l.forEach(function (e) {
          Store.permission(e.handle, false).then(function (ok) {
            if (!ok) return 'locked';
            return e.handle.getFileHandle(e.fileName).then(function () { return 'ok'; }, function () { return 'missing'; });
          }).catch(function () { return 'missing'; }).then(function (v) {
            setStatus(function (o) { var n = Object.assign({}, o); n[e.id] = v; return n; });
          });
        });
      });
    }
    useEffect(refresh, []);

    function openEntry(e) {
      setMsg('');
      Store.permission(e.handle, true).then(function (ok) {
        if (!ok) { setMsg('Permesso negato per la cartella «' + e.folderName + '».'); return; }
        return e.handle.getFileHandle(e.fileName).then(function () {
          return openSession(e.handle, e.fileName, e.id).then(props.onOpen);
        }, function () {
          setStatus(function (o) { var n = Object.assign({}, o); n[e.id] = 'missing'; return n; });
          setMsg('Progetto non disponibile: controlla che il disco sia collegato.');
        });
      }).catch(function (err) { setMsg(err.message); });
    }

    function openFolder() {
      setMsg('');
      Store.pickDirectory({ id: 'progetti' }).then(function (dir) {
        return Store.findAlbumFiles(dir).then(function (names) {
          if (!names.length) { setMsg('In «' + dir.name + '» non c’è nessun progetto (.album).'); return; }
          names.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
          if (names.length > 1) { setChooser({ dir: dir, names: names }); return; }
          return openFromFolder(dir, names[0]);
        });
      }).catch(function (e) { if (e && e.name !== 'AbortError') setMsg('Impossibile aprire: ' + e.message); });
    }
    function openFromFolder(dir, name) {
      setChooser(null);
      return Store.Projects.list().then(function (l) {
        var ex = l.filter(function (e) { return e.fileName === name && e.folderName === dir.name; })[0];
        return openSession(dir, name, ex && ex.id).then(props.onOpen);
      }).catch(function (e) { setMsg(e.message); });
    }

    // Duplica: copia del file .album nella stessa cartella, con un nuovo nome.
    // Le cartelle delle foto restano collegate (stesse foto, nessuna copia dei JPEG).
    function duplicateEntry(e, ev) {
      ev.stopPropagation();
      setMsg('');
      var name = root.prompt('Nome della copia', e.name + ' - copia');
      if (!name || !name.trim()) return;
      name = name.trim();
      var fileName = Store.projectFileName(name);
      Store.permission(e.handle, true).then(function (ok) {
        if (!ok) throw new Error('Permesso negato per la cartella «' + e.folderName + '».');
        return e.handle.getFileHandle(fileName).then(function () { return true; }, function () { return false; });
      }).then(function (exists) {
        if (exists) throw new Error('Nella cartella «' + e.folderName + '» c’è già un progetto chiamato «' + name + '». Scegli un altro nome.');
        return readProject(e.handle, e.fileName);
      }).then(function (proj) {
        var oldId = proj.id, now = Date.now();
        proj.id = U.uid(); proj.name = name; proj.createdAt = now; proj.updatedAt = now;
        return Store.writeFile(e.handle, fileName, JSON.stringify(proj, null, 1)).then(function () {
          // le cartelle foto gia' autorizzate valgono anche per la copia
          return Promise.all((proj.sources || []).map(function (src) {
            return Store.KV.get('src:' + oldId + ':' + src.id).then(function (h) { if (h) return Store.KV.set('src:' + proj.id + ':' + src.id, h); }).catch(function () { });
          }));
        }).then(function () {
          var entry = Object.assign({}, e, { id: proj.id, name: name, fileName: fileName, updatedAt: now,
            summary: { size: U.sizeLabel(proj), measure: proj.measure, sheets: proj.spreads.length, photos: proj.photos.length } });
          return Store.Projects.put(entry);
        }).then(function () {
          refresh();
          setMsg('Creata la copia «' + name + '» nella cartella «' + e.folderName + '».');
        });
      }).catch(function (err) { setMsg(err.message); });
    }

    function removeEntry(e, ev) {
      ev.stopPropagation();
      if (!root.confirm('Togliere «' + e.name + '» dall’elenco? Il file del progetto e le foto restano dove sono.')) return;
      Store.Projects.remove(e.id).then(refresh);
    }

    var shown = list.filter(function (e) { return !query || e.name.toLowerCase().indexOf(query.toLowerCase()) >= 0; });

    return html`<div class="list-screen">
      <div class="titlebar">CAP Album</div>
      <div class="list-body">
        <div class="list-head">
          <h1>Progetti</h1>
          <input class="search" type="search" placeholder="Cerca progetto" aria-label="Cerca progetto" value=${query} onInput=${function (e) { setQuery(e.target.value); }} />
          <button class="btn" onClick=${openFolder}>Apri progetto da cartella…</button>
          <button class="btn primary" onClick=${props.onNew}>+ Nuovo progetto</button>
        </div>
        <div class="roots">
          <span class="muted small">Archivi collegati</span>
          ${roots.map(function (r) {
            var v = rootState[r.id] || '';
            var label = v === 'locked' ? ' · clic per riattivare' : v === 'missing' ? ' · non collegato' : v.indexOf('scan') === 0 ? ' · ricerca progetti…' : '';
            return html`<span class=${cls('rootchip', v === 'ok' && 'ok', (v === 'locked' || v === 'missing') && 'off')} key=${r.id} role="button" tabindex="0" title="Clic per cercare di nuovo i progetti" onClick=${function () { rootClick(r); }}>
              <i></i>${r.name}${label}
              <button class="x" aria-label="Scollega archivio" title="Scollega" onClick=${function (ev) { unlinkRoot(r, ev); }}>×</button>
            </span>`;
          })}
          ${!roots.length ? html`<span class="muted small">nessuno — collega il disco dei lavori per ritrovare i progetti su ogni Mac</span>` : null}
          <button class="btn small" onClick=${linkRoot}>+ Collega archivio…</button>
        </div>
        ${msg ? html`<div class="notice">${msg}</div>` : null}
        <div class="table">
          <div class="trow thead"><div>Nome</div><div>Formato</div><div>Fogli</div><div>Foto</div><div>Cartella</div><div>Modificato</div><div></div></div>
          ${shown.map(function (e) {
            var stt = status[e.id];
            return html`<div class=${cls('trow', stt === 'missing' && 'off')} key=${e.id} onClick=${function () { openEntry(e); }} role="button" tabindex="0">
              <div><strong>${e.name}</strong>
                ${stt === 'missing' ? html`<span class="warn">Non disponibile · disco non collegato</span>` : null}
                ${stt === 'locked' ? html`<span class="muted small">Clic per riattivare l’accesso</span>` : null}
              </div>
              <div>${e.summary.size}<span class="muted small">${e.summary.measure === 'single' ? 'Pagina singola' : 'Tavola doppia'}</span></div>
              <div>${e.summary.sheets}</div>
              <div>${e.summary.photos}</div>
              <div class="muted mono">${e.folderName}</div>
              <div class="muted">${new Date(e.updatedAt).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              <div class="rowbtns"><button class="icon-btn dup" aria-label="Duplica progetto" title="Duplica progetto" onClick=${function (ev) { duplicateEntry(e, ev); }}><i></i></button><button class="icon-btn" aria-label="Togli dall'elenco" title="Togli dall'elenco" onClick=${function (ev) { removeEntry(e, ev); }}>×</button></div>
            </div>`;
          })}
          ${!shown.length ? html`<div class="trow empty-row"><div>Nessun progetto. Crea il primo con «Nuovo progetto» o apri una cartella che ne contiene uno.</div></div>` : null}
        </div>
        <p class="muted small">Ogni progetto è un file .album nella cartella del servizio. Questo elenco ricorda solo dove si trovano: clic su una riga per riaprirlo.</p>
      </div>
      ${chooser ? html`<div class="modal-bg" onClick=${function () { setChooser(null); }}>
        <div class="modal" onClick=${function (e) { e.stopPropagation(); }}>
          <div class="modal-head col"><h2>Quale progetto apro?</h2><span class="muted small">In «${chooser.dir.name}» ci sono ${chooser.names.length} progetti</span></div>
          <div class="modal-sec">
            ${chooser.names.map(function (n) { return html`<button class="btn listbtn" key=${n} onClick=${function () { openFromFolder(chooser.dir, n); }}>${n.replace(/\.album$/i, '')}</button>`; })}
          </div>
          <div class="modal-foot"><span class="grow"></span><button class="btn" onClick=${function () { setChooser(null); }}>Annulla</button></div>
        </div>
      </div>` : null}
    </div>`;
  }

  // ======================================================================
  // Nuovo progetto
  // ======================================================================
  function loadFormats() { try { return JSON.parse(localStorage.getItem('impaginatore.formats') || '[]'); } catch (e) { return []; } }
  function saveFormats(l) { try { localStorage.setItem('impaginatore.formats', JSON.stringify(l.slice(0, 12))); } catch (e) { /* niente */ } }

  function NewProject(props) {
    var init = { name: '', measure: 'single', inputW: '40,5', inputH: '30,5', sheets: '10', gap: '0,5', margin: '1', border: '0', safetyOn: false, sTop: '0,5', sBottom: '0,5', sLeft: '0,5', sRight: '0,5', useChapters: false };
    var fs = useState(init), f = fs[0], setF = fs[1];
    var ds = useState(null), dir = ds[0], setDir = ds[1];
    var es = useState(''), err = es[0], setErr = es[1];
    var fm = useState(loadFormats), formats = fm[0], setFormats = fm[1];
    var tab = useState('recent'), tabV = tab[0], setTab = tab[1];

    function set(k, v) { setF(function (o) { var n = Object.assign({}, o); n[k] = v; return n; }); }
    var w = num(f.inputW), h = num(f.inputH);
    var spreadW = f.measure === 'single' ? w * 2 : w;
    var px = Exporter.cmToPx(spreadW, 300) + ' × ' + Exporter.cmToPx(h, 300) + ' px';

    function switchMeasure(m) {
      if (m === f.measure) return;
      var cw = num(f.inputW);
      setF(function (o) { return Object.assign({}, o, { measure: m, inputW: cw > 0 ? fmt(m === 'double' ? cw * 2 : cw / 2) : o.inputW }); });
    }
    function pickDir() {
      Store.pickDirectory({ id: 'servizi' }).then(function (d) {
        setDir(d);
        if (!f.name) set('name', d.name);
      }).catch(function () { });
    }
    function applyFormat(x) {
      setF(function (o) { return Object.assign({}, o, { measure: x.measure, inputW: fmt(x.w), inputH: fmt(x.h), sheets: String(x.sheets) }); });
    }
    function rememberFormat(fav) {
      var x = { measure: f.measure, w: w, h: h, sheets: parseInt(f.sheets, 10) || 10, fav: !!fav };
      var l = formats.filter(function (y) { return !(y.measure === x.measure && y.w === x.w && y.h === x.h); });
      var old = formats.filter(function (y) { return y.measure === x.measure && y.w === x.w && y.h === x.h; })[0];
      if (old && old.fav) x.fav = true;
      l.unshift(x); setFormats(l); saveFormats(l);
    }

    function create() {
      setErr('');
      var sheets = parseInt(f.sheets, 10);
      if (!f.name.trim()) return setErr('Scrivi il nome del progetto.');
      if (!dir) return setErr('Scegli la cartella del servizio.');
      if (!(w > 0 && h > 0)) return setErr('Controlla le misure.');
      if (!(sheets >= 1 && sheets <= 200)) return setErr('Il numero di fogli deve essere tra 1 e 200.');
      var fileName = Store.projectFileName(f.name.trim());
      dir.getFileHandle(fileName).then(function () { throw new Error('esiste'); }, function () { }).then(function () {
        var proj = U.newProject({
          name: f.name.trim(), measure: f.measure, inputW: w, inputH: h, sheets: sheets,
          gap: num(f.gap), margin: num(f.margin), border: num(f.border),
          safetyOn: f.safetyOn, safety: { top: num(f.sTop), bottom: num(f.sBottom), left: num(f.sLeft), right: num(f.sRight) },
          useChapters: f.useChapters
        });
        rememberFormat(false);
        var sess = new Session(dir, fileName, proj, proj.id);
        return activeRoots().then(function (roots) { sess.roots = roots; return sess.save(); }).then(function () { props.onCreated(sess); });
      }).catch(function (e) {
        if (e.message === 'esiste') setErr('In questa cartella c’è già un progetto con questo nome.');
        else setErr('Impossibile creare il progetto: ' + e.message);
      });
    }

    function field(label, key, unit, extra) {
      return html`<label class="field">${label}
        <span class="inp"><input type="text" inputmode="decimal" value=${f[key]} onInput=${function (e) { set(key, e.target.value); }} ...${extra || {}} />${unit ? html`<em>${unit}</em>` : null}</span>
      </label>`;
    }

    var shownFormats = formats.filter(function (x) { return tabV === 'recent' || x.fav; });

    return html`<div class="modal-bg">
      <div class="modal wide">
        <div class="modal-head"><h2>Nuovo progetto</h2><span class="muted small">300 dpi · sRGB</span></div>
        <div class="np-body">
          <div class="np-side">
            <div class="seg small-seg">
              <button class=${tabV === 'recent' ? 'on' : ''} onClick=${function () { setTab('recent'); }}>Recenti</button>
              <button class=${tabV === 'fav' ? 'on' : ''} onClick=${function () { setTab('fav'); }}>Preferiti</button>
            </div>
            ${shownFormats.map(function (x, i) {
              return html`<button class="preset" key=${i} onClick=${function () { applyFormat(x); }}>
                <span class="pv" style=${{ width: Math.min(40, 24 * (x.measure === 'single' ? x.w * 2 : x.w) / x.h / 2) + 'px' }}></span>
                <span><strong>${fmt(x.w)} × ${fmt(x.h)} cm</strong><span class="muted small">${x.measure === 'single' ? 'Pagina singola' : 'Tavola doppia'} · ${x.sheets} fogli${x.fav ? ' · ★' : ''}</span></span>
              </button>`;
            })}
            ${!shownFormats.length ? html`<p class="muted small">${tabV === 'recent' ? 'I formati usati compariranno qui.' : 'Nessun formato preferito.'}</p>` : null}
          </div>
          <div class="np-main">
            <label class="field">Nome progetto
              <span class="inp"><input type="text" value=${f.name} onInput=${function (e) { set('name', e.target.value); }} placeholder="Es. Matrimonio Nicola e Josella" /></span>
            </label>
            <div class="field">Cartella del servizio
              <div class="row">
                <div class="inp grow mono">${dir ? dir.name : 'Nessuna cartella scelta'}</div>
                <button class="btn" onClick=${pickDir}>Scegli…</button>
              </div>
              <span class="muted small">Il file del progetto viene salvato qui, accanto alle foto.</span>
            </div>
            <div class="row between">
              <span class="muted">Misura</span>
              <div class="seg" role="group" aria-label="Tipo di misura">
                <button class=${f.measure === 'single' ? 'on' : ''} onClick=${function () { switchMeasure('single'); }}>Pagina singola</button>
                <button class=${f.measure === 'double' ? 'on' : ''} onClick=${function () { switchMeasure('double'); }}>Tavola doppia</button>
              </div>
            </div>
            <div class="grid3">
              ${field(f.measure === 'single' ? 'Larghezza pagina' : 'Larghezza tavola', 'inputW', 'cm')}
              ${field('Altezza', 'inputH', 'cm')}
              ${field('Fogli', 'sheets', '')}
            </div>
            <div class="result">Tavola esportata: <strong>${fmt(spreadW)} × ${fmt(h)} cm</strong> · ${px}</div>
            <span class="muted small">L’abbondanza è già compresa nelle misure.</span>
            <div class="grid3">
              ${field('Spacco iniziale', 'gap', 'cm')}
              ${field('Margine iniziale', 'margin', 'cm')}
              ${field('Bordi iniziali', 'border', 'cm')}
            </div>
            <div class="sep"></div>
            <label class="check"><input type="checkbox" checked=${f.safetyOn} onChange=${function (e) { set('safetyOn', e.target.checked); }} /> Margini di sicurezza <span class="muted small">sul contorno esterno della tavola (non al centro), linee da mostrare a richiesta</span></label>
            ${f.safetyOn ? html`<div class="grid4">${field('Sopra', 'sTop', 'cm')}${field('Sotto', 'sBottom', 'cm')}${field('Sinistra', 'sLeft', 'cm')}${field('Destra', 'sRight', 'cm')}</div>` : null}
            <label class="check"><input type="checkbox" checked=${f.useChapters} onChange=${function (e) { set('useChapters', e.target.checked); }} /> Usa capitoli <span class="muted small">per i matrimoni</span></label>
            ${err ? html`<div class="error">${err}</div>` : null}
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn ghost" onClick=${function () { rememberFormat(true); }}>Salva formato nei preferiti</button>
          <span class="grow"></span>
          <button class="btn" onClick=${props.onCancel}>Annulla</button>
          <button class="btn primary" onClick=${create}>Crea progetto</button>
        </div>
      </div>
    </div>`;
  }

  // ======================================================================
  // Esporta
  // ======================================================================
  function ExportDialog(props) {
    var session = props.session, p = session.project;
    var os = useState(function () {
      var pq = 'media', what = 'both';
      try { pq = localStorage.getItem('impaginatore.provino') || 'media'; what = localStorage.getItem('impaginatore.esporta') || 'both'; } catch (e) { }
      return { jpg: what !== 'pdf', pdf: what !== 'jpg', prefix: 'tavola-', range: '', quality: 100, pdfq: PROOF[pq] ? pq : 'media' };
    }), o = os[0], setO = os[1];
    var ds = useState(null), dir = ds[0], setDir = ds[1];
    var rs = useState(null), run = rs[0], setRun = rs[1];
    function set(k, v) { setO(function (x) { var n = Object.assign({}, x); n[k] = v; return n; }); }
    function setWhat(w) {
      setO(function (x) { return Object.assign({}, x, { jpg: w !== 'pdf', pdf: w !== 'jpg' }); });
      setRun(null);
      try { localStorage.setItem('impaginatore.esporta', w); } catch (e) { }
    }

    function parseRange(txt, n) {
      if (!txt.trim()) return Array.from({ length: n }, function (_, i) { return i; });
      var out = [];
      txt.split(',').forEach(function (part) {
        var m = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
        if (!m) return;
        var a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
        for (var i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= n && out.indexOf(i - 1) < 0) out.push(i - 1);
      });
      return out.sort(function (a, b) { return a - b; });
    }

    function styleOfFor(spread) {
      return function (item) { return !spread.split ? spread.s : (item.side === 'R' ? spread.sR : spread.sL); };
    }

    function go() {
      var list = parseRange(o.range, p.spreads.length);
      if (!list.length) { setRun({ error: 'Nessuna tavola nell’intervallo indicato.' }); return; }
      var digits = Math.max(2, String(p.spreads.length).length);
      var target = !o.jpg ? Promise.resolve(null) : dir ? Promise.resolve(dir) : Store.dirAt(session.service, ['Tavole stampa'], true);
      var steps = (o.jpg ? list.length : 0) + (o.pdf ? p.spreads.length : 0), step = 0;
      setRun({ step: 0, steps: steps, label: 'Preparazione…' });
      function bitmapOf(pid) {
        return session.fileOf(session.byId[pid]).then(function (f) { return createImageBitmap(f); });
      }
      function release(pid, bmp) { bmp.close(); }
      var arOf = function (pid) { return session.arOf(pid); };
      var chain = target.then(function (outDir) {
        var c = Promise.resolve();
        if (o.jpg) list.forEach(function (i) {
          c = c.then(function () {
            setRun({ step: step, steps: steps, label: 'Tavola ' + (i + 1) + ' di ' + p.spreads.length + ' (JPG)' });
            var sp = p.spreads[i];
            return Exporter.renderSpread({ spread: sp, size: p.size, dpi: 300, arOf: arOf, getBitmap: bitmapOf, release: release, styleOf: styleOfFor(sp) })
              .then(function (cv) { return Exporter.canvasToJpeg(cv, o.quality / 100, 300); })
              .then(function (blob) { return Store.writeFile(outDir, o.prefix + String(i + 1).padStart(digits, '0') + '.jpg', blob); })
              .then(function () { step++; });
          });
        });
        if (o.pdf) {
          var pages = [];
          p.spreads.forEach(function (sp, i) {
            c = c.then(function () {
              setRun({ step: step, steps: steps, label: 'Provino: tavola ' + (i + 1) + ' di ' + p.spreads.length });
              var thumbBmp = function (pid) {
                var url = session.previews[pid] || session.thumbs[pid];
                var ph = session.byId[pid];
                var src = session.previews[pid] ? fetch(url).then(function (r) { return r.blob(); }) : Store.previewFor(session.service, ph, function () { return session.fileOf(ph); }).catch(function () { return fetch(session.thumbs[pid]).then(function (r) { return r.blob(); }); });
                return src.then(function (b) { return createImageBitmap(b); });
              };
              var pq = PROOF[o.pdfq] || PROOF.media;
              return Exporter.renderSpread({ spread: sp, size: p.size, dpi: pq.dpi, arOf: arOf, getBitmap: pq.orig ? bitmapOf : thumbBmp, release: release, styleOf: styleOfFor(sp) })
                .then(function (cv) { return cv.convertToBlob({ type: 'image/jpeg', quality: pq.q }); })
                .then(function (b) { return b.arrayBuffer(); })
                .then(function (buf) { pages.push({ jpeg: new Uint8Array(buf), wPt: p.size.w / 2.54 * 72, hPt: p.size.h / 2.54 * 72 }); step++; });
            });
          });
          c = c.then(function () {
            return Store.writeFile(session.service, p.name.replace(/[\/\\:*?"<>|]/g, '-') + ' - provino.pdf', Exporter.buildPdf(pages));
          });
        }
        return c.then(function () { return outDir; });
      });
      chain.then(function (outDir) {
        setRun({ done: true, msg: (o.jpg ? list.length + ' tavole JPG in «' + outDir.name + '»' : '') + (o.jpg && o.pdf ? ' · ' : '') + (o.pdf ? 'provino PDF in «' + session.service.name + '»' : '') });
      }).catch(function (e) { console.error(e); setRun({ error: 'Esportazione interrotta: ' + e.message }); });
    }

    function pickOut() {
      Store.pickDirectory({ startIn: session.service }).then(setDir).catch(function () { });
    }

    var busy = run && !run.done && !run.error && run.steps;
    return html`<div class="modal-bg">
      <div class="modal">
        <div class="modal-head col"><h2>Esporta</h2><span class="muted small">${p.name} · ${p.spreads.length} tavole</span></div>
        <div class="modal-sec">
          <div class="seg what" role="group" aria-label="Cosa esportare">${[['both', 'Tavole + provino'], ['jpg', 'Solo tavole (JPG)'], ['pdf', 'Solo provino (PDF)']].map(function (w) {
            var on = w[0] === 'both' ? o.jpg && o.pdf : w[0] === 'jpg' ? o.jpg && !o.pdf : !o.jpg && o.pdf;
            return html`<button key=${w[0]} class=${on ? 'on' : ''} onClick=${function () { setWhat(w[0]); }}>${w[1]}</button>`;
          })}</div>
        </div>
        ${o.jpg ? html`<div class="modal-sec">
          <strong>Tavole per la stampa (JPG)</strong>
          <div class="field">Cartella
            <div class="row"><div class="inp grow mono">${dir ? dir.name : session.service.name + ' / Tavole stampa'}</div><button class="btn" onClick=${pickOut}>Scegli…</button></div>
          </div>
          <div class="grid2">
            <label class="field">Nome file<span class="inp"><input type="text" value=${o.prefix} onInput=${function (e) { set('prefix', e.target.value); }} /></span><span class="muted small">${o.prefix}01.jpg, ${o.prefix}02.jpg…</span></label>
            <label class="field">Tavole<span class="inp"><input type="text" value=${o.range} placeholder="Tutte (es. 1-3, 7)" onInput=${function (e) { set('range', e.target.value); }} /></span></label>
          </div>
          <div class="result row">
            <span class="grow">${fmt(p.size.w)} × ${fmt(p.size.h)} cm · ${Exporter.cmToPx(p.size.w, 300)} × ${Exporter.cmToPx(p.size.h, 300)} px · 300 dpi · sRGB</span>
            <label class="row">Qualità <input type="range" min="70" max="100" value=${o.quality} onInput=${function (e) { set('quality', +e.target.value); }} /> ${o.quality}%</label>
          </div>
        </div>` : null}
        ${o.pdf ? html`<div class="modal-sec">
          <strong>Provino per il cliente (PDF)</strong>
          <span class="muted small mono">${p.name} - provino.pdf · nella cartella del servizio</span>
          <div class="row proofq">
            <span class="muted small">Qualità</span>
            <div class="seg">${Object.keys(PROOF).map(function (k) {
              return html`<button key=${k} class=${o.pdfq === k ? 'on' : ''} onClick=${function () { set('pdfq', k); try { localStorage.setItem('impaginatore.provino', k); } catch (e) { } }}>${PROOF[k].label}</button>`;
            })}</div>
            <span class="muted small">${Exporter.cmToPx(p.size.w, PROOF[o.pdfq].dpi)} × ${Exporter.cmToPx(p.size.h, PROOF[o.pdfq].dpi)} px · ${PROOF[o.pdfq].note}</span>
          </div>
          <span class="muted small">Il provino comprende sempre tutte le tavole.</span>
        </div>` : null}
        ${run ? html`<div class="modal-sec">
          ${run.error ? html`<div class="error">${run.error}</div>` : null}
          ${run.done ? html`<div class="okmsg">Fatto: ${run.msg}</div>` : null}
          ${busy ? html`<div class="progress"><div style=${{ width: (run.step / run.steps * 100) + '%' }}></div></div><span class="muted small">${run.label}</span>` : null}
        </div>` : null}
        <div class="modal-foot">
          <span class="grow"></span>
          <button class="btn" onClick=${props.onClose} disabled=${busy}>${run && run.done ? 'Chiudi' : 'Annulla'}</button>
          ${!(run && run.done) ? html`<button class="btn primary" onClick=${go} disabled=${busy || (!o.jpg && !o.pdf)}>Esporta</button>` : null}
        </div>
      </div>
    </div>`;
  }

  // ======================================================================
  // Combinazioni (griglia di alternative)
  // ======================================================================
  function CombosDialog(props) {
    var session = props.session, spread = props.spread, key = props.regionKey, count = props.count;
    var shown = Math.min(count, 24);
    var field = COMBO_FIELD[key], tf = TREE_FIELD[key];
    var tiles = [];
    for (var i = 0; i < shown; i++) {
      var ov = {}; ov[field] = i; ov[tf] = null;
      tiles.push(html`<button class=${cls('combo-tile', !props.custom && props.index === i && 'on')} key=${i} onClick=${(function (k) { return function () { props.onPick(k); }; })(i)}>
        <${SpreadView} session=${session} spread=${spread} scale=${260 / session.project.size.w} comboOverride=${ov} className="static" />
      </button>`);
    }
    return html`<div class="modal-bg" onClick=${props.onClose}>
      <div class="modal combos" onClick=${function (e) { e.stopPropagation(); }}>
        <div class="modal-head"><h2>Combinazioni</h2><span class="muted small">${count} alternative${key !== 'S' ? (key === 'L' ? ' · pagina sinistra' : ' · pagina destra') : ''}</span></div>
        <div class="combo-grid">${tiles}</div>
        <div class="modal-foot"><span class="grow"></span><button class="btn" onClick=${props.onClose}>Chiudi</button></div>
      </div>
    </div>`;
  }

  // ---------- componenti che si ridisegnano solo quando serve ----------
  function PhotoGrid(props) { Component.call(this, props); }
  PhotoGrid.prototype = Object.create(Component.prototype);
  PhotoGrid.prototype.constructor = PhotoGrid;
  PhotoGrid.prototype.shouldComponentUpdate = function (np) { return np.sig !== this.props.sig; };
  PhotoGrid.prototype.render = function (props) {
    var session = props.session, api = props.api, used = props.used, here = props.here, sel = props.sel, colors = props.chapterColor;
    return html`<div class="grid">
      ${props.photos.map(function (ph, i) {
        var u = used[ph.id];
        return html`<div key=${ph.id} data-pid=${ph.id} class=${cls('tile', sel[ph.id] && 'sel', u && 'used', here[ph.id] && 'here')}
          draggable="true" onDragStart=${function (e) { api.current.tileDragStart(e, ph); }} onDragEnd=${function () { api.current.dragEnd(); }}
          onClick=${function (e) { api.current.tileClick(e, ph, i); }} onDblClick=${function () { api.current.tileDbl(ph); }} title=${ph.path}
          style=${ph.chapter && colors[ph.chapter] ? { boxShadow: 'inset 0 2px 0 ' + colors[ph.chapter] } : null}>
          ${session.thumbs[ph.id] ? html`<img src=${session.thumbs[ph.id]} draggable=${false} loading="lazy" />` : html`<span class="ph-wait"></span>`}
          <span class="nm">${ph.name.replace(/\.jpe?g$/i, '')}</span>
          ${u ? html`<span class="badge">${u > 1 ? u : '✓'}</span>` : null}
        </div>`;
      })}
    </div>`;
  };

  // Qualita' del provino PDF: risoluzione della tavola, compressione e sorgente delle foto
  var PROOF = {
    leggera: { label: 'Leggera', dpi: 60, q: 0.72, orig: false, note: 'file piccolo, poco nitido' },
    media: { label: 'Media', dpi: 110, q: 0.84, orig: false, note: 'nitido a schermo, adatto all’invio' },
    alta: { label: 'Alta', dpi: 160, q: 0.9, orig: true, note: 'molto nitido, file pesante, più lento' }
  };

  function StripItem(props) { Component.call(this, props); }
  StripItem.prototype = Object.create(Component.prototype);
  StripItem.prototype.constructor = StripItem;
  StripItem.prototype.shouldComponentUpdate = function (np) { return np.sig !== this.props.sig; };
  StripItem.prototype.render = function (props) {
    return html`<button class=${cls('strip-item', props.on && 'on', props.mark)} onClick=${props.onClick} onPointerDown=${props.onPointerDown}
      title=${'Tavola ' + (props.index + 1) + ' · trascina per spostarla'}>
      <${SpreadView} session=${props.session} spread=${props.spread} scale=${34 / props.session.project.size.h} className="static" />
      <span>${props.index + 1}</span>
    </button>`;
  };

  function Slider(props) {
    var v = props.value || 0;
    return html`<div class="tool slider">
      <div class="row between"><span>${props.label}</span>
        <input class="val" type="text" inputmode="decimal" aria-label=${props.label + ' in cm'} value=${fmt(v)}
          onChange=${function (e) { props.onCommit(Math.min(props.max * 3, Math.max(0, num(e.target.value)))); }} /></div>
      <input type="range" min="0" max=${props.max} step=${props.step} value=${v} aria-label=${props.label}
        onPointerDown=${props.onStart} onKeyDown=${props.onStart}
        onInput=${function (e) { props.onLive(+e.target.value); }} onChange=${props.onEnd} />
    </div>`;
  }

  // ======================================================================
  // Editor
  // ======================================================================
  function Editor(props) {
    var session = useSession(props.session), p = session.project;
    var cur = useState(0), ci = Math.min(cur[0], p.spreads.length - 1), setCi = cur[1];
    var sel = useState([]), selIds = sel[0], setSelIds = sel[1];
    function setSelectedId(id) { setSelIds(id ? [id] : []); }
    var clip = useRef(null), marqueeMoved = useRef(false);
    var mq = useState(null), marquee = mq[0], setMarquee = mq[1];
    var cv = useState(0), setClipV = cv[1];
    var side = useState('L'), activeSide = side[0], setActiveSide = side[1];
    var cr = useState(null), cropId = cr[0], setCropId = cr[1];
    var pv = useState(null), preview = pv[0], setPreview = pv[1];
    var lv = useState(false), live = lv[0], setLive = lv[1];
    var crs = useState(null), cropRect = crs[0], setCropRect = crs[1];
    var gs = useState({}), gridSel = gs[0], setGridSel = gs[1];
    var fl = useState({ use: 'all', orient: 'all', chapter: 'all', sort: 'name' }), filt = fl[0], setFilt = fl[1];
    var dl = useState(null), dialog = dl[0], setDialog = dl[1];
    var ms = useState(''), msg = ms[0], setMsg = ms[1];
    var stageRef = useRef(null), spreadRef = useRef(null), api = useRef({}), lastClick = useRef(null), sliding = useRef(false);
    var sz = useState({ w: 1000, h: 400 }), stage = sz[0], setStage = sz[1];
    var ph0 = useState(function () { var v = 0; try { v = parseInt(localStorage.getItem('impaginatore.panel'), 10); } catch (e) { } return v > 0 ? v : Math.round(Math.min(320, Math.max(150, root.innerHeight * 0.32))); });
    var panelH = ph0[0], setPanelH = ph0[1];
    var panelHRef = useRef(panelH); panelHRef.current = panelH;
    var dk = useState(function () { var v = ''; try { v = localStorage.getItem('impaginatore.dock'); } catch (e) { } return v === 'right' ? 'right' : 'bottom'; });
    var dock = dk[0], setDockState = dk[1];
    function setDock(v) { setDockState(v); try { localStorage.setItem('impaginatore.dock', v); } catch (e) { } }
    var pw0 = useState(function () { var v = 0; try { v = parseInt(localStorage.getItem('impaginatore.panelW'), 10); } catch (e) { } return v > 0 ? v : Math.round(Math.min(720, Math.max(320, root.innerWidth * 0.3))); });
    var panelW = pw0[0], setPanelW = pw0[1];
    var panelWRef = useRef(panelW); panelWRef.current = panelW;
    var sd = useState(null), stripDrag = sd[0], setStripDrag = sd[1];
    var ad = useState(null), askDir = ad[0], setAskDir = ad[1];
    var lk = useState(null), look = lk[0], setLook = lk[1];      // anteprima grande (id foto)
    var lastArea = useRef('grid');                                 // ultimo clic: libreria o tavola
    var flashT = useRef(null);
    var stripRef = useRef(null), stripMoved = useRef(false);
    var tz = useState(function () { var v = 0; try { v = parseInt(localStorage.getItem('impaginatore.tile'), 10); } catch (e) { } return v >= 70 && v <= 360 ? v : 96; });
    var tileSize = tz[0], setTileSizeState = tz[1];
    function setTileSize(v) { setTileSizeState(v); try { localStorage.setItem('impaginatore.tile', String(v)); } catch (e) { } }

    var spread = p.spreads[ci];
    var size = p.size;
    var arOf = function (pid) { return session.arOf(pid); };

    useEffect(function () { session.loadThumbs(); }, [session]);
    useEffect(function () {
      function warn(e) { if (session.saveState !== 'saved') { session.save(); e.preventDefault(); e.returnValue = ''; } }
      root.addEventListener('beforeunload', warn);
      return function () { root.removeEventListener('beforeunload', warn); };
    }, [session]);
    useEffect(function () {
      var el = stageRef.current; if (!el) return;
      var ro = new ResizeObserver(function () { setStage({ w: el.clientWidth, h: el.clientHeight }); });
      ro.observe(el); return function () { ro.disconnect(); };
    }, []);

    function startResize(e) {
      e.preventDefault();
      if (dock === 'right') {
        var x0 = e.clientX, w0 = panelW;
        var mvw = function (ev) { setPanelW(Math.round(Math.min(root.innerWidth - 520, Math.max(260, w0 + (x0 - ev.clientX))))); };
        var upw = function () { root.removeEventListener('pointermove', mvw); root.removeEventListener('pointerup', upw); try { localStorage.setItem('impaginatore.panelW', String(panelWRef.current)); } catch (er) { } };
        root.addEventListener('pointermove', mvw); root.addEventListener('pointerup', upw);
        return;
      }
      var y0 = e.clientY, h0 = panelH;
      function mv(ev) { setPanelH(Math.round(Math.min(root.innerHeight - 260, Math.max(110, h0 + (y0 - ev.clientY))))); }
      function up() { root.removeEventListener('pointermove', mv); root.removeEventListener('pointerup', up); try { localStorage.setItem('impaginatore.panel', String(panelHRef.current)); } catch (er) { } }
      root.addEventListener('pointermove', mv); root.addEventListener('pointerup', up);
    }

    // ---------- riordino delle tavole trascinandole nella striscia ----------
    function stripDown(i, e) {
      if (e.button !== 0) return;
      var strip = stripRef.current; if (!strip) return;
      var x0 = e.clientX, y0 = e.clientY, started = false, slot = i, lastX = x0, timer = null;
      stripMoved.current = false;
      function slotAt(x) {
        var els = strip.querySelectorAll('.strip-item');
        for (var k = 0; k < els.length; k++) { var r = els[k].getBoundingClientRect(); if (x < r.left + r.width / 2) return k; }
        return els.length;
      }
      function update() { slot = slotAt(lastX); setStripDrag({ from: i, slot: slot }); }
      function mv(ev) {
        lastX = ev.clientX;
        if (!started) {
          if (Math.abs(ev.clientX - x0) < 6 && Math.abs(ev.clientY - y0) < 6) return;
          started = true; stripMoved.current = true;
          // scorrimento automatico vicino ai bordi della striscia
          timer = setInterval(function () {
            var r = strip.getBoundingClientRect(), d = 0;
            if (lastX < r.left + 50) d = -14; else if (lastX > r.right - 50) d = 14;
            if (d) { strip.scrollLeft += d; update(); }
          }, 30);
        }
        update();
      }
      function up() {
        root.removeEventListener('pointermove', mv); root.removeEventListener('pointerup', up);
        if (timer) clearInterval(timer);
        if (!started) return;
        setStripDrag(null);
        var dest = slot > i ? slot - 1 : slot;
        if (dest === i) return;
        session.commit(function (pp) { var s = pp.spreads.splice(i, 1)[0]; pp.spreads.splice(dest, 0, s); });
        setCi(dest); setSelectedId(null); setCropId(null);
        flash('Tavola ' + (i + 1) + ' spostata in posizione ' + (dest + 1));
      }
      root.addEventListener('pointermove', mv); root.addEventListener('pointerup', up);
    }

    var scale = Math.max(1, Math.min((stage.w - 40) / size.w, (stage.h - 40) / size.h));
    var lay = Layout.layoutSpread(spread, size, arOf);

    var regionKey = spread.split ? activeSide : 'S';
    var region = lay.regions.filter(function (r) { return r.key === regionKey; })[0] || { count: 1, index: 0, custom: false };
    var styleKey = STYLE_FIELD[regionKey], style = spread[styleKey];
    // in pagina intera il margine esterno e' separato da quello in modalita' formato
    var marginKey = style.mode === 'fill' ? 'fmargin' : 'margin';
    var comboKey = COMBO_FIELD[regionKey], treeKey = TREE_FIELD[regionKey];
    var selList = spread.items.filter(function (x) { return selIds.indexOf(x.id) >= 0; });
    var selItem = selList.length === 1 ? selList[0] : null;
    var selectedId = selItem ? selItem.id : null;

    function flash(t) { setMsg(t); clearTimeout(flashT.current); flashT.current = setTimeout(function () { setMsg(''); }, 2400); }

    // ---------- stile (cursori) ----------
    function styleStart() { if (!sliding.current) { session.pushUndo(); sliding.current = true; setLive(true); } }
    function styleLive(k, v) { spread[styleKey][k] = v; session.notifySoon(); }
    function styleEnd() { sliding.current = false; setLive(false); session.changed(); }
    function setStyle(k, v) { session.commit(function () { spread[styleKey][k] = v; }); }
    function applyAll() {
      session.commit(function (pp) {
        var src = U.clone(style);
        pp.spreads.forEach(function (sp) { ['s', 'sL', 'sR'].forEach(function (k) { sp[k] = U.clone(src); }); });
        pp.style = U.clone(src);
      });
      flash('Stile applicato a tutte le tavole');
    }

    // ---------- comandi ----------
    function combo(delta) {
      session.commit(function () {
        var base = region.custom ? region.index - (delta > 0 ? 1 : 0) : region.index;
        spread[treeKey] = null;
        spread[comboKey] = ((base + delta) % region.count + region.count) % region.count;
      });
    }
    function toggleMode() { setStyle('mode', style.mode === 'fill' ? 'fit' : 'fill'); }
    function toggleSplit() {
      session.commit(function () {
        if (!spread.split) {
          var half = Math.ceil(spread.items.length / 2);
          spread.items.forEach(function (it, i) { it.side = i < half ? 'L' : 'R'; });
          spread.sL = U.clone(spread.s); spread.sR = U.clone(spread.s); spread.comboL = 0; spread.comboR = 0;
          spread.treeL = null; spread.treeR = null; spread.split = true;
        } else {
          spread.s = U.clone(spread.sL); spread.split = false; spread.combo = 0; spread.tree = null;
          spread.items.forEach(function (it) { delete it.side; });
        }
      });
    }
    function shuffle() {
      session.commit(function () {
        var idxs = [];
        spread.items.forEach(function (it, i) { if (regionOf(spread, it) === regionKey) idxs.push(i); });
        var vals = idxs.map(function (i) { return spread.items[i]; });
        for (var i = vals.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = vals[i]; vals[i] = vals[j]; vals[j] = t; }
        idxs.forEach(function (i, k) { spread.items[i] = vals[k]; });
        spread[treeKey] = null; spread[comboKey] = 0; spread.eng = 3;
      });
    }
    function toggleBW() {
      session.commit(function () {
        if (selList.length) { var anyC = selList.some(function (it) { return !it.bw; }); selList.forEach(function (it) { it.bw = anyC; }); }
        else { var any = spread.items.some(function (it) { return !it.bw; }); spread.items.forEach(function (it) { it.bw = any; }); }
      });
    }
    function toggleGuides() {
      if (!p.safety.enabled) { flash('Margini di sicurezza non impostati per questo progetto'); return; }
      session.commit(function () { p.safety.show = !p.safety.show; }, { noUndo: true });
    }
    function removeSelected() {
      if (!selList.length) return;
      var ids = selList.map(function (it) { return it.id; });
      session.commit(function () { ids.forEach(function (id) { removeItem(spread, id, size, arOf); }); });
      setSelectedId(null); setCropId(null);
    }

    // ---------- copia / taglia / incolla (dentro lo stesso album) ----------
    function selectAll() {
      var key = spread.split ? activeSide : 'S';
      var ids = itemsOf(spread, key).map(function (it) { return it.id; });
      if (cropId) endCrop();
      setSelIds(ids);
      if (!ids.length) flash('La ' + (spread.split ? 'pagina' : 'tavola') + ' è vuota');
    }
    function copySel(cut) {
      if (cropId) return;
      var list = selList;
      if (!list.length) { flash('Seleziona prima una o più foto (⌘A = tutta la ' + (spread.split ? 'pagina' : 'tavola') + ')'); return; }
      var keys = {}; list.forEach(function (it) { keys[regionOf(spread, it)] = 1; });
      var ks = Object.keys(keys), whole = null;
      if (ks.length === 1) {
        var k = ks[0], all = itemsOf(spread, k);
        if (all.length === list.length) {
          var tr = spread[TREE_FIELD[k]];
          whole = { style: U.clone(spread[STYLE_FIELD[k]] || spread.s), tree: tr && O.sameIds(tr, all) ? U.clone(tr) : null, combo: spread[COMBO_FIELD[k]] || 0, eng: spread.eng || 0 };
        }
      }
      clip.current = { items: list.map(function (it) { return { id: it.id, pid: it.pid, crop: it.crop ? U.clone(it.crop) : null, bw: !!it.bw }; }), whole: whole };
      setClipV(function (v) { return v + 1; });
      var n = list.length, what = n === 1 ? '1 foto' : n + ' foto';
      if (cut) {
        var ids = list.map(function (it) { return it.id; });
        session.commit(function () { ids.forEach(function (id) { removeItem(spread, id, size, arOf); }); });
        setSelectedId(null);
        flash(what + (n === 1 ? ' tagliata' : ' tagliate') + ': vai su un’altra tavola e premi ⌘V');
      } else flash(what + (n === 1 ? ' copiata' : ' copiate') + ': vai su un’altra tavola e premi ⌘V');
    }
    function paste() {
      var c = clip.current;
      if (!c || !c.items.length) { flash('Niente da incollare: prima copia (⌘C) o taglia (⌘X) delle foto'); return; }
      if (cropId) endCrop();
      var key = spread.split ? activeSide : 'S', tf = TREE_FIELD[key];
      var map = {};
      var fresh = c.items.map(function (x) {
        var id = U.uid(); map[x.id] = id;
        var it = { id: id, pid: x.pid, crop: x.crop ? U.clone(x.crop) : null, bw: x.bw };
        if (spread.split) it.side = key;
        return it;
      });
      var ids = fresh.map(function (x) { return x.id; });
      var empty = !itemsOf(spread, key).length;
      session.commit(function () {
        if (empty && c.whole) {
          // tavola vuota: stessa impaginazione (schema, ritagli, spacco, margini, bordi)
          fresh.forEach(function (x) { spread.items.push(x); });
          spread[STYLE_FIELD[key]] = U.clone(c.whole.style);
          spread[tf] = c.whole.tree ? remapTree(c.whole.tree, map) : null;
          spread[COMBO_FIELD[key]] = c.whole.combo;
          if (c.whole.eng) spread.eng = c.whole.eng; else delete spread.eng;
        } else {
          fresh.forEach(function (x) { spread.items.push(x); });
          spread[tf] = null; spread[COMBO_FIELD[key]] = 0; spread.eng = 3;
        }
        syncItems(spread);
      });
      setSelIds(ids);
      flash((ids.length === 1 ? '1 foto incollata' : ids.length + ' foto incollate') + (empty && c.whole ? ' con la stessa impaginazione' : ''));
    }

    // ---------- selezione a rettangolo ----------
    function stageDown(e) {
      if (e.button !== 0 || cropId || preview) return;
      var t = e.target;
      if (t.closest && t.closest('.ph, .divider, .floatbar, .crop-layer, button, input, select, label')) return;
      var stEl = stageRef.current, wrap = spreadRef.current;
      if (!stEl || !wrap) return;
      var x0 = e.clientX, y0 = e.clientY, started = false;
      var base = (e.shiftKey || e.metaKey) ? selIds.slice() : [];
      var placed = lay.placed;
      marqueeMoved.current = false;
      function mv(ev) {
        if (!started) {
          if (Math.abs(ev.clientX - x0) < 5 && Math.abs(ev.clientY - y0) < 5) return;
          started = true; marqueeMoved.current = true;
          if (cropId) endCrop();
        }
        ev.preventDefault();
        var str = stEl.getBoundingClientRect(), sr = wrap.getBoundingClientRect();
        var L = Math.min(x0, ev.clientX), T = Math.min(y0, ev.clientY), R = Math.max(x0, ev.clientX), B = Math.max(y0, ev.clientY);
        setMarquee({ left: L - str.left, top: T - str.top, width: R - L, height: B - T });
        var hits = placed.filter(function (pl) {
          var a = sr.left + pl.x * scale, b = sr.top + pl.y * scale, c2 = a + pl.w * scale, d = b + pl.h * scale;
          return a < R && c2 > L && b < B && d > T;
        }).map(function (pl) { return pl.item.id; });
        setSelIds(base.concat(hits.filter(function (id) { return base.indexOf(id) < 0; })));
      }
      function upM() {
        root.removeEventListener('pointermove', mv); root.removeEventListener('pointerup', upM);
        setMarquee(null);
      }
      root.addEventListener('pointermove', mv); root.addEventListener('pointerup', upM);
    }
    function addSpread() {
      session.commit(function (pp) { pp.spreads.push(U.newSpread(pp.style || Layout.defaultStyle())); });
      setCi(p.spreads.length - 1);
    }
    function deleteSpread() {
      if (p.spreads.length <= 1) return;
      if (spread.items.length && !root.confirm('Eliminare la tavola ' + (ci + 1) + ' con le sue foto?')) return;
      session.commit(function (pp) { pp.spreads.splice(ci, 1); });
      setCi(Math.max(0, ci - 1)); setSelectedId(null);
    }
    function goSpread(i) { setCi(Math.max(0, Math.min(p.spreads.length - 1, i))); setSelectedId(null); setCropId(null); }
    function margin(delta) {
      session.commit(function () { var st = spread[styleKey]; st[marginKey] = Math.max(0, Math.round(((st[marginKey] || 0) + delta) * 100) / 100); });
    }

    // ---------- trascinamento con anteprima ----------
    function pointToCm(e) {
      var r = spreadRef.current.getBoundingClientRect();
      return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
    }
    // prev = bersaglio attuale: le soglie hanno un margine, cosi' l'anteprima non salta avanti e indietro
    function computeTarget(e, prev) {
      var pt = pointToCm(e), hit = null;
      lay.placed.forEach(function (pl) { if (pt.x >= pl.x && pt.x <= pl.x + pl.w && pt.y >= pl.y && pt.y <= pl.y + pl.h) hit = pl; });
      var half = size.w / 2;
      if (hit) {
        var px = (pt.x - hit.x) / hit.w, py = (pt.y - hit.y) / hit.h;
        var ds = [['left', px], ['right', 1 - px], ['top', py], ['bottom', 1 - py]];
        var d = ds.slice().sort(function (a, b) { return a[1] - b[1]; })[0];
        var sd = hit.item.side;
        var same = prev && prev.id === hit.item.id;
        var lim = same && prev.kind === 'center' ? 0.22 : same && prev.kind === 'edge' ? 0.38 : 0.3;
        if (d[1] > lim) return { kind: 'center', id: hit.item.id, side: sd };
        if (same && prev.kind === 'edge' && prev.dir !== d[0]) {
          var pd = ds.filter(function (x) { return x[0] === prev.dir; })[0];
          if (pd && pd[1] <= lim && pd[1] - d[1] < 0.07) return prev;   // lato precedente ancora quasi alla pari: resta
        }
        return { kind: 'edge', id: hit.item.id, dir: d[0], side: sd };
      }
      return { kind: 'append', side: spread.split ? (pt.x < half ? 'L' : 'R') : undefined };
    }
    // L'anteprima cambia solo dopo una breve sosta sul nuovo punto: niente scatti mentre il cursore passa.
    var pend = useRef(null), applyPend = useRef(null);
    applyPend.current = function (t, sig) {
      if (!drag) return;
      if (t == null) { setPreview(null); return; }
      var clone = U.clone(spread);
      var touched = applyDrop(clone, t, Object.assign({ preview: true }, drag), size, arOf);
      setPreview({ sig: sig, spread: clone, touched: touched, t: t });
    };
    function schedule(t, sig, wait) {
      if (pend.current && pend.current.sig === sig) return;
      if (pend.current) clearTimeout(pend.current.timer);
      pend.current = { sig: sig, timer: setTimeout(function () { var p0 = pend.current; pend.current = null; if (p0) applyPend.current(t, sig); }, wait) };
    }
    function cancelPend() { if (pend.current) { clearTimeout(pend.current.timer); pend.current = null; } }
    function onDragOver(e) {
      if (!drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = drag.kind === 'item' ? 'move' : 'copy';
      var t = computeTarget(e, preview ? preview.t : null);
      var none = drag.kind === 'item' && t.id === drag.id;
      var sig = none ? 'none' : JSON.stringify(t);
      if ((preview && preview.sig === sig) || (!preview && none)) { cancelPend(); return; }
      schedule(none ? null : t, sig, preview ? 240 : 110);
    }
    function onDrop(e) {
      if (!drag) return;
      e.preventDefault();
      cancelPend();
      // si rilascia esattamente quello che mostra l'anteprima
      var t = preview ? preview.t : computeTarget(e), d = drag;
      drag = null; setPreview(null);
      if (d.kind === 'item' && t.id === d.id) return;
      session.commit(function () { applyDrop(spread, t, d, size, arOf); });
      if (d.kind === 'item') setSelectedId(d.id);
      if (spread.split && t.side) setActiveSide(t.side);
    }

    // ---------- bordi tra le foto ----------
    function onDividerDown(d, e) {
      e.preventDefault(); e.stopPropagation();
      session.pushUndo();
      var f = TREE_FIELD[d.region];
      materialize(spread, d.region, size, arOf);
      var node = O.nodeAt(spread[f], d.path);
      var hz = d.axis === 'h', start = hz ? e.clientX : e.clientY, s0 = d.sizes.slice();
      var total = s0[d.k] + s0[d.k + 1], MIN = Math.min(1.5, total / 4);
      setLive(true); setSelectedId(null);
      function mv(ev) {
        var delta = ((hz ? ev.clientX : ev.clientY) - start) / scale;
        var a = Math.max(MIN, Math.min(total - MIN, s0[d.k] + delta));
        var ns = s0.slice(); ns[d.k] = a; ns[d.k + 1] = total - a;
        node.w = ns;
        session.notifySoon();
      }
      function up() { root.removeEventListener('pointermove', mv); root.removeEventListener('pointerup', up); setLive(false); session.changed(); }
      root.addEventListener('pointermove', mv); root.addEventListener('pointerup', up);
    }
    function onDividerReset(d) {
      session.commit(function () {
        var f = TREE_FIELD[d.region];
        materialize(spread, d.region, size, arOf);
        var node = O.nodeAt(spread[f], d.path);
        delete node.w;
      });
    }

    // ---------- ritaglio ----------
    function startCrop(it) { setSelectedId(it.id); session.pushUndo(); setCropId(it.id); }
    function endCrop() { setCropId(null); session.changed(); }
    function cropState(it) { return Object.assign({ z: 1, cx: 0.5, cy: 0.5, r: 0 }, it.crop || {}); }
    function onCropDown(e) {
      var it = spread.items.filter(function (x) { return x.id === cropId; })[0];
      var pl = lay.placed.filter(function (x) { return x.item.id === cropId; })[0];
      if (!it || !pl) return;
      e.preventDefault(); e.stopPropagation();
      var ph = session.byId[it.pid], cw = pl.w * scale, ch = pl.h * scale;
      var c0 = cropState(it), t0 = Exporter.cropTransform(ph.w, ph.h, cw, ch, c0);
      var x0 = e.clientX, y0 = e.clientY;
      setLive(true);
      function mv(ev) {
        var dx = ev.clientX - x0, dy = ev.clientY - y0, c = Math.cos(t0.th), s = Math.sin(t0.th);
        var ux = (dx * c + dy * s) / t0.s, uy = (-dx * s + dy * c) / t0.s;
        var next = Object.assign({}, c0, { cx: (t0.cX - ux) / ph.w, cy: (t0.cY - uy) / ph.h });
        var t = Exporter.cropTransform(ph.w, ph.h, cw, ch, next);
        next.cx = t.cX / ph.w; next.cy = t.cY / ph.h;
        it.crop = next; session.notifySoon();
      }
      function up() { root.removeEventListener('pointermove', mv); root.removeEventListener('pointerup', up); setLive(false); session.changed(); }
      root.addEventListener('pointermove', mv); root.addEventListener('pointerup', up);
    }
    // Ritaglio dagli angoli: il riquadro mantiene la forma dello spazio in pagina;
    // al rilascio la parte scelta riempie lo spazio.
    function onCropCorner(corner, e) {
      var it = spread.items.filter(function (x) { return x.id === cropId; })[0];
      var pl = lay.placed.filter(function (x) { return x.item.id === cropId; })[0];
      if (!it || !pl) return;
      e.preventDefault(); e.stopPropagation();
      var ph = session.byId[it.pid], cw = pl.w * scale, ch = pl.h * scale, ar = cw / ch;
      var c0 = cropState(it), t0 = Exporter.cropTransform(ph.w, ph.h, cw, ch, c0);
      var sr = spreadRef.current.getBoundingClientRect();
      var cellX = sr.left + pl.x * scale, cellY = sr.top + pl.y * scale;
      var left = corner.charAt(1) === 'w', up = corner.charAt(0) === 'n';
      var ax = left ? cw : 0, ay = up ? ch : 0;           // angolo opposto, fermo
      var maxW = cw * c0.z, minW = Math.max(24, cw * 0.12), last = null;
      function mv(ev) {
        var px = ev.clientX - cellX, py = ev.clientY - cellY;
        var dx = left ? ax - px : px - ax, dy = up ? ay - py : py - ay;
        var w = Math.max(minW, Math.min(maxW, Math.max(dx, dy * ar))), h = w / ar;
        last = { x: left ? ax - w : ax, y: up ? ay - h : ay, w: w, h: h };
        setCropRect(last);
      }
      function upH() {
        root.removeEventListener('pointermove', mv); root.removeEventListener('pointerup', upH);
        if (last && Math.abs(last.w - cw) > 1) {
          var ddx = last.x + last.w / 2 - cw / 2, ddy = last.y + last.h / 2 - ch / 2;
          var c = Math.cos(t0.th), sn = Math.sin(t0.th);
          var next = Object.assign({}, c0, {
            z: Math.max(1, c0.z * cw / last.w),
            cx: (t0.cX + (ddx * c + ddy * sn) / t0.s) / ph.w,
            cy: (t0.cY + (-ddx * sn + ddy * c) / t0.s) / ph.h
          });
          var t = Exporter.cropTransform(ph.w, ph.h, cw, ch, next);
          next.cx = t.cX / ph.w; next.cy = t.cY / ph.h;
          it.crop = next;
        }
        setCropRect(null);
        session.changed();
      }
      root.addEventListener('pointermove', mv); root.addEventListener('pointerup', upH);
    }
    // Ritaglio da un solo lato: la foto cambia forma (crop.a) e al rilascio
    // la tavola si ricompone con la nuova forma.
    function onCropSide(side, e) {
      var it = spread.items.filter(function (x) { return x.id === cropId; })[0];
      var pl = lay.placed.filter(function (x) { return x.item.id === cropId; })[0];
      if (!it || !pl) return;
      e.preventDefault(); e.stopPropagation();
      var ph = session.byId[it.pid], cw = pl.w * scale, ch = pl.h * scale;
      var c0 = cropState(it), t0 = Exporter.cropTransform(ph.w, ph.h, cw, ch, c0);
      var sr = spreadRef.current.getBoundingClientRect();
      var cellX = sr.left + pl.x * scale, cellY = sr.top + pl.y * scale;
      // fin dove si puo' riallargare: bordi della foto (se dritta) o della cella (se raddrizzata)
      var straight = Math.abs(t0.th) < 1e-6;
      var bL = straight ? cw / 2 - t0.cX * t0.s : 0, bR = straight ? cw / 2 + (ph.w - t0.cX) * t0.s : cw;
      var bT = straight ? ch / 2 - t0.cY * t0.s : 0, bB = straight ? ch / 2 + (ph.h - t0.cY) * t0.s : ch;
      var MIN = 24, last = null;
      function mv(ev) {
        var px = ev.clientX - cellX, py = ev.clientY - cellY;
        var x0 = 0, x1 = cw, y0 = 0, y1 = ch;
        if (side === 'w') x0 = Math.max(bL, Math.min(x1 - MIN, px));
        if (side === 'e') x1 = Math.min(bR, Math.max(x0 + MIN, px));
        if (side === 'n') y0 = Math.max(bT, Math.min(y1 - MIN, py));
        if (side === 's') y1 = Math.min(bB, Math.max(y0 + MIN, py));
        last = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        setCropRect(last);
      }
      function upH() {
        root.removeEventListener('pointermove', mv); root.removeEventListener('pointerup', upH);
        if (last && (Math.abs(last.w - cw) > 1 || Math.abs(last.h - ch) > 1)) {
          var ddx = last.x + last.w / 2 - cw / 2, ddy = last.y + last.h / 2 - ch / 2;
          var c = Math.cos(t0.th), sn = Math.sin(t0.th), ac = Math.abs(c), as = Math.abs(sn);
          var base = Math.max((last.w * ac + last.h * as) / ph.w, (last.w * as + last.h * ac) / ph.h);
          var next = Object.assign({}, c0, {
            a: last.w / last.h,
            z: Math.max(1, t0.s / base),
            cx: (t0.cX + (ddx * c + ddy * sn) / t0.s) / ph.w,
            cy: (t0.cY + (-ddx * sn + ddy * c) / t0.s) / ph.h
          });
          var t = Exporter.cropTransform(ph.w, ph.h, last.w, last.h, next);
          next.cx = t.cX / ph.w; next.cy = t.cY / ph.h;
          it.crop = next;
        }
        setCropRect(null);
        session.changed();
      }
      root.addEventListener('pointermove', mv); root.addEventListener('pointerup', upH);
    }
    function onCropWheel(e) {
      var it = spread.items.filter(function (x) { return x.id === cropId; })[0]; if (!it) return;
      e.preventDefault();
      var c = cropState(it);
      it.crop = Object.assign(c, { z: Math.min(5, Math.max(1, c.z * (1 - e.deltaY * 0.0015))) });
      session.notifySoon();
    }
    function setCrop(k, v) {
      var it = spread.items.filter(function (x) { return x.id === cropId; })[0]; if (!it) return;
      var c = cropState(it); c[k] = v; it.crop = c; session.notifySoon();
    }
    function resetCrop() { var it = spread.items.filter(function (x) { return x.id === cropId; })[0]; if (!it) return; it.crop = null; session.notifySoon(); }

    // ---------- tastiera ----------
    // il gestore viene aggiornato a ogni disegno: i tasti vedono sempre la selezione attuale
    var keyRef = useRef(null);
    useEffect(function () {
      function h(e) { if (keyRef.current) keyRef.current(e); }
      root.addEventListener('keydown', h);
      return function () { root.removeEventListener('keydown', h); };
    }, []);
    keyRef.current = function onKey(e) {
        var tag = (e.target.tagName || '').toLowerCase();
        if ((tag === 'input' && e.target.type !== 'range') || tag === 'textarea' || tag === 'select') return;
        if (dialog) return;
        var mod = e.metaKey || e.ctrlKey, k = e.key;
        if (look) {                                   // anteprima aperta: solo i suoi tasti
          if (k === ' ' || k === 'Escape') { e.preventDefault(); setLook(null); }
          else if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); lookStep(1); }
          else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); lookStep(-1); }
          else if (k === 'Enter') { e.preventDefault(); lookAdd(); }
          else if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) session.redo(); else session.undo(); }
          return;
        }
        if (k === ' ' && !mod && !cropId) {
          var pid = null;
          if (lastArea.current === 'grid') {
            var lp = lastClick.current != null ? photos[lastClick.current] : null;
            if (lp && gridSel[lp.id]) pid = lp.id; else { var gs0 = selectedList(); if (gs0.length) pid = gs0[gs0.length - 1].id; }
          } else if (selItem) pid = selItem.pid;
          if (pid) { e.preventDefault(); openLook(pid); return; }
        }
        if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) session.redo(); else session.undo(); return; }
        if (mod && !e.shiftKey && !e.altKey) {
          var kl = (k || '').toLowerCase();
          if (kl === 'c') { e.preventDefault(); copySel(false); return; }
          if (kl === 'x') { e.preventDefault(); copySel(true); return; }
          if (kl === 'v') { e.preventDefault(); paste(); return; }
          if (kl === 'a') { e.preventDefault(); selectAll(); return; }
        }
        if (mod) return;
        if (tag === 'input' && /^Arrow/.test(k)) return;
        if (cropId && (k === 'Escape' || k === 'Enter')) { e.preventDefault(); endCrop(); return; }
        if (k === 'w' || k === 'W') { e.preventDefault(); toggleMode(); }
        else if (k === 'd' || k === 'D') { e.preventDefault(); toggleSplit(); }
        else if (k === 'g' || k === 'G') { e.preventDefault(); toggleGuides(); }
        else if (k === '+' || k === '=') { e.preventDefault(); margin(0.5); }
        else if (k === '-' || k === '_') { e.preventDefault(); margin(-0.5); }
        else if (k === 'ArrowUp') { e.preventDefault(); combo(-1); }
        else if (k === 'ArrowDown') { e.preventDefault(); combo(1); }
        else if (k === 'ArrowLeft') { e.preventDefault(); goSpread(ci - 1); }
        else if (k === 'ArrowRight') { e.preventDefault(); goSpread(ci + 1); }
        else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); removeSelected(); }
        else if (k === 'Escape') setSelectedId(null);
    };

    // ---------- griglia foto ----------
    var used = session.usedCount();
    var here = {}; spread.items.forEach(function (it) { here[it.pid] = 1; });
    var photos = p.photos.filter(function (ph) {
      if (filt.use === 'unused' && used[ph.id]) return false;
      if (filt.use === 'used' && !used[ph.id]) return false;
      if (filt.orient === 'h' && !(ph.ar >= 1)) return false;
      if (filt.orient === 'v' && !(ph.ar < 1)) return false;
      if (filt.chapter !== 'all' && (ph.chapter || null) !== filt.chapter) return false;
      return true;
    });
    if (filt.sort === 'date') photos = photos.slice().sort(function (a, b) { return a.lastModified - b.lastModified; });
    var usedN = p.photos.filter(function (ph) { return used[ph.id]; }).length;
    var chapterColor = {}; p.chapters.forEach(function (c) { chapterColor[c.id] = c.color; });
    var gridSig = [photos.length, photos.length ? photos[0].id + photos[photos.length - 1].id : '', JSON.stringify(used), Object.keys(here).join(','), Object.keys(gridSel).join(','),
      session.thumbsVersion || 0, Object.keys(session.thumbs).length, JSON.stringify(filt), p.photos.map(function (x) { return x.chapter || ''; }).join('')].join('|');

    function selectedList() { return photos.filter(function (x) { return gridSel[x.id]; }); }
    api.current = {
      tileClick: function (e, ph, i) {
        lastArea.current = 'grid';
        var n = {};
        if (e.shiftKey && lastClick.current != null) {
          n = Object.assign({}, gridSel);
          var a = Math.min(lastClick.current, i), b = Math.max(lastClick.current, i);
          photos.slice(a, b + 1).forEach(function (x) { n[x.id] = 1; });
        } else if (e.metaKey || e.ctrlKey) {
          n = Object.assign({}, gridSel);
          if (n[ph.id]) delete n[ph.id]; else n[ph.id] = 1;
          lastClick.current = i;
        } else { n[ph.id] = 1; lastClick.current = i; }
        setGridSel(n);
      },
      tileDbl: function (ph) {
        session.commit(function () {
          applyDrop(spread, { kind: 'append', side: spread.split ? activeSide : undefined }, { kind: 'photos', pids: [ph.id] }, size, arOf);
        });
      },
      tileDragStart: function (e, ph) {
        var pids = gridSel[ph.id] ? selectedList().map(function (x) { return x.id; }) : [ph.id];
        drag = { kind: 'photos', pids: pids, ids: pids.map(function () { return U.uid(); }) };
        e.dataTransfer.setData('text/plain', 'photos');
        e.dataTransfer.effectAllowed = 'copyMove';
      },
      dragEnd: function () { drag = null; cancelPend(); setPreview(null); }
    };
    function gridDragOver(e) { if (drag && drag.kind === 'item') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (preview) setPreview(null); } }
    function gridDrop(e) {
      if (!drag || drag.kind !== 'item') return;
      e.preventDefault();
      var d = drag; drag = null;
      session.commit(function () { removeItem(spread, d.id, size, arOf); });
      setSelectedId(null);
    }

    // ---------- anteprima grande (barra spaziatrice) ----------
    function openLook(pid) {
      setLook(pid); session.needPreview(pid);
      var i = photos.findIndex(function (x) { return x.id === pid; });
      [i - 1, i + 1].forEach(function (j) { if (photos[j]) session.needPreview(photos[j].id); });
    }
    function lookStep(d) {
      var i = photos.findIndex(function (x) { return x.id === look; });
      if (i < 0) return;
      var j = Math.max(0, Math.min(photos.length - 1, i + d));
      if (j === i) return;
      var ph = photos[j];
      openLook(ph.id);
      var n = {}; n[ph.id] = 1; setGridSel(n); lastClick.current = j; lastArea.current = 'grid';
      var el = document.querySelector('.tile[data-pid="' + ph.id + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
    function lookAdd() {
      var ph = session.byId[look]; if (!ph) return;
      api.current.tileDbl(ph);
      flash('«' + ph.name.replace(/\.jpe?g$/i, '') + '» aggiunta alla tavola ' + (ci + 1));
    }

    function importDone(r, where) {
      flash(r.added ? r.added + (r.added === 1 ? ' foto importata' : ' foto importate') + where : (r.found ? 'Nessuna foto nuova: erano già nel progetto' : 'Nessun JPEG trovato in questa cartella'));
    }
    function importFail(e) {
      if (e && e.name !== 'AbortError') flash('Importazione non riuscita: ' + e.message);
    }
    // Cartella intera
    function importPhotos() {
      Store.pickDirectory({ startIn: session.service }).then(function (d) {
        return session.importFolder(d).then(function (r) { importDone(r, ' da «' + d.name + '»'); });
      }).catch(importFail);
    }
    // Foto singole, scelte file per file
    function importSingles() {
      Store.pickFiles({ startIn: session.service }).then(function (handles) {
        if (!handles || !handles.length) return;
        return session.importFiles(handles, function (fh, n) {
          return new Promise(function (resolve) { setAskDir({ fh: fh, n: n, resolve: resolve }); });
        }).then(function (r) { importDone(r, ''); });
      }).catch(importFail);
    }
    function confirmDir() {
      var a = askDir;
      Store.pickDirectory({ startIn: a.fh }).then(function (d) { setAskDir(null); a.resolve(d); }, function () { });
    }
    function fixSource(src) {
      if (session.srcState[src.id] === 'locked') { session.unlockSource(src).then(function () { session.loadThumbs(); }); return; }
      Store.pickDirectory({ startIn: session.service }).then(function (d) {
        if (d.name !== src.name && !root.confirm('La cartella scelta si chiama «' + d.name + '» invece di «' + src.name + '». Usarla comunque?')) return;
        return session.relinkSource(src, d).then(function () { session.previews = {}; session.loadThumbs(); flash('Cartella ricollegata'); });
      }).catch(function () { });
    }

    function newChapter() {
      var name = root.prompt('Nome del capitolo', 'Capitolo ' + (p.chapters.length + 1));
      if (!name) return;
      session.commit(function (pp) { pp.chapters.push({ id: U.uid(), name: name, color: CHAPTER_COLORS[pp.chapters.length % CHAPTER_COLORS.length] }); });
    }
    function assignChapter(id) {
      var ids = Object.keys(gridSel);
      if (!ids.length) { flash('Seleziona prima le foto nella griglia'); return; }
      session.commit(function (pp) { pp.photos.forEach(function (ph) { if (gridSel[ph.id]) ph.chapter = id || null; }); });
    }

    var cropItem = cropId ? spread.items.filter(function (x) { return x.id === cropId; })[0] : null;
    var cropC = cropItem ? cropState(cropItem) : null;
    var saveLabel = { saved: 'salvato', dirty: 'modifiche…', saving: 'salvataggio…', error: 'ERRORE di salvataggio' }[session.saveState];
    var problems = session.problemSources();
    var shown = preview ? preview.spread : spread;

    var rows = '52px ' + (problems.length ? 'auto ' : '') + 'minmax(0, 1fr) 54px';
    var gridStyle = dock === 'right'
      ? { gridTemplateRows: rows, gridTemplateColumns: 'minmax(0, 1fr) ' + panelW + 'px' }
      : { gridTemplateRows: rows + ' ' + panelH + 'px' };
    return html`<div class=${cls('editor', dock === 'right' && 'dock-right')} style=${gridStyle}>
      <header class="topbar">
        <button class="linkbtn" onClick=${function () { session.save().then(props.onClose); }}>‹ Progetti</button>
        <div class="col">
          <strong>${p.name}</strong>
          <span class="muted small">${U.sizeLabel(p)} · ${p.measure === 'single' ? 'pagina singola' : 'tavola doppia'} · ${p.spreads.length} fogli · ${usedN} di ${p.photos.length} foto usate · <span class=${session.saveState === 'error' ? 'warn' : ''}>${saveLabel}</span></span>
        </div>
        <span class="grow"></span>
        <button class="icon-btn" aria-label="Annulla" title="Annulla (⌘Z)" onClick=${function () { session.undo(); }}>↶</button>
        <button class="icon-btn" aria-label="Ripeti" title="Ripeti (⇧⌘Z)" onClick=${function () { session.redo(); }}>↷</button>
        <span class="grow"></span>
        ${session.progress ? html`<span class="muted small">${session.progress.label} ${session.progress.done}/${session.progress.total}</span>` : null}
        <button class="btn primary" onClick=${function () { setDialog('export'); }}>Esporta</button>
      </header>
      ${problems.length ? html`<div class="srcbar">${problems.map(function (s) {
        var locked = session.srcState[s.id] === 'locked';
        return html`<span key=${s.id}>Cartella foto «${s.name}» ${locked ? 'da riattivare' : 'non trovata'}</span><button class="btn small" onClick=${function () { fixSource(s); }}>${locked ? 'Riattiva' : 'Ricollega…'}</button>`;
      })}</div>` : null}

      <div class="workarea">
        <div class="tools">
          ${spread.split ? html`<div class="pageflag">${activeSide === 'L' ? 'Pagina sinistra' : 'Pagina destra'}</div>` : null}
          <${Slider} label="Spacco" value=${style.gap} max=${3} step=${0.05} onStart=${styleStart} onLive=${function (v) { styleLive('gap', v); }} onEnd=${styleEnd} onCommit=${function (v) { setStyle('gap', v); }} />
          <${Slider} label=${style.mode === 'fill' ? 'Margine esterno' : 'Margine'} value=${style[marginKey] || 0} max=${6} step=${0.05} onStart=${styleStart} onLive=${function (v) { styleLive(marginKey, v); }} onEnd=${styleEnd} onCommit=${function (v) { setStyle(marginKey, v); }} />
          <${Slider} label="Bordi" value=${style.border} max=${2} step=${0.05} onStart=${styleStart} onLive=${function (v) { styleLive('border', v); }} onEnd=${styleEnd} onCommit=${function (v) { setStyle('border', v); }} />
          <label class="tool color-tool" title="Colore dei bordi"><span>Colore bordi</span><input type="color" value=${style.borderColor || '#ffffff'} onChange=${function (e) { setStyle('borderColor', e.target.value); }} /></label>
          <div class="tool-row">
            <button class=${cls('tool', style.mode === 'fill' && 'on')} onClick=${toggleMode} title="Pagina intera (W)"><span>Modalità</span><strong>${style.mode === 'fill' ? 'Intera' : 'Formato'}</strong></button>
            <button class=${cls('tool', spread.split && 'on')} onClick=${toggleSplit} title="Dividi le pagine (D)"><span>Dividi</span><strong>${spread.split ? 'Sì' : 'No'}</strong></button>
          </div>
          <label class="tool"><span>Allinea</span>
            <select value=${style.align} onChange=${function (e) { setStyle('align', e.target.value); }}>
              ${ALIGNS.map(function (a) { return html`<option value=${a[0]}>${a[1]}</option>`; })}
            </select>
          </label>
          <div class="tool-row">
            <button class="tool" onClick=${shuffle} title="Mescola l'ordine"><span>Mescola</span><strong>↻</strong></button>
            <button class=${cls('tool', selList.length && selList.every(function (it) { return it.bw; }) && 'on')} onClick=${toggleBW} title="Bianco e nero (foto selezionate o tutta la tavola)"><span>B/N</span><strong>${selList.length ? (selList.every(function (it) { return it.bw; }) ? 'Sì' : 'No') : 'Tav.'}</strong></button>
          </div>
          <button class=${cls('tool', p.safety.enabled && p.safety.show && 'on')} onClick=${toggleGuides} title="Margini di sicurezza (G)"><span>Guide</span><strong>${p.safety.enabled && p.safety.show ? 'On' : 'Off'}</strong></button>
          <button class="tool mini" onClick=${applyAll} title="Copia spacco, margine, bordi, modalità e allineamento su tutte le tavole">Applica a tutte</button>
        </div>

        <div class="stage" ref=${stageRef} onPointerDown=${stageDown} onClick=${function () { if (marqueeMoved.current) { marqueeMoved.current = false; return; } if (cropId) endCrop(); setSelectedId(null); }}>
          <div ref=${spreadRef} onClick=${function (e) { e.stopPropagation(); }}>
            <${SpreadView} session=${session} spread=${shown} lay=${preview ? null : lay} scale=${scale} interactive=${!preview} hires=${true} className=${preview || drag ? 'previewing' : ''}
              selectedIds=${selIds} cropId=${cropId} guides=${p.safety.show} highlight=${preview ? preview.touched : null} live=${live}
              emptyText="Trascina qui le foto (o doppio clic su una foto)"
              onDragOver=${onDragOver} onDragLeave=${function (e) { if (!e.currentTarget.contains(e.relatedTarget)) { cancelPend(); setPreview(null); } }} onDrop=${onDrop}
              onDragEnd=${function () { cancelPend(); setPreview(null); }}
              onItemClick=${function (it, e) {
                if (cropId && it.id !== cropId) endCrop();
                lastArea.current = 'stage';
                if (e && (e.shiftKey || e.metaKey)) setSelIds(selIds.indexOf(it.id) >= 0 ? selIds.filter(function (x) { return x !== it.id; }) : selIds.concat([it.id]));
                else setSelectedId(it.id);
                if (spread.split) setActiveSide(it.side === 'R' ? 'R' : 'L');
              }}
              onItemDbl=${startCrop}
              onDividerDown=${onDividerDown} onDividerReset=${onDividerReset}
              onBgClick=${function (e) { if (marqueeMoved.current) { marqueeMoved.current = false; return; } if (cropId) { endCrop(); return; } setSelectedId(null); if (spread.split) { var pt = pointToCm(e); setActiveSide(pt.x < size.w / 2 ? 'L' : 'R'); } }}
              onCropDown=${onCropDown} onCropWheel=${onCropWheel} onCropCorner=${onCropCorner} onCropSide=${onCropSide} cropRect=${cropRect} />
          </div>
          ${cropItem ? html`<div class="floatbar" onClick=${function (e) { e.stopPropagation(); }}>
              <span class="muted small hint">Angoli o lati: ritaglia · dentro: sposta</span>
              <label class="row small">Zoom <input type="range" min="1" max="5" step="0.01" value=${cropC.z} onPointerDown=${function () { setLive(true); }} onPointerUp=${function () { setLive(false); }} onInput=${function (e) { setCrop('z', +e.target.value); }} /></label>
              <label class="row small">Raddrizza <input type="range" min="-15" max="15" step="0.1" value=${cropC.r} onPointerDown=${function () { setLive(true); }} onPointerUp=${function () { setLive(false); }} onInput=${function (e) { setCrop('r', +e.target.value); }} onDblClick=${function () { setCrop('r', 0); }} /><span class="deg">${fmt(cropC.r)}°</span></label>
              <button class="btn small" onClick=${resetCrop}>Ripristina</button>
              <button class="btn primary small" onClick=${endCrop}>OK</button>
            </div>`
          : selItem ? html`<div class="floatbar" onClick=${function (e) { e.stopPropagation(); }}>
              <button class="btn small" onClick=${function () { startCrop(selItem); }}>Ritaglia</button>
              <button class="btn small" onClick=${toggleBW}>${selItem.bw ? 'Colore' : 'B/N'}</button>
              <button class="btn small" title="Copia (⌘C)" onClick=${function () { copySel(false); }}>Copia</button>
              <button class="btn small" title="Taglia (⌘X)" onClick=${function () { copySel(true); }}>Taglia</button>
              <button class="btn small danger" onClick=${removeSelected}>Rimuovi</button>
            </div>`
          : selList.length > 1 ? html`<div class="floatbar" onClick=${function (e) { e.stopPropagation(); }}>
              <span class="muted small hint">${selList.length} foto selezionate</span>
              <button class="btn small" onClick=${toggleBW}>${selList.every(function (it) { return it.bw; }) ? 'Colore' : 'B/N'}</button>
              <button class="btn small" title="Copia (⌘C)" onClick=${function () { copySel(false); }}>Copia</button>
              <button class="btn small" title="Taglia (⌘X)" onClick=${function () { copySel(true); }}>Taglia</button>
              <button class="btn small danger" onClick=${removeSelected}>Rimuovi</button>
            </div>`
          : clip.current && !preview ? html`<div class="floatbar" onClick=${function (e) { e.stopPropagation(); }}>
              <button class="btn small" title="Incolla (⌘V)" onClick=${paste}>Incolla ${clip.current.items.length} ${clip.current.items.length === 1 ? 'foto' : 'foto'}</button>
              <button class="icon-btn small-x" aria-label="Svuota appunti" title="Svuota appunti" onClick=${function () { clip.current = null; setClipV(function (v) { return v + 1; }); }}>×</button>
            </div>` : null}
          ${marquee ? html`<div class="marquee" style=${{ left: marquee.left + 'px', top: marquee.top + 'px', width: marquee.width + 'px', height: marquee.height + 'px' }}></div>` : null}
        </div>

        <div class="rtools">
          <button class="tool sq" aria-label="Combinazione precedente" title="Combinazione precedente (↑)" onClick=${function () { combo(-1); }}>↑</button>
          <div class="counter">${region.custom ? html`<strong>✎</strong><span>manuale</span>` : html`<strong>${region.index + 1}</strong><span>di ${region.count}</span>`}</div>
          <button class="tool sq" aria-label="Combinazione successiva" title="Combinazione successiva (↓)" onClick=${function () { combo(1); }}>↓</button>
          <button class="tool sq accent" aria-label="Tutte le combinazioni" title="Tutte le combinazioni" onClick=${function () { setDialog('combos'); }}>⊞</button>
          <button class="tool sq danger" aria-label="Elimina tavola" title="Elimina tavola" onClick=${deleteSpread}>✕</button>
        </div>
      </div>

      <div class=${cls('strip', stripDrag && 'dragging')} ref=${stripRef}>
        ${p.spreads.map(function (sp, i) {
          var mark = !stripDrag ? '' : (i === stripDrag.from ? 'moving' : '') +
            (stripDrag.slot === i && i !== stripDrag.from && i !== stripDrag.from + 1 ? ' ins-before' : '') +
            (stripDrag.slot === p.spreads.length && i === p.spreads.length - 1 && i !== stripDrag.from ? ' ins-after' : '');
          return html`<${StripItem} key=${sp.id} session=${session} spread=${sp} index=${i} on=${i === ci} mark=${mark}
            sig=${JSON.stringify(sp) + (i === ci ? '*' : '') + i + '|' + mark + '|' + (session.thumbsVersion || 0) + '|' + Object.keys(session.thumbs).length}
            onPointerDown=${function (e) { stripDown(i, e); }}
            onClick=${function () { if (stripMoved.current) { stripMoved.current = false; return; } goSpread(i); }} />`;
        })}
        <button class="addbtn" aria-label="Aggiungi foglio" title="Aggiungi foglio" onClick=${addSpread}>+</button>
        <span class="grow"></span>
        <span class="muted small keys">Tavola ${ci + 1} di ${p.spreads.length} · <b>W</b> intera · <b>D</b> dividi · <b>↑↓</b> combinazioni · <b>+ −</b> margine · <b>←→</b> tavole</span>
      </div>

      <div class="photos" style=${{ '--tile': tileSize + 'px' }} onDragOver=${gridDragOver} onDrop=${gridDrop}>
        <div class="resizer" onPointerDown=${startResize} title="Trascina per ridimensionare"></div>
        <div class="photos-bar">
          <div class="seg">
            <button class=${filt.use === 'all' ? 'on' : ''} onClick=${function () { setFilt(Object.assign({}, filt, { use: 'all' })); }}>Tutte ${p.photos.length}</button>
            <button class=${filt.use === 'unused' ? 'on' : ''} onClick=${function () { setFilt(Object.assign({}, filt, { use: 'unused' })); }}>Non usate ${p.photos.length - usedN}</button>
            <button class=${filt.use === 'used' ? 'on' : ''} onClick=${function () { setFilt(Object.assign({}, filt, { use: 'used' })); }}>Usate ${usedN}</button>
          </div>
          ${p.useChapters ? html`<div class="chips">
            <button class=${cls('chip', filt.chapter === 'all' && 'on')} onClick=${function () { setFilt(Object.assign({}, filt, { chapter: 'all' })); }}>Tutti</button>
            ${p.chapters.map(function (c) { return html`<button key=${c.id} class=${cls('chip', filt.chapter === c.id && 'on')} onClick=${function () { setFilt(Object.assign({}, filt, { chapter: c.id })); }}><i style=${{ background: c.color }}></i>${c.name}</button>`; })}
            <button class="chip" onClick=${newChapter}>+ Capitolo</button>
            ${p.chapters.length ? html`<select class="chip" value="" onChange=${function (e) { assignChapter(e.target.value === '__none' ? null : e.target.value); e.target.value = ''; }}>
              <option value="">Sposta selezione in…</option>
              ${p.chapters.map(function (c) { return html`<option value=${c.id}>${c.name}</option>`; })}
              <option value="__none">Nessun capitolo</option>
            </select>` : null}
          </div>` : null}
          <span class="grow"></span>
          <select class="sel" value=${filt.orient} onChange=${function (e) { setFilt(Object.assign({}, filt, { orient: e.target.value })); }} aria-label="Orientamento">
            <option value="all">Tutti gli orientamenti</option><option value="h">Orizzontali</option><option value="v">Verticali</option>
          </select>
          <select class="sel" value=${filt.sort} onChange=${function (e) { setFilt(Object.assign({}, filt, { sort: e.target.value })); }} aria-label="Ordina">
            <option value="name">Nome file</option><option value="date">Data file</option>
          </select>
          <label class="zoomctl" title="Dimensione delle miniature">
            <span class="zi small" aria-hidden="true"></span>
            <input type="range" min="70" max="360" step="2" value=${tileSize} aria-label="Zoom delle miniature" onInput=${function (e) { setTileSize(+e.target.value); }} onDblClick=${function () { setTileSize(96); }} />
            <span class="zi big" aria-hidden="true"></span>
          </label>
          <div class="importbtns">
            <button class="btn accent-outline" onClick=${importPhotos} title="Importa tutte le foto di una cartella (con le sottocartelle)">Importa cartella</button>
            <button class="btn accent-outline" onClick=${importSingles} title="Scegli una o più foto, file per file (Cmd o Maiusc per sceglierne più di una)">Importa foto singole</button>
          </div>
          <button class="icon-btn dockbtn" aria-label=${dock === 'right' ? 'Sposta il pannello foto sotto' : 'Sposta il pannello foto a destra'}
            title=${dock === 'right' ? 'Sposta il pannello foto sotto' : 'Sposta il pannello foto a destra'}
            onClick=${function () { setDock(dock === 'right' ? 'bottom' : 'right'); }}><i class=${dock === 'right' ? 'to-bottom' : 'to-right'}></i></button>
        </div>
        ${session.progress ? html`<div class="progress thin"><div style=${{ width: (session.progress.done / session.progress.total * 100) + '%' }}></div></div>` : null}
        ${!p.photos.length && !session.progress ? html`<div class="photos-empty"><p>Nessuna foto nel progetto.</p><div class="row"><button class="btn primary" onClick=${importPhotos}>Importa cartella</button><button class="btn" onClick=${importSingles}>Importa foto singole</button></div><span class="muted small">Una cartella intera o solo le foto che scegli, anche fuori da «${session.service.name}»</span></div>` : null}
        <${PhotoGrid} session=${session} api=${api} photos=${photos} used=${used} here=${here} sel=${gridSel} chapterColor=${chapterColor} sig=${gridSig} />
      </div>

      ${msg ? html`<div class="toast">${msg}</div>` : null}
      ${look && session.byId[look] ? (function () {
        var ph = session.byId[look], i = photos.findIndex(function (x) { return x.id === look; }), u = used[look] || 0;
        var src = session.previews[look] || session.thumbs[look];
        return html`<div class="lookbox" onClick=${function () { setLook(null); }}>
          <div class="look-img">
            ${src ? html`<img src=${src} draggable=${false} alt=${ph.name} onClick=${function (e) { e.stopPropagation(); }} />` : html`<span class="ph-wait"></span>`}
          </div>
          <div class="look-bar" onClick=${function (e) { e.stopPropagation(); }}>
            <button class="icon-btn" aria-label="Foto precedente" title="Precedente (←)" disabled=${i <= 0} onClick=${function () { lookStep(-1); }}>‹</button>
            <span class="look-name">${ph.name}</span>
            <span class="muted small">${i >= 0 ? (i + 1) + ' di ' + photos.length : ''}${ph.w ? ' · ' + ph.w + ' × ' + ph.h + ' px' : ''}${u ? (u > 1 ? ' · usata ' + u + ' volte' : ' · già usata') : ' · non usata'}</span>
            <button class="btn small primary" title="Aggiungi alla tavola (Invio)" onClick=${lookAdd}>Aggiungi alla tavola</button>
            <button class="icon-btn" aria-label="Foto successiva" title="Successiva (→)" disabled=${i < 0 || i >= photos.length - 1} onClick=${function () { lookStep(1); }}>›</button>
            <button class="icon-btn" aria-label="Chiudi anteprima" title="Chiudi (spazio o Esc)" onClick=${function () { setLook(null); }}>×</button>
          </div>
        </div>`;
      })() : null}
      ${askDir ? html`<div class="modal-bg" onClick=${function () { askDir.resolve(null); setAskDir(null); }}>
        <div class="modal askdir" onClick=${function (e) { e.stopPropagation(); }}>
          <div class="modal-head col"><h2>Conferma la cartella delle foto</h2></div>
          <div class="modal-sec"><p>${askDir.n === 1 ? '«' + askDir.fh.name + '» non si trova' : 'Le ' + askDir.n + ' foto scelte non si trovano'} nella cartella del servizio né in un archivio collegato.</p>
            <p class="muted small">Si apre la cartella che ${askDir.n === 1 ? 'la' : 'le'} contiene: premi «Seleziona». Così il progetto le ritrova anche quando lo riapri. Vengono importate solo le foto che hai scelto.</p></div>
          <div class="modal-foot"><span class="grow"></span>
            <button class="btn" onClick=${function () { askDir.resolve(null); setAskDir(null); }}>Annulla</button>
            <button class="btn primary" onClick=${confirmDir}>Conferma cartella…</button></div>
        </div>
      </div>` : null}
      ${dialog === 'export' ? html`<${ExportDialog} session=${session} onClose=${function () { setDialog(null); }} />` : null}
      ${dialog === 'combos' ? html`<${CombosDialog} session=${session} spread=${spread} regionKey=${regionKey} count=${region.count} index=${region.index} custom=${region.custom}
          onPick=${function (k) { session.commit(function () { spread[treeKey] = null; spread[comboKey] = k; }); setDialog(null); }} onClose=${function () { setDialog(null); }} />` : null}
    </div>`;
  }

  // ======================================================================
  function App() {
    var vs = useState({ view: 'list' }), v = vs[0], setV = vs[1];
    if (!Store.supported()) {
      return html`<div class="unsupported"><h1>Apri l’impaginatore con Google Chrome</h1><p>Questo browser non permette di lavorare con le cartelle del Mac. Apri <b>index.html</b> con Chrome (o Microsoft Edge).</p></div>`;
    }
    if (v.view === 'editor') return html`<${Editor} session=${v.session} key=${v.session.entryId} onClose=${function () { setV({ view: 'list' }); }} />`;
    return html`<div>
      <${ProjectList} onOpen=${function (s) { setV({ view: 'editor', session: s }); }} onNew=${function () { setV({ view: 'list', creating: true }); }} />
      ${v.creating ? html`<${NewProject} onCancel=${function () { setV({ view: 'list' }); }} onCreated=${function (s) { setV({ view: 'editor', session: s }); }} />` : null}
    </div>`;
  }

  render(html`<${App} />`, document.getElementById('app'));
})(this);
