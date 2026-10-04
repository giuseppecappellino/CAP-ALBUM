/*
 * Esportazione: tavole JPG a 300 dpi con profilo sRGB e PDF provino.
 */
(function (root) {
  'use strict';

  var DPI = 300;
  function cmToPx(cm, dpi) { return Math.round(cm / 2.54 * dpi); }

  // Calcolo del ritaglio: come la foto riempie la cella.
  // crop = { z: zoom >= 1, cx, cy: centro 0..1, r: rotazione in gradi }
  // Ritorna { s: scala (px cella per px foto), cX, cY: centro in px foto, th: radianti }
  function cropTransform(iw, ih, cw, ch, crop) {
    var z = (crop && crop.z) || 1, th = ((crop && crop.r) || 0) * Math.PI / 180;
    var c = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th));
    var bw = cw * c + ch * sn, bh = cw * sn + ch * c; // ingombro della cella ruotata
    var s = Math.max(bw / iw, bh / ih) * z;
    var hw = bw / (2 * s), hh = bh / (2 * s);
    var cx = crop && crop.cx != null ? crop.cx : 0.5, cy = crop && crop.cy != null ? crop.cy : 0.5;
    var cX = Math.min(Math.max(cx * iw, hw), iw - hw), cY = Math.min(Math.max(cy * ih, hh), ih - hh);
    return { s: s, cX: cX, cY: cY, th: th };
  }
  function cssTransform(t, cw, ch) {
    return 'translate(' + (cw / 2) + 'px,' + (ch / 2) + 'px) rotate(' + t.th + 'rad) translate(' + (-t.cX * t.s) + 'px,' + (-t.cY * t.s) + 'px)';
  }

  // Disegna una tavola su un canvas. getBitmap(pid) -> Promise<ImageBitmap>
  function renderSpread(opts) {
    var size = opts.size, pxcm = opts.dpi / 2.54;
    var W = cmToPx(size.w, opts.dpi), H = cmToPx(size.h, opts.dpi);
    var canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    var lay = root.Layout.layoutSpread(opts.spread, size, opts.arOf);
    var chain = Promise.resolve();
    lay.placed.forEach(function (p) {
      chain = chain.then(function () {
        return opts.getBitmap(p.item.pid).then(function (bmp) {
          var x = Math.round(p.x * pxcm), y = Math.round(p.y * pxcm);
          var w = Math.round((p.x + p.w) * pxcm) - x, h = Math.round((p.y + p.h) * pxcm) - y;
          var t = cropTransform(bmp.width, bmp.height, w, h, p.item.crop);
          ctx.save();
          ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
          if (p.item.bw) ctx.filter = 'grayscale(1)';
          ctx.translate(x + w / 2, y + h / 2); ctx.rotate(t.th);
          ctx.drawImage(bmp, -t.cX * t.s, -t.cY * t.s, bmp.width * t.s, bmp.height * t.s);
          ctx.restore();
          var st = opts.styleOf(p.item);
          if (st.border > 0) {
            var b = Math.max(1, Math.round(st.border * pxcm));
            ctx.fillStyle = st.borderColor || '#ffffff';
            ctx.fillRect(x, y, w, b); ctx.fillRect(x, y + h - b, w, b);
            ctx.fillRect(x, y, b, h); ctx.fillRect(x + w - b, y, b, h);
          }
          if (opts.release) opts.release(p.item.pid, bmp);
        });
      });
    });
    return chain.then(function () { return canvas; });
  }

  // ---------- JPEG: 300 dpi nei metadati + profilo sRGB ----------
  function b64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function patchJpeg(bytes, dpi, icc) {
    // bytes: Uint8Array di un JPEG. Toglie gli APP0/APP2 esistenti e inserisce i nostri.
    if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error('Non è un JPEG');
    var pos = 2, keep = [];
    while (pos + 4 <= bytes.length && bytes[pos] === 0xFF) {
      var marker = bytes[pos + 1];
      if (marker === 0xDA) break; // inizio dati immagine
      var len = (bytes[pos + 2] << 8) | bytes[pos + 3];
      if (!(marker === 0xE0 || marker === 0xE2)) keep.push(bytes.subarray(pos, pos + 2 + len));
      pos += 2 + len;
    }
    var rest = bytes.subarray(pos);
    var app0 = new Uint8Array([0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01,
      (dpi >> 8) & 255, dpi & 255, (dpi >> 8) & 255, dpi & 255, 0x00, 0x00]);
    var parts = [new Uint8Array([0xFF, 0xD8]), app0];
    if (icc) {
      var sig = [0x49, 0x43, 0x43, 0x5F, 0x50, 0x52, 0x4F, 0x46, 0x49, 0x4C, 0x45, 0x00]; // ICC_PROFILE\0
      var segLen = 2 + sig.length + 2 + icc.length;
      var app2 = new Uint8Array(2 + segLen);
      app2[0] = 0xFF; app2[1] = 0xE2; app2[2] = (segLen >> 8) & 255; app2[3] = segLen & 255;
      app2.set(sig, 4); app2[4 + sig.length] = 1; app2[5 + sig.length] = 1;
      app2.set(icc, 6 + sig.length);
      parts.push(app2);
    }
    parts = parts.concat(keep, [rest]);
    var total = 0; parts.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total), o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }

  function canvasToJpeg(canvas, quality, dpi) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality: quality }).then(function (blob) {
      return blob.arrayBuffer();
    }).then(function (buf) {
      var icc = root.SRGB_ICC_B64 ? b64ToBytes(root.SRGB_ICC_B64) : null;
      return new Blob([patchJpeg(new Uint8Array(buf), dpi, icc)], { type: 'image/jpeg' });
    });
  }

  // ---------- PDF provino (una pagina per tavola, immagini JPEG) ----------
  function jpegSize(bytes) {
    var pos = 2;
    while (pos < bytes.length) {
      if (bytes[pos] !== 0xFF) return null;
      var m = bytes[pos + 1], len = (bytes[pos + 2] << 8) | bytes[pos + 3];
      if (m >= 0xC0 && m <= 0xC3) return { h: (bytes[pos + 5] << 8) | bytes[pos + 6], w: (bytes[pos + 7] << 8) | bytes[pos + 8] };
      pos += 2 + len;
    }
    return null;
  }
  function buildPdf(pages) {
    // pages: [{ jpeg: Uint8Array, wPt, hPt }]
    var enc = new TextEncoder(), chunks = [], offsets = [], size = 0;
    function add(x) { var b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); size += b.length; }
    function obj(n, body) { offsets[n] = size; add(n + ' 0 obj\n'); body(); add('\nendobj\n'); }
    add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'.replace(/[^\x00-\x7F]/g, 'x'));
    var n = pages.length, kids = [];
    for (var i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
    obj(1, function () { add('<< /Type /Catalog /Pages 2 0 R >>'); });
    obj(2, function () { add('<< /Type /Pages /Count ' + n + ' /Kids [' + kids.join(' ') + '] >>'); });
    pages.forEach(function (p, i) {
      var pn = 3 + i * 3, cn = pn + 1, im = pn + 2, dim = jpegSize(p.jpeg);
      var w = p.wPt.toFixed(2), h = p.hPt.toFixed(2);
      obj(pn, function () { add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + '] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + cn + ' 0 R >>'); });
      var content = 'q ' + w + ' 0 0 ' + h + ' 0 0 cm /Im0 Do Q';
      obj(cn, function () { add('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'); });
      obj(im, function () {
        add('<< /Type /XObject /Subtype /Image /Width ' + dim.w + ' /Height ' + dim.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>\nstream\n');
        add(p.jpeg); add('\nendstream');
      });
    });
    var xref = size, count = 3 + n * 3;
    add('xref\n0 ' + count + '\n0000000000 65535 f \n');
    for (var k = 1; k < count; k++) add(String(offsets[k]).padStart(10, '0') + ' 00000 n \n');
    add('trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(chunks, { type: 'application/pdf' });
  }

  root.Exporter = { DPI: DPI, cmToPx: cmToPx, cropTransform: cropTransform, cssTransform: cssTransform, renderSpread: renderSpread, canvasToJpeg: canvasToJpeg, patchJpeg: patchJpeg, buildPdf: buildPdf };
})(this);
