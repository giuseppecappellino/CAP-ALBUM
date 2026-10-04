import asyncio, base64, io, json, os, subprocess, time
from playwright.async_api import async_playwright
from PIL import Image
ROOT='/home/claude/impaginatore'
OUT='/tmp/claude-0/-home-claude/e7f6ba56-cd65-51c6-b869-07f8a3266013/scratchpad/e2e2'
os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP = """
async (names) => {
  const root = await navigator.storage.getDirectory();
  for await (const [n] of root.entries()) await root.removeEntry(n, {recursive:true});
  const svc = await root.getDirectoryHandle('Matrimonio Test', {create:true});
  const arch = await (await root.getDirectoryHandle('Archivio', {create:true})).getDirectoryHandle('Foto', {create:true});
  for (const n of names) {
    const b = await (await fetch('/test/photos/'+n)).blob();
    const fh = await arch.getFileHandle(n, {create:true}); const w = await fh.createWritable(); await w.write(b); await w.close();
  }
  return true;
}"""
async def rects(page):
    return await page.evaluate("""() => [...document.querySelectorAll('.stage .spread > .ph')].map(e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height, name: e.querySelector('img') ? 1:0}; })""")
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8767'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':860}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            page.on('console', lambda m: errors.append('CONSOLE '+m.text) if m.type=='error' else None)
            await page.goto('http://localhost:8767/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.click('text=+ Nuovo progetto')
            await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            # 1. import da cartella esterna
            await page.evaluate("window.__pickQueue.push(async () => (await (await navigator.storage.getDirectory()).getDirectoryHandle('Archivio')).getDirectoryHandle('Foto'))")
            await page.click('.photos-bar >> text=Importa foto')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            check(True, 'import da cartella esterna: %d foto' % len(PHOTOS))
            for i in [0,1,2]: await page.locator('.tile').nth(i).dblclick()
            await page.wait_for_timeout(600)
            r0 = await rects(page); check(len(r0)==3, 'tre foto in pagina')
            # 3. inserimento SOTTO la prima foto
            tgt = page.locator('.stage .spread > .ph').nth(0); bb = await tgt.bounding_box()
            await page.locator('.tile').nth(4).drag_to(tgt, target_position={'x': bb['width']/2, 'y': bb['height']-6})
            await page.wait_for_timeout(600)
            r1 = await rects(page); check(len(r1)==4, 'foto inserita (4)')
            cnt = await page.inner_text('.counter'); check('manuale' in cnt, 'contatore: layout manuale')
            await page.screenshot(path=OUT+'/01-inserita-sotto.png')
            # verifica geometria: esiste una coppia impilata (stessa x, y diversa)
            stacked = any(abs(a['x']-c['x'])<2 and abs(a['y']-c['y'])>20 for a in r1 for c in r1 if a is not c)
            check(stacked, 'la nuova foto sta sopra/sotto un altra')
            # anteprima durante il trascinamento (manuale: dragover senza drop)
            await page.evaluate("""() => { const t=document.querySelectorAll('.tile')[5]; const dt=new DataTransfer(); t.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
                const ph=document.querySelectorAll('.stage .spread > .ph')[1].getBoundingClientRect();
                document.querySelector('.stage .spread').dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:ph.x+4,clientY:ph.y+ph.height/2})); }""")
            await page.wait_for_timeout(300)
            inc = await page.locator('.stage .spread .ph.incoming').count(); check(inc==1, 'anteprima visibile durante il trascinamento')
            await page.screenshot(path=OUT+'/02-anteprima.png')
            await page.evaluate("""() => { document.querySelectorAll('.tile')[5].dispatchEvent(new DragEvent('dragend',{bubbles:true})); }""")
            await page.wait_for_timeout(200)
            check(await page.locator('.stage .spread .ph.incoming').count()==0 and len(await rects(page))==4, 'anteprima annullata senza modifiche')
            # scambio al centro
            a = page.locator('.stage .spread > .ph').nth(0); bbA = await a.bounding_box()
            c = page.locator('.stage .spread > .ph').nth(3); bbC = await c.bounding_box()
            srcA = await a.locator('img').get_attribute('src')
            await a.drag_to(c, target_position={'x': bbC['width']/2, 'y': bbC['height']/2}); await page.wait_for_timeout(600)
            srcs = await page.evaluate("() => [...document.querySelectorAll('.stage .spread > .ph img')].map(i=>i.getAttribute('src'))")
            check(len(srcs)==4, 'scambio: ancora 4 foto')
            # 4. bordo trascinabile
            dv = page.locator('.stage .spread .divider').first; bbD = await dv.bounding_box()
            before = await rects(page)
            await page.mouse.move(bbD['x']+bbD['width']/2, bbD['y']+bbD['height']/2); await page.mouse.down()
            horiz = 'dh' in (await dv.get_attribute('class'))
            await page.mouse.move(bbD['x']+bbD['width']/2 + (60 if horiz else 0), bbD['y']+bbD['height']/2 + (0 if horiz else 40), steps=8); await page.mouse.up()
            await page.wait_for_timeout(500)
            after = await rects(page)
            changed = sum(1 for x,y in zip(sorted(before,key=lambda r:(r['x'],r['y'])), sorted(after,key=lambda r:(r['x'],r['y']))) if abs(x['w']-y['w'])>5 or abs(x['h']-y['h'])>5)
            check(changed>=2, 'bordo trascinato: %d foto cambiate di proporzione' % changed)
            await page.screenshot(path=OUT+'/03-bordo.png')
            # 5. cursori e tasti +/-
            await page.locator('input[type=range][aria-label=Spacco]').fill('1.2'); await page.wait_for_timeout(300)
            v = await page.locator('input[aria-label="Spacco in cm"]').input_value(); check(v=='1,2', 'cursore spacco = '+v)
            m0 = await page.locator('input[aria-label="Margine in cm"]').input_value()
            await page.locator('.stage').click(position={'x':5,'y':5})
            await page.keyboard.press('+'); await page.wait_for_timeout(200)
            m1 = await page.locator('input[aria-label="Margine in cm"]').input_value(); check(m0=='1' and m1=='1,5', 'tasto + margine %s -> %s' % (m0,m1))
            await page.keyboard.press('-'); await page.wait_for_timeout(200)
            m2 = await page.locator('input[aria-label="Margine in cm"]').input_value(); check(m2=='1', 'tasto - margine -> '+m2)
            # 2/6. ritaglio dentro la cornice con trasparenza + raddrizza
            ph0 = page.locator('.stage .spread > .ph').nth(0); bb0 = await ph0.bounding_box()
            await ph0.dblclick(); await page.wait_for_timeout(300)
            check(await page.locator('.crop-layer .crop-ghost img').count()==1 and await page.locator('.crop-layer .crop-cell img').count()==1, 'ritaglio: foto in cornice + parte esterna in trasparenza')
            await page.locator('.floatbar input[type=range]').nth(0).fill('2')
            await page.locator('.floatbar input[type=range]').nth(1).fill('6')
            cell = page.locator('.crop-cell'); cb = await cell.bounding_box()
            check(abs(cb['width']-bb0['width'])<2 and abs(cb['height']-bb0['height'])<2, 'lo zoom non cambia la cornice in pagina')
            await page.mouse.move(cb['x']+cb['width']/2, cb['y']+cb['height']/2); await page.mouse.down(); await page.mouse.move(cb['x']+cb['width']/2+40, cb['y']+cb['height']/2+20, steps=5); await page.mouse.up()
            await page.wait_for_timeout(300)
            await page.screenshot(path=OUT+'/04-ritaglio.png')
            await page.click('.floatbar >> text=OK'); await page.wait_for_timeout(300)
            check(await page.locator('.crop-layer').count()==0, 'uscita dal ritaglio')
            await page.screenshot(path=OUT+'/05-dopo-ritaglio.png')
            # combinazioni: da manuale torna automatico
            await page.keyboard.press('ArrowDown'); await page.wait_for_timeout(300)
            cnt = await page.inner_text('.counter'); check('di' in cnt, 'freccia giù torna alle combinazioni: '+cnt.replace('\n',' '))
            await page.keyboard.press('Control+z'); await page.wait_for_timeout(300)
            cnt = await page.inner_text('.counter'); check('manuale' in cnt, 'annulla riporta il layout manuale')
            # export tavola 1
            await page.click('.topbar >> text=Esporta'); await page.fill('.modal input[placeholder^="Tutte"]','1')
            await page.click('.modal-foot >> text=Esporta'); await page.wait_for_selector('.okmsg, .modal .error', timeout=120000)
            check(await page.locator('.okmsg').count()==1, 'export completato')
            data = base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Tavole stampa','tavola-01.jpg'])"))
            open(OUT+'/tavola-01.jpg','wb').write(data); im=Image.open(io.BytesIO(data)); check(im.size==(9567,3602) and im.info.get('dpi')==(300,300), 'JPG %s dpi %s' % (im.size, im.info.get('dpi')))
            await page.click('.modal-foot >> text=Chiudi'); await page.wait_for_timeout(1200)
            # file ._ nascosto (come sui dischi esterni) + riapertura da cartella
            await page.evaluate("""async () => { const s = await window.__svc(); const fh = await s.getFileHandle('._Matrimonio Test.album',{create:true}); const w = await fh.createWritable(); await w.write(new Uint8Array([0,5,22,7,0,2,0,0,77,97,99])); await w.close(); }""")
            await page.click('text=‹ Progetti'); await page.wait_for_timeout(600)
            await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('text=Apri progetto da cartella…'); await page.wait_for_timeout(1000)
            check(await page.locator('.editor').count()==1, 'apertura da cartella con file ._ nascosto: nessun errore JSON')
            check(len(await rects(page))==4, 'progetto riaperto con le sue 4 foto')
            await page.click('text=‹ Progetti'); await page.wait_for_timeout(500)
            n = await page.locator('.trow:not(.thead):not(.empty-row)').count(); check(n==1, 'nessun doppione in elenco (%d righe)' % n)
            # ricarica e apri dall'elenco (sorgente esterna ancora collegata)
            await page.reload(); await page.wait_for_timeout(800)
            await page.click('.trow >> text=Matrimonio Test'); await page.wait_for_selector('.editor')
            await page.wait_for_timeout(1500)
            check(await page.locator('.srcbar').count()==0, 'cartella esterna ancora raggiungibile dopo la riapertura')
            check(await page.locator('.tile img').count()==len(PHOTOS), 'miniature dalla cache')
            await page.screenshot(path=OUT+'/06-riaperto.png')
            await b.close()
    finally: srv.terminate()
    print('\\nRISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
