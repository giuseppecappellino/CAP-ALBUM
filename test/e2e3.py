import asyncio, base64, io, json, os, subprocess, time
from playwright.async_api import async_playwright
from PIL import Image
ROOT='/home/claude/impaginatore'
OUT='/tmp/claude-0/-home-claude/e7f6ba56-cd65-51c6-b869-07f8a3266013/scratchpad/e2e3'
os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))[:12]
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP = """
async (names) => {
  const root = await navigator.storage.getDirectory();
  for await (const [n] of root.entries()) await root.removeEntry(n, {recursive:true});
  const disk = await root.getDirectoryHandle('DISCO', {create:true});
  const svc = await (await disk.getDirectoryHandle('Lavori', {create:true})).getDirectoryHandle('Matrimonio Test', {create:true});
  const arch = await (await disk.getDirectoryHandle('Archivio', {create:true})).getDirectoryHandle('Foto', {create:true});
  for (const n of names) {
    const b = await (await fetch('/test/photos/'+n)).blob();
    const fh = await arch.getFileHandle(n, {create:true}); const w = await fh.createWritable(); await w.write(b); await w.close();
  }
  window.__disk = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('DISCO');
  return true;
}"""
DISK="async () => (await navigator.storage.getDirectory()).getDirectoryHandle('DISCO')"
SVC="async () => (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('DISCO')).getDirectoryHandle('Lavori')).getDirectoryHandle('Matrimonio Test')"
FOTO="async () => (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('DISCO')).getDirectoryHandle('Archivio')).getDirectoryHandle('Foto')"
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8770'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':860}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            page.on('console', lambda m: errors.append('CONSOLE '+m.text) if m.type=='error' else None)
            await page.goto('http://localhost:8770/index.html'); await page.evaluate(SETUP, PHOTOS)
            # --- Mac 1: collega archivio, crea progetto, importa da altra cartella del disco
            await page.evaluate("window.__pickQueue.push(%s)" % DISK)
            await page.click('text=+ Collega archivio…'); await page.wait_for_timeout(800)
            check(await page.locator('.rootchip.ok').count()==1, 'archivio DISCO collegato')
            await page.screenshot(path=OUT+'/01-archivio.png')
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(%s)" % SVC)
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(%s)" % FOTO)
            await page.click('.photos-bar >> text=Importa foto')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            for i in [0,1,3]: await page.locator('.tile').nth(i).dblclick()
            await page.wait_for_timeout(1200)
            album = json.loads(base64.b64decode(await page.evaluate("window.__readFile(['DISCO','Lavori','Matrimonio Test','Matrimonio Test.album'])")))
            src = album['sources'][0] if album['sources'] else {}
            check(src.get('rel')==['Archivio','Foto'] and src.get('root')=='DISCO', 'cartella foto registrata rispetto all archivio: %s' % src.get('rel'))
            # --- ritaglio dagli angoli
            ph0 = page.locator('.stage .spread > .ph').nth(0); bb0 = await ph0.bounding_box()
            tr0 = await ph0.locator('img').evaluate("e => e.style.transform")
            await ph0.dblclick(); await page.wait_for_timeout(500)
            check(await page.locator('.crop-handle').count()==4, 'quattro maniglie agli angoli')
            h = page.locator('.crop-handle.se'); hb = await h.bounding_box()
            x0 = hb['x']+hb['width']/2; y0 = hb['y']+hb['height']/2
            await page.mouse.move(x0, y0); await page.mouse.down()
            await page.mouse.move(x0 - bb0['width']*0.4, y0 - bb0['height']*0.4, steps=10)
            await page.wait_for_timeout(200)
            rect = await page.locator('.crop-rect').bounding_box()
            check(abs(rect['width'] - bb0['width']*0.6) < 6 and abs(rect['width']/rect['height'] - bb0['width']/bb0['height']) < 0.02, 'riquadro ristretto al 60%% con le stesse proporzioni (%.0f×%.0f)' % (rect['width'], rect['height']))
            await page.screenshot(path=OUT+'/02-ritaglio-trascino.png')
            await page.mouse.up(); await page.wait_for_timeout(900)
            rect2 = await page.locator('.crop-rect').bounding_box()
            check(abs(rect2['width']-bb0['width'])<2 and abs(rect2['height']-bb0['height'])<2, 'al rilascio il riquadro torna a misura dello spazio in pagina')
            await page.screenshot(path=OUT+'/03-ritaglio-rilasciato.png')
            await page.click('.floatbar >> text=OK'); await page.wait_for_timeout(900)
            bb1 = await page.locator('.stage .spread > .ph').nth(0).bounding_box()
            check(abs(bb1['width']-bb0['width'])<2 and abs(bb1['x']-bb0['x'])<2, 'lo spazio in pagina non cambia')
            await page.wait_for_timeout(900)
            album = json.loads(base64.b64decode(await page.evaluate("window.__readFile(['DISCO','Lavori','Matrimonio Test','Matrimonio Test.album'])")))
            crop = album['spreads'][0]['items'][0].get('crop') or {}
            check(abs(crop.get('z',1) - 1/0.6) < 0.06, 'zoom salvato = %.2f (atteso 1,67)' % crop.get('z',1))
            check(crop.get('cx',0.5) < 0.5 and crop.get('cy',0.5) < 0.5, 'il ritaglio tiene la parte in alto a sinistra (cx %.2f, cy %.2f)' % (crop.get('cx',.5), crop.get('cy',.5)))
            await page.screenshot(path=OUT+'/04-dopo-ritaglio.png')
            # allarga di nuovo dall angolo (zoom indietro fino al limite della foto)
            await page.locator('.stage .spread > .ph').nth(0).dblclick(); await page.wait_for_timeout(400)
            hb = await page.locator('.crop-handle.se').bounding_box(); x0 = hb['x']+8; y0 = hb['y']+8
            await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x0+400, y0+300, steps=8); await page.mouse.up(); await page.wait_for_timeout(700)
            await page.click('.floatbar >> text=OK'); await page.wait_for_timeout(1300)
            album = json.loads(base64.b64decode(await page.evaluate("window.__readFile(['DISCO','Lavori','Matrimonio Test','Matrimonio Test.album'])")))
            z = (album['spreads'][0]['items'][0].get('crop') or {}).get('z',1)
            check(abs(z-1)<0.01, 'allargando oltre il limite si torna alla foto intera (zoom %.2f)' % z)
            # export
            await page.click('.topbar >> text=Esporta'); await page.fill('.modal input[placeholder^="Tutte"]','1')
            await page.click('.modal-foot >> text=Esporta'); await page.wait_for_selector('.okmsg, .modal .error', timeout=120000)
            check(await page.locator('.okmsg').count()==1, 'export ok')
            await page.click('.modal-foot >> text=Chiudi'); await page.wait_for_timeout(1000)
            await page.click('text=‹ Progetti'); await page.wait_for_timeout(600)
            # --- Mac 2: stesso disco, browser "vuoto" (nessun elenco, nessun permesso salvato)
            await page.evaluate("""() => new Promise(r => { const q = indexedDB.deleteDatabase('impaginatore'); q.onsuccess = q.onerror = q.onblocked = () => r(); })""")
            await page.evaluate("localStorage.clear()")
            await page.reload(); await page.wait_for_timeout(800)
            n0 = await page.locator('.trow:not(.thead):not(.empty-row)').count(); check(n0==0, 'secondo Mac: elenco vuoto all inizio')
            await page.evaluate("window.__pickQueue.push(%s)" % DISK)
            await page.click('text=+ Collega archivio…'); await page.wait_for_timeout(1200)
            n1 = await page.locator('.trow:not(.thead):not(.empty-row)').count(); check(n1==1, 'secondo Mac: collegato il disco, progetto trovato da solo (%d)' % n1)
            await page.screenshot(path=OUT+'/05-secondo-mac.png')
            await page.click('.trow >> text=Matrimonio Test'); await page.wait_for_selector('.editor'); await page.wait_for_timeout(1500)
            check(await page.locator('.srcbar').count()==0, 'secondo Mac: cartella foto ritrovata senza ricollegare')
            check(await page.locator('.tile img').count()==len(PHOTOS), 'secondo Mac: miniature presenti')
            check(await page.locator('.stage .spread > .ph img').count()==3, 'secondo Mac: tavola con le sue 3 foto')
            await page.click('.topbar >> text=Esporta'); await page.fill('.modal input[placeholder^="Tutte"]','1')
            await page.click('.modal-foot >> text=Esporta'); await page.wait_for_selector('.okmsg, .modal .error', timeout=120000)
            check(await page.locator('.okmsg').count()==1, 'secondo Mac: export a piena risoluzione ok')
            await page.screenshot(path=OUT+'/06-secondo-mac-editor.png')
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
