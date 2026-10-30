/*
 * Testi nell'impaginato.
 * Un testo: { id, x, y, w (cm, nella tavola), text, font, size (pt), bold, italic, caps,
 *             align: left|center|right, color, ls (spaziatura in millesimi di em), lh (interlinea) }
 * La disposizione delle righe e il disegno sono gli stessi a schermo e in esportazione
 * (stessa funzione su canvas), cosi' il testo stampato va a capo esattamente come si vede.
 */
(function (root) {
  'use strict';

  var PT_CM = 2.54 / 72;   // 1 punto tipografico in cm
  // id, nome visibile, file, stili disponibili (gli altri vengono simulati dal browser)
  var FONTS = [
    ['tinos', 'Times (Tinos)', 'Classico', 'bi'],
    ['playfair-display', 'Playfair Display', 'Classico', 'bi'],
    ['cormorant-garamond', 'Cormorant Garamond', 'Classico', 'bi'],
    ['libre-baskerville', 'Libre Baskerville', 'Classico', 'bi'],
    ['lora', 'Lora', 'Classico', 'bi'],
    ['cinzel', 'Cinzel', 'Classico', 'b'],
    ['great-vibes', 'Great Vibes', 'Corsivo', ''],
    ['dancing-script', 'Dancing Script', 'Corsivo', 'b'],
    ['parisienne', 'Parisienne', 'Corsivo', ''],
    ['allura', 'Allura', 'Corsivo', ''],
    ['pinyon-script', 'Pinyon Script', 'Corsivo', ''],
    ['montserrat', 'Montserrat', 'Moderno', 'bi'],
    ['raleway', 'Raleway', 'Moderno', 'bi'],
    ['poppins', 'Poppins', 'Moderno', 'bi'],
    ['josefin-sans', 'Josefin Sans', 'Moderno', 'bi'],
    ['quicksand', 'Quicksand', 'Moderno', 'b'],
    ['bebas-neue', 'Bebas Neue', 'Particolare', ''],
    ['amatic-sc', 'Amatic SC', 'Particolare', 'b'],
    ['courier-prime', 'Courier Prime', 'Particolare', 'bi'],
    ['caveat', 'Caveat', 'Particolare', 'b']
  ].map(function (f) { return { id: f[0], name: f[1], cat: f[2], styles: f[3], family: 'CAP ' + f[1] }; });
  var byId = {}; FONTS.forEach(function (f) { byId[f.id] = f; });
  function fontOf(t) { return byId[t && t.font] || byId['playfair-display']; }

  // ---------- caricamento dei font (una volta sola per stile) ----------
  var loaded = {}, listeners = [];
  function fontUrl(f, w, it) { return new URL('fonts/' + f.id + '-latin-' + w + '-' + (it ? 'italic' : 'normal') + '.woff2', document.baseURI).href; }
  function loadFace(f, bold, italic) {
    var hasB = f.styles.indexOf('b') >= 0, hasI = f.styles.indexOf('i') >= 0;
    var w = bold && hasB ? 700 : 400, it = italic && hasI;
    var key = f.id + w + (it ? 'i' : '');
    if (loaded[key]) return loaded[key];
    var face = new FontFace(f.family, 'url(' + fontUrl(f, w, it) + ')', { weight: String(w), style: it ? 'italic' : 'normal' });
    loaded[key] = face.load().then(function (ff) { document.fonts.add(ff); listeners.forEach(function (fn) { fn(); }); return ff; })
      .catch(function (e) { console.warn('Font non caricato', f.name, e); delete loaded[key]; });
    return loaded[key];
  }
  function ensure(texts) {
    return Promise.all((texts || []).map(function (t) { return loadFace(fontOf(t), !!t.bold, !!t.italic); }));
  }
  function ensureAll() { return Promise.all(FONTS.map(function (f) { return loadFace(f, false, false); })); }
  function onLoad(fn) { listeners.push(fn); }

  function cssFont(t, px) {
    return (t.italic ? 'italic ' : '') + (t.bold ? '700 ' : '400 ') + px + 'px "' + fontOf(t).family + '", serif';
  }
  function sizePx(t, pxPerCm) { return (t.size || 24) * PT_CM * pxPerCm; }

  // ---------- disposizione delle righe ----------
  function setup(ctx, t, px) {
    ctx.font = cssFont(t, px);
    ctx.letterSpacing = ((t.ls || 0) / 1000 * px) + 'px';
    ctx.textBaseline = 'alphabetic';
  }
  function layout(ctx, t, pxPerCm) {
    var px = sizePx(t, pxPerCm), maxW = Math.max(px, (t.w || 10) * pxPerCm);
    setup(ctx, t, px);
    var txt = t.caps ? (t.text || '').toUpperCase() : (t.text || '');
    var lines = [];
    txt.split('\n').forEach(function (par) {
      var words = par.split(/ +/), line = '';
      if (!par.length) { lines.push(''); return; }
      words.forEach(function (wd) {
        var tryL = line ? line + ' ' + wd : wd;
        if (!line || ctx.measureText(tryL).width <= maxW) { line = tryL; }
        else { lines.push(line); line = wd; }
        // parola piu' lunga della riga: si spezza
        while (ctx.measureText(line).width > maxW && line.length > 1) {
          var k = line.length - 1;
          while (k > 1 && ctx.measureText(line.slice(0, k)).width > maxW) k--;
          lines.push(line.slice(0, k)); line = line.slice(k);
        }
      });
      lines.push(line);
    });
    var m = ctx.measureText('ÀgjHy'), asc = m.fontBoundingBoxAscent || px * 0.8, desc = m.fontBoundingBoxDescent || px * 0.25;
    var lineH = px * (t.lh || 1.2);
    return { px: px, lines: lines, lineH: lineH, asc: asc, desc: desc, w: maxW, h: Math.max(lineH, lines.length * lineH) };
  }
  // Disegna il testo con l'angolo in alto a sinistra in (ox, oy) (pixel del canvas).
  function draw(ctx, t, pxPerCm, ox, oy) {
    ctx.save();
    var L = layout(ctx, t, pxPerCm);
    ctx.fillStyle = t.color || '#222222';
    var trailing = (t.ls || 0) / 1000 * L.px;   // la spaziatura aggiunge spazio anche dopo l'ultima lettera
    L.lines.forEach(function (line, i) {
      var lw = ctx.measureText(line).width - (line ? trailing : 0);
      var x = t.align === 'left' ? 0 : t.align === 'right' ? L.w - lw : (L.w - lw) / 2;
      var y = i * L.lineH + (L.lineH - (L.asc + L.desc)) / 2 + L.asc;
      ctx.fillText(line, ox + x, oy + y);
    });
    ctx.restore();
    return L;
  }
  var mctx = null;
  function measure(t, pxPerCm) {
    if (!mctx) mctx = document.createElement('canvas').getContext('2d');
    return layout(mctx, t, pxPerCm);
  }
  function drawAll(ctx, texts, pxPerCm) {
    (texts || []).forEach(function (t) { draw(ctx, t, pxPerCm, t.x * pxPerCm, t.y * pxPerCm); });
  }

  root.TextLayer = { FONTS: FONTS, fontOf: fontOf, ensure: ensure, ensureAll: ensureAll, onLoad: onLoad, loadFace: loadFace,
    cssFont: cssFont, sizePx: sizePx, layout: layout, measure: measure, draw: draw, drawAll: drawAll, PT_CM: PT_CM };
})(this);
