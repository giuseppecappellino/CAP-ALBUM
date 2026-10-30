/*
 * Rimozione di oggetti (pennello + ricostruzione con MI-GAN, eseguito nel browser con ONNX Runtime Web).
 *
 * Tratti: { r: raggio in frazione della larghezza foto, pts: [[x, y], ...] in frazioni 0..1 }.
 * Per ogni zona da cancellare si ritaglia un'area con un po' di contesto attorno, la si passa al
 * modello e si reinserisce il risultato SOLO dentro la maschera (bordo sfumato), a piena risoluzione.
 * Il file originale non viene mai modificato: il risultato e' un nuovo JPG nella cache del servizio.
 */
(function (root) {
  'use strict';

  var MODEL_URL = 'models/migan_pipeline_v2.onnx';
  var ORT_DIR = 'lib/ort/';
  var MODEL_CACHE = 'cap-album-modelli';
  var MAX_IN = 1024;          // lato massimo passato al modello (che lavora internamente a 512)
  var session = null, loading = null;

  function supported() { return location.protocol === 'http:' || location.protocol === 'https:'; }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (root.ort) { res(); return; }
      var s = document.createElement('script'); s.src = src; s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('Impossibile caricare il motore di elaborazione')); };
      document.head.appendChild(s);
    });
  }
  // Modello: dalla cache del browser se c'e', altrimenti dalla rete (e poi resta in cache).
  function fetchModel(onStatus) {
    var url = new URL(MODEL_URL, location.href).href;
    var c = root.caches ? root.caches.open(MODEL_CACHE) : Promise.resolve(null);
    return c.then(function (cache) {
      return (cache ? cache.match(url) : Promise.resolve(null)).then(function (hit) {
        if (hit) return hit.arrayBuffer();
        if (onStatus) onStatus('Scaricamento del modello (solo la prima volta, circa 45 MB)…');
        return fetch(url).then(function (res) {
          if (!res.ok) throw new Error('Modello non disponibile (' + res.status + ')');
          var copy = res.clone();
          return (cache ? cache.put(url, copy) : Promise.resolve()).then(function () { return res.arrayBuffer(); });
        });
      });
    });
  }
  function getSession(onStatus) {
    if (session) return Promise.resolve(session);
    if (loading) return loading;
    loading = loadScript(ORT_DIR + 'ort.wasm.min.js').then(function () {
      var ort = root.ort;
      ort.env.wasm.wasmPaths = new URL(ORT_DIR, location.href).href;
      ort.env.wasm.numThreads = 1;
      return fetchModel(onStatus);
    }).then(function (buf) {
      if (onStatus) onStatus('Preparazione del modello…');
      return root.ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
    }).then(function (s) { session = s; return s; }, function (e) { loading = null; throw e; });
    return loading;
  }

  // Raggruppa i tratti vicini: ogni gruppo viene elaborato con il suo ritaglio.
  function groups(strokes, W, H) {
    var boxes = strokes.map(function (s) {
      var r = s.r * W, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      s.pts.forEach(function (p) { var x = p[0] * W, y = p[1] * H; x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); });
      return { x0: x0, y0: y0, x1: x1, y1: y1, s: [s] };
    });
    var merged = true;
    while (merged) {
      merged = false;
      for (var i = 0; i < boxes.length && !merged; i++) for (var j = i + 1; j < boxes.length && !merged; j++) {
        var a = boxes[i], b = boxes[j], pad = Math.max(a.x1 - a.x0, a.y1 - a.y0, b.x1 - b.x0, b.y1 - b.y0) * 0.5;
        if (a.x0 - pad < b.x1 && b.x0 - pad < a.x1 && a.y0 - pad < b.y1 && b.y0 - pad < a.y1) {
          boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), s: a.s.concat(b.s) };
          boxes.splice(j, 1); merged = true;
        }
      }
    }
    return boxes;
  }

  function drawStrokes(ctx, strokes, W, H, ox, oy, grow) {
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    strokes.forEach(function (s) {
      var r = s.r * W + grow;
      ctx.lineWidth = 2 * r;
      ctx.beginPath();
      s.pts.forEach(function (p, k) { var x = p[0] * W - ox, y = p[1] * H - oy; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      if (s.pts.length === 1) { ctx.arc(s.pts[0][0] * W - ox, s.pts[0][1] * H - oy, r, 0, Math.PI * 2); ctx.fill(); }
      else ctx.stroke();
    });
  }

  function inpaintRegion(sess, full, W, H, g) {
    // ritaglio con contesto: la zona da cancellare occupa circa meta' del lato
    var bw = g.x1 - g.x0, bh = g.y1 - g.y0, side = Math.max(bw, bh);
    var ctxPad = Math.max(48, side * 0.6);
    var x0 = Math.max(0, Math.floor(g.x0 - ctxPad)), y0 = Math.max(0, Math.floor(g.y0 - ctxPad));
    var x1 = Math.min(W, Math.ceil(g.x1 + ctxPad)), y1 = Math.min(H, Math.ceil(g.y1 + ctxPad));
    var cw = x1 - x0, ch = y1 - y0;
    var sc = Math.min(1, MAX_IN / Math.max(cw, ch)), mw = Math.max(8, Math.round(cw * sc)), mh = Math.max(8, Math.round(ch * sc));
    // immagine e maschera alla dimensione del modello
    var cin = new OffscreenCanvas(mw, mh), xi = cin.getContext('2d');
    xi.imageSmoothingQuality = 'high'; xi.drawImage(full, x0, y0, cw, ch, 0, 0, mw, mh);
    var cm = new OffscreenCanvas(mw, mh), xm = cm.getContext('2d');
    xm.fillStyle = '#000'; xm.fillRect(0, 0, mw, mh);
    xm.save(); xm.scale(sc, sc); drawStrokes(xm, g.s, W, H, x0, y0, 3 / sc); xm.restore();
    var id = xi.getImageData(0, 0, mw, mh).data, md = xm.getImageData(0, 0, mw, mh).data, n = mw * mh;
    var img = new Uint8Array(3 * n), mask = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      img[i] = id[4 * i]; img[n + i] = id[4 * i + 1]; img[2 * n + i] = id[4 * i + 2];
      mask[i] = md[4 * i] > 127 ? 0 : 255;          // 255 = da tenere, 0 = da ricostruire
    }
    var ort = root.ort;
    return sess.run({ image: new ort.Tensor('uint8', img, [1, 3, mh, mw]), mask: new ort.Tensor('uint8', mask, [1, 1, mh, mw]) }).then(function (out) {
      var r = out.result.data, rgba = new ImageData(mw, mh);
      for (var i = 0; i < n; i++) { rgba.data[4 * i] = r[i]; rgba.data[4 * i + 1] = r[n + i]; rgba.data[4 * i + 2] = r[2 * n + i]; rgba.data[4 * i + 3] = 255; }
      var cr = new OffscreenCanvas(mw, mh); cr.getContext('2d').putImageData(rgba, 0, 0);
      // risultato riportato a piena risoluzione e inserito solo dentro la maschera, con bordo sfumato
      var big = new OffscreenCanvas(cw, ch), xb = big.getContext('2d');
      xb.imageSmoothingQuality = 'high'; xb.drawImage(cr, 0, 0, cw, ch);
      var feather = Math.max(2, Math.round(3 / sc));
      var mk = new OffscreenCanvas(cw, ch), xk = mk.getContext('2d');
      xk.filter = 'blur(' + feather + 'px)';
      drawStrokes(xk, g.s, W, H, x0, y0, feather);
      xb.globalCompositeOperation = 'destination-in'; xb.drawImage(mk, 0, 0);
      full.getContext('2d').drawImage(big, x0, y0);
    });
  }

  // file: Blob dell'originale. Ritorna un Blob JPG con gli oggetti rimossi.
  function process(file, strokes, onStatus) {
    return getSession(onStatus).then(function (sess) {
      return createImageBitmap(file).then(function (bmp) {
        var W = bmp.width, H = bmp.height, full = new OffscreenCanvas(W, H);
        full.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
        var gs = groups(strokes, W, H), chain = Promise.resolve();
        gs.forEach(function (g, k) {
          chain = chain.then(function () {
            if (onStatus) onStatus('Elaborazione' + (gs.length > 1 ? ' ' + (k + 1) + ' di ' + gs.length : '') + '…');
            return new Promise(function (res) { setTimeout(res, 30); }).then(function () { return inpaintRegion(sess, full, W, H, g); });
          });
        });
        return chain.then(function () { return full.convertToBlob({ type: 'image/jpeg', quality: 0.95 }); });
      });
    });
  }

  function strokesKey(strokes) {
    return root.Store.hash(JSON.stringify(strokes.map(function (s) { return [Math.round(s.r * 1e5), s.pts.map(function (p) { return [Math.round(p[0] * 1e5), Math.round(p[1] * 1e5)]; })]; })));
  }

  root.Eraser = { supported: supported, process: process, preload: getSession, strokesKey: strokesKey };
})(this);
