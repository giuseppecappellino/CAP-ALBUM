/*
 * Motore di impaginazione (v0.2). Tutte le misure sono in centimetri.
 *
 * Una composizione e' un albero: foglie = foto, nodi 'h' = foto affiancate
 * (stessa altezza), nodi 'v' = foto impilate (stessa larghezza).
 * Ogni nodo ha una relazione lineare  larghezza = p * altezza + q
 * (q tiene conto degli spazi fissi), cosi' in modalita' "formato" le foto
 * non vengono mai ritagliate.
 * Un nodo con pesi (w) e' stato modificato a mano trascinando un bordo:
 * i suoi figli riempiono le celle in proporzione ai pesi (con ritaglio).
 */
(function (root) {
  'use strict';

  var MAX_GROUPS = 4, MEMO_CAP = 260, MAX_COMBOS = 60;

  function other(o) { return o === 'h' ? 'v' : 'h'; }

  function compositions(n, maxK) {
    var out = [];
    function rec(rest, parts) {
      if (rest === 0) { if (parts.length >= 2) out.push(parts.slice()); return; }
      if (parts.length >= maxK) return;
      for (var s = 1; s <= rest; s++) { parts.push(s); rec(rest - s, parts); parts.pop(); }
    }
    rec(n, []);
    out.sort(function (a, b) { return spreadOf(a) - spreadOf(b); });
    return out;
  }
  function spreadOf(parts) {
    var m = 0, i; for (i = 0; i < parts.length; i++) m += parts[i];
    m /= parts.length;
    var v = 0; for (i = 0; i < parts.length; i++) v += (parts[i] - m) * (parts[i] - m);
    return v / parts.length + parts.length * 0.01;
  }

  function generator() {
    var memo = {};
    function gen(i, j, o, d) {
      var n = j - i;
      if (n === 1) return [{ t: 'leaf', i: i }];
      var key = i + ',' + j + ',' + o + ',' + d;
      if (memo[key]) return memo[key];
      var res = [], comps = compositions(n, Math.min(n, MAX_GROUPS));
      for (var c = 0; c < comps.length && res.length < MEMO_CAP; c++) {
        var parts = comps[c], options = [], ok = true, start = i;
        for (var g = 0; g < parts.length; g++) {
          var s = parts[g];
          if (s === 1) options.push([{ t: 'leaf', i: start }]);
          else if (d > 0) {
            var sub = gen(start, start + s, other(o), d - 1);
            if (!sub.length) { ok = false; break; }
            options.push(sub);
          } else { ok = false; break; }
          start += s;
        }
        if (!ok) continue;
        var acc = [[]];
        for (var k = 0; k < options.length; k++) {
          var next = [];
          outer: for (var a = 0; a < acc.length; a++) {
            for (var b = 0; b < options[k].length; b++) {
              next.push(acc[a].concat([options[k][b]]));
              if (next.length > MEMO_CAP) break outer;
            }
          }
          acc = next;
        }
        for (var z = 0; z < acc.length && res.length < MEMO_CAP; z++) res.push({ t: o, c: acc[z] });
      }
      memo[key] = res;
      return res;
    }
    return gen;
  }

  // ---------- posizionamento di un albero qualsiasi ----------
  // opts: { W, H, gap, mode, align, ar(leaf) }
  function placeTree(tree, opts) {
    var gap = opts.gap, lins = new Map();
    function lin(node) {
      var r;
      if (node.t === 'leaf') r = { p: opts.ar(node) || 1.5, q: 0 };
      else if (node.t === 'h') {
        var p = 0, q = (node.c.length - 1) * gap;
        node.c.forEach(function (c) { var l = lin(c); p += l.p; q += l.q; });
        r = { p: p, q: q };
      } else {
        var S = 0, T = 0;
        node.c.forEach(function (c) { var l = lin(c); S += 1 / l.p; T += l.q / l.p; });
        r = { p: 1 / S, q: (T - (node.c.length - 1) * gap) / S };
      }
      lins.set(node, r);
      return r;
    }
    var rects = [], dividers = [];
    function place(node, x, y, w, h, fill, path) {
      if (node.t === 'leaf') { rects.push({ leaf: node, x: x, y: y, w: w, h: h }); return; }
      var n = node.c.length, sizes = [], k;
      var horiz = node.t === 'h';
      if (fill || node.w) {
        var avail = (horiz ? w : h) - (n - 1) * gap, wts = [], sum = 0;
        for (k = 0; k < n; k++) {
          var l = lins.get(node.c[k]);
          var wt = node.w && node.w[k] > 0 ? node.w[k] : Math.max(0.01, horiz ? l.p * h + l.q : (w - l.q) / l.p);
          wts.push(wt); sum += wt;
        }
        for (k = 0; k < n; k++) sizes.push(wts[k] / sum * avail);
      } else {
        for (k = 0; k < n; k++) {
          var ll = lins.get(node.c[k]);
          sizes.push(horiz ? ll.p * h + ll.q : (w - ll.q) / ll.p);
        }
      }
      var childFill = fill || !!node.w, pos = horiz ? x : y;
      for (k = 0; k < n; k++) {
        if (horiz) place(node.c[k], pos, y, sizes[k], h, childFill, path.concat([k]));
        else place(node.c[k], x, pos, w, sizes[k], childFill, path.concat([k]));
        pos += sizes[k];
        if (k < n - 1) {
          dividers.push(horiz
            ? { path: path, k: k, axis: 'h', x: pos, y: y, w: gap, h: h, sizes: sizes.slice() }
            : { path: path, k: k, axis: 'v', x: x, y: pos, w: w, h: gap, sizes: sizes.slice() });
        }
        pos += gap;
      }
    }
    var W = opts.W, H = opts.H;
    var L = lin(tree);
    if (opts.mode === 'fill') {
      place(tree, 0, 0, W, H, true, []);
      return { rects: rects, dividers: dividers, box: { x: 0, y: 0, w: W, h: H } };
    }
    var h = Math.min(H, (W - L.q) / L.p), w = L.p * h + L.q;
    if (!(h > 0) || !(w > 0)) { h = H; w = W; }
    var ox = (W - w) / 2, oy = (H - h) / 2;
    if (opts.align === 'left') ox = 0;
    if (opts.align === 'right') ox = W - w;
    if (opts.align === 'top') oy = 0;
    if (opts.align === 'bottom') oy = H - h;
    place(tree, ox, oy, w, h, false, []);
    return { rects: rects, dividers: dividers, box: { x: ox, y: oy, w: w, h: h } };
  }

  function signature(rects) {
    return rects.map(function (r) {
      return r.leaf.i + ':' + Math.round(r.x * 4) + ',' + Math.round(r.y * 4) + ',' + Math.round(r.w * 4) + ',' + Math.round(r.h * 4);
    }).join('|');
  }

  // Combinazioni automatiche ordinate per qualita'.
  var cache = {}, cacheSize = 0;
  function combos(opts) {
    var ars = opts.ars, n = ars.length;
    if (!n) return [{ rects: [], score: 0, tree: null }];
    var key = JSON.stringify([ars.map(function (a) { return Math.round(a * 1000); }), opts.width, opts.height, opts.gap, opts.mode, opts.align, opts.fold]);
    if (cache[key]) return cache[key];
    if (cacheSize > 400) { cache = {}; cacheSize = 0; }

    var W = opts.width, H = opts.height;
    var gen = generator();
    var depth = n <= 7 ? 2 : 1;
    var trees = n === 1 ? [{ t: 'leaf', i: 0 }] : gen(0, n, 'h', depth).concat(gen(0, n, 'v', depth));
    var results = [], seen = {};
    var arOf = function (leaf) { return ars[leaf.i]; };
    for (var t = 0; t < trees.length; t++) {
      var tree = trees[t];
      var res = placeTree(tree, { W: W, H: H, gap: opts.gap, mode: opts.mode, align: opts.align, ar: arOf });
      var rects = res.rects, score, r, bad = false;
      var minA = Infinity, maxA = 0, area = 0;
      for (r = 0; r < rects.length; r++) {
        var R = rects[r];
        if (R.w <= 0.3 || R.h <= 0.3) { bad = true; break; }
        var A = R.w * R.h; area += A; minA = Math.min(minA, A); maxA = Math.max(maxA, A);
      }
      if (bad) continue;
      if (opts.mode === 'fill') {
        var keep = 1, sumKeep = 0;
        for (r = 0; r < rects.length; r++) {
          var cellAr = rects[r].w / rects[r].h, a = ars[rects[r].leaf.i];
          var kf = Math.min(cellAr / a, a / cellAr);
          keep = Math.min(keep, kf); sumKeep += kf;
        }
        score = (0.6 * keep + 0.4 * (sumKeep / rects.length)) * (0.5 + 0.5 * Math.sqrt(minA / maxA));
      } else {
        score = (area / (W * H)) * (0.4 + 0.6 * Math.sqrt(minA / maxA));
      }
      if (opts.fold != null) {
        for (r = 0; r < rects.length; r++) {
          var fr = rects[r];
          if (fr.x < opts.fold - 0.2 && fr.x + fr.w > opts.fold + 0.2 && fr.w < W * 0.7) score *= 0.55;
        }
      }
      var sig = signature(rects);
      if (seen[sig]) continue;
      seen[sig] = true;
      results.push({ rects: rects.map(function (q) { return { i: q.leaf.i, x: q.x, y: q.y, w: q.w, h: q.h }; }), score: score, tree: tree });
    }
    results.sort(function (a, b) { return b.score - a.score; });
    if (results.length > MAX_COMBOS) results.length = MAX_COMBOS;
    if (!results.length) results.push({ rects: [], score: 0, tree: null });
    cache[key] = results; cacheSize++;
    return results;
  }

  function defaultStyle() {
    return { gap: 0.5, margin: 1, border: 0, borderColor: '#ffffff', mode: 'fit', align: 'center' };
  }

  // ---------- operazioni sugli alberi (con id delle foto in pagina) ----------
  function clone(t) { return t ? JSON.parse(JSON.stringify(t)) : t; }
  function toIdTree(gtree, items) {
    if (!gtree) return null;
    if (gtree.t === 'leaf') return { t: 'leaf', id: items[gtree.i].id };
    return { t: gtree.t, c: gtree.c.map(function (c) { return toIdTree(c, items); }) };
  }
  function leafIds(tree, out) {
    out = out || [];
    if (!tree) return out;
    if (tree.t === 'leaf') out.push(tree.id); else tree.c.forEach(function (c) { leafIds(c, out); });
    return out;
  }
  function sameIds(tree, items) {
    var ids = leafIds(tree);
    if (ids.length !== items.length) return false;
    var set = {}; items.forEach(function (it) { set[it.id] = 1; });
    for (var i = 0; i < ids.length; i++) if (!set[ids[i]]) return false;
    return true;
  }
  function findParent(node, id, parent, idx) {
    if (node.t === 'leaf') return node.id === id ? { parent: parent, index: idx, node: node } : null;
    for (var k = 0; k < node.c.length; k++) {
      var r = findParent(node.c[k], id, node, k);
      if (r) return r;
    }
    return null;
  }
  function nodeAt(tree, path) {
    var n = tree;
    for (var i = 0; i < path.length; i++) n = n.c[path[i]];
    return n;
  }
  // Semplifica: nodi con un solo figlio spariscono, nodi uguali annidati si fondono.
  function normalize(node) {
    if (!node || node.t === 'leaf') return node;
    var kids = [], wts = [], hasW = !!node.w;
    node.c.forEach(function (c, k) {
      c = normalize(c);
      if (!c) return;
      if (c.t === node.t && !c.w && !hasW) { c.c.forEach(function (g) { kids.push(g); }); }
      else { kids.push(c); if (hasW) wts.push(node.w[k]); }
    });
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    var out = { t: node.t, c: kids };
    if (hasW && wts.length === kids.length) out.w = wts;
    return out;
  }
  function removeLeaf(tree, id) {
    if (!tree) return null;
    if (tree.t === 'leaf') return tree.id === id ? null : tree;
    var t = clone(tree), f = findParent(t, id, null, -1);
    if (!f) return t;
    f.parent.c.splice(f.index, 1);
    if (f.parent.w) f.parent.w.splice(f.index, 1);
    return normalize(t);
  }
  // Inserisce nuove foto accanto a una foto: dir = left | right | top | bottom
  function insertAt(tree, targetId, dir, newIds) {
    var leaves = newIds.map(function (id) { return { t: 'leaf', id: id }; });
    var orient = dir === 'left' || dir === 'right' ? 'h' : 'v';
    var before = dir === 'left' || dir === 'top';
    var group = leaves.length === 1 ? leaves[0] : { t: other(orient), c: leaves };
    if (!tree) return group;
    var t = clone(tree);
    if (t.t === 'leaf') {
      if (t.id !== targetId) return normalize({ t: 'h', c: [t, group] });
      return { t: orient, c: before ? [group, t] : [t, group] };
    }
    var f = findParent(t, targetId, null, -1);
    if (!f) return normalize({ t: 'h', c: [t, group] });
    var p = f.parent;
    if (p.t === orient) {
      var at = before ? f.index : f.index + 1;
      p.c.splice(at, 0, group);
      if (p.w) { var avg = p.w.reduce(function (a, b) { return a + b; }, 0) / p.w.length; p.w.splice(at, 0, avg); }
    } else {
      p.c[f.index] = { t: orient, c: before ? [group, f.node] : [f.node, group] };
    }
    return normalize(t);
  }
  function appendLeaves(tree, newIds) {
    var leaves = newIds.map(function (id) { return { t: 'leaf', id: id }; });
    if (!tree) return leaves.length === 1 ? leaves[0] : { t: 'h', c: leaves };
    var t = clone(tree);
    if (t.t === 'h' && !t.w) { leaves.forEach(function (l) { t.c.push(l); }); return t; }
    return normalize({ t: 'h', c: [t].concat(leaves) });
  }
  function swapLeaves(tree, a, b) {
    var t = clone(tree);
    (function walk(n) {
      if (n.t === 'leaf') { if (n.id === a) n.id = b; else if (n.id === b) n.id = a; return; }
      n.c.forEach(walk);
    })(t);
    return t;
  }
  function replaceLeaf(tree, oldId, newId) {
    var t = clone(tree);
    (function walk(n) { if (n.t === 'leaf') { if (n.id === oldId) n.id = newId; return; } n.c.forEach(walk); })(t);
    return t;
  }

  /*
   * Calcola la tavola intera.
   * spread: { items:[{id,pid,side,crop,bw}], split, s,sL,sR, combo,comboL,comboR, tree,treeL,treeR }
   * Ritorna { placed:[{item,x,y,w,h}], regions:[{key,count,index,custom,tree,x,y,w,h,m}], dividers:[...] }
   */
  function layoutSpread(spread, size, arOf) {
    var placed = [], regions = [], dividers = [];
    function region(key, items, st, x0, y0, w0, h0, comboIdx, fold, custom) {
      var m = st.mode === 'fill' ? 0 : st.margin;
      var W = w0 - 2 * m, H = h0 - 2 * m;
      if (W <= 0 || H <= 0) return;
      var byId = {}; items.forEach(function (it) { byId[it.id] = it; });
      var ars = items.map(function (it) { return arOf(it.pid) || 1.5; });
      var list = combos({ ars: ars, width: W, height: H, gap: st.gap, mode: st.mode, align: st.align, fold: fold == null ? null : fold - m });
      var idx = ((comboIdx || 0) % list.length + list.length) % list.length;
      var tree, isCustom = false;
      if (custom && items.length && sameIds(custom, items)) { tree = custom; isCustom = true; }
      else tree = toIdTree(list[idx].tree, items);
      if (tree) {
        var res = placeTree(tree, { W: W, H: H, gap: st.gap, mode: st.mode, align: st.align, ar: function (leaf) { var it = byId[leaf.id]; return it ? arOf(it.pid) : 1.5; } });
        res.rects.forEach(function (r) {
          var it = byId[r.leaf.id]; if (!it) return;
          placed.push({ item: it, region: key, x: x0 + m + r.x, y: y0 + m + r.y, w: r.w, h: r.h });
        });
        res.dividers.forEach(function (d) {
          dividers.push({ region: key, path: d.path, k: d.k, axis: d.axis, x: x0 + m + d.x, y: y0 + m + d.y, w: d.w, h: d.h, sizes: d.sizes });
        });
      }
      regions.push({ key: key, count: list.length, index: idx, custom: isCustom, tree: tree, x: x0, y: y0, w: w0, h: h0, m: m });
    }
    var half = size.w / 2;
    if (spread.split) {
      var L = spread.items.filter(function (it) { return it.side !== 'R'; });
      var R = spread.items.filter(function (it) { return it.side === 'R'; });
      region('L', L, spread.sL || spread.s, 0, 0, half, size.h, spread.comboL, null, spread.treeL);
      region('R', R, spread.sR || spread.s, half, 0, half, size.h, spread.comboR, null, spread.treeR);
    } else {
      region('S', spread.items, spread.s, 0, 0, size.w, size.h, spread.combo, half, spread.tree);
    }
    return { placed: placed, regions: regions, dividers: dividers };
  }

  var api = {
    combos: combos, layoutSpread: layoutSpread, placeTree: placeTree, defaultStyle: defaultStyle, _compositions: compositions,
    ops: { clone: clone, toIdTree: toIdTree, leafIds: leafIds, sameIds: sameIds, nodeAt: nodeAt, normalize: normalize,
      removeLeaf: removeLeaf, insertAt: insertAt, appendLeaves: appendLeaves, swapLeaves: swapLeaves, replaceLeaf: replaceLeaf }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Layout = api;
})(this);
