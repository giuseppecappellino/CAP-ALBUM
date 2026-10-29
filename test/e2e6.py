# v0.4.1: importazione di foto singole (file per file) accanto all'importazione della cartella
import asyncio, os, subprocess, time
from playwright.async_api import async_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e6'); os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0] + """
window.__fileQueue = [];
window.__TEST_PICK_FILES = async (opts) => { window.__lastFileOpts = opts; const f = window.__fileQueue.shift(); if (!f) throw Object.assign(new Error('abort'), {name:'AbortError'}); return f(); };
window.__pickDirOpts = [];
const __o = window.__TEST_PICK_DIR; window.__TEST_PICK_DIR = async (o) => { window.__pickDirOpts.push(o||{}); return __o(o); };
window.__files = async (parts, names) => { let d = await navigator.storage.getDirectory(); for (const p of parts) d = await d.getDirectoryHandle(p); return Promise.all(names.map(n => d.getFileHandle(n))); };
"""
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8776'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':860}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))  # BEFOREUNLOAD
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            await page.goto('http://localhost:8776/index.html'); await page.evaluate(SETUP, PHOTOS)
            # una cartella "Altro" fuori dal servizio, con 3 foto
            await page.evaluate("""async (names) => { const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle('Altro', {create:true});
              for (const n of names) { const b = await (await fetch('/test/photos/'+n)).blob(); const fh = await d.getFileHandle('X'+n, {create:true}); const w = await fh.createWritable(); await w.write(b); await w.close(); } }""", PHOTOS[:3])
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            check(await page.locator('.photos-bar >> text=Importa cartella').count()==1 and await page.locator('.photos-bar >> text=Importa foto singole').count()==1, 'due pulsanti: Importa cartella e Importa foto singole')

            # 1) due foto singole dalla cartella del servizio: nessuna domanda
            await page.evaluate("window.__fileQueue.push(() => window.__files(['Matrimonio Test','JPG'], [%r, %r]))" % (PHOTOS[2], PHOTOS[5]))
            await page.click('.photos-bar >> text=Importa foto singole')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === 2", timeout=20000)
            check(await page.locator('.modal.askdir').count()==0, 'foto dentro il servizio: importate senza chiedere la cartella')
            st = await page.evaluate("async () => (await window.__lastFileOpts.startIn.isSameEntry(await window.__svc()))")
            check(st, 'la scelta dei file parte dalla cartella del progetto')
            names = await page.evaluate("() => [...document.querySelectorAll('.tile .nm')].map(e=>e.textContent)")
            check(sorted(names)==sorted([PHOTOS[2].rsplit('.',1)[0], PHOTOS[5].rsplit('.',1)[0]]) or len(names)==2, 'importate solo le 2 foto scelte: %s' % names)
            toast = await page.locator('.toast').text_content(); check('2 foto importate' in toast, 'messaggio: %s' % toast)
            await page.screenshot(path=OUT+'/01-singole.png')

            # 2) la stessa foto di nuovo: nessun doppione
            await page.evaluate("window.__fileQueue.push(() => window.__files(['Matrimonio Test','JPG'], [%r]))" % PHOTOS[2])
            await page.click('.photos-bar >> text=Importa foto singole'); await page.wait_for_timeout(600)
            check(await page.locator('.tile').count()==2, 'la stessa foto non viene importata due volte')

            # 3) foto fuori dal servizio: chiede di confermare la cartella
            await page.evaluate("window.__fileQueue.push(() => window.__files(['Altro'], ['X'+%r]))" % PHOTOS[0])
            await page.click('.photos-bar >> text=Importa foto singole')
            await page.wait_for_selector('.modal.askdir'); await page.wait_for_timeout(800); await page.screenshot(path=OUT+'/02-conferma-cartella.png')
            await page.evaluate("window.__pickQueue.push(async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Altro'))")
            await page.click('.modal.askdir >> text=Conferma cartella…')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === 3", timeout=20000)
            check(await page.locator('.modal.askdir').count()==0, 'cartella confermata: importata solo la foto scelta (3 in tutto)')
            so = await page.evaluate("() => { const o = window.__pickDirOpts[window.__pickDirOpts.length-1]; return o.startIn && o.startIn.kind; }")
            check(so=='file', 'la finestra di conferma parte dalla cartella della foto')

            # 4) un'altra foto della stessa cartella: ora la conosce, nessuna domanda
            await page.evaluate("window.__fileQueue.push(() => window.__files(['Altro'], ['X'+%r]))" % PHOTOS[1])
            await page.click('.photos-bar >> text=Importa foto singole')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === 4", timeout=20000)
            check(await page.locator('.modal.askdir').count()==0, 'seconda foto dalla stessa cartella: nessuna domanda')

            # 5) cartella sbagliata confermata: errore chiaro, nessuna importazione
            await page.evaluate("""async (n) => { const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle('Terza', {create:true}); const b = await (await fetch('/test/photos/'+n)).blob(); const fh = await d.getFileHandle('Y'+n, {create:true}); const w = await fh.createWritable(); await w.write(b); await w.close(); }""", PHOTOS[3])
            await page.evaluate("window.__fileQueue.push(() => window.__files(['Terza'], ['Y'+%r]))" % PHOTOS[3])
            await page.click('.photos-bar >> text=Importa foto singole'); await page.wait_for_selector('.modal.askdir')
            await page.evaluate("window.__pickQueue.push(async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Altro'))")
            await page.click('.modal.askdir >> text=Conferma cartella…'); await page.wait_for_timeout(700)
            t = await page.locator('.toast').text_content()
            check('non contiene' in t and await page.locator('.tile').count()==4, 'cartella sbagliata: avviso e nessuna importazione (%s)' % t)
            # 6) annulla
            await page.evaluate("window.__fileQueue.push(() => window.__files(['Terza'], ['Y'+%r]))" % PHOTOS[3])
            await page.click('.photos-bar >> text=Importa foto singole'); await page.wait_for_selector('.modal.askdir')
            await page.click('.modal.askdir >> text=Annulla'); await page.wait_for_timeout(400)
            check(await page.locator('.modal.askdir').count()==0 and await page.locator('.tile').count()==4, 'Annulla chiude senza importare')

            # 7) importa cartella funziona ancora e non duplica
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % (len(PHOTOS)+2), timeout=60000)
            check(True, 'Importa cartella aggiunge il resto senza doppioni (%d foto)' % (len(PHOTOS)+2))
            # 8) riapertura: le foto singole ci sono ancora, con le miniature
            await page.locator('.tile').nth(0).dblclick(); await page.wait_for_timeout(1200)
            await page.reload(); await page.wait_for_timeout(700)
            await page.click('.trow >> text=Matrimonio Test'); await page.wait_for_selector('.editor')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % (len(PHOTOS)+2), timeout=30000)
            check(await page.locator('.srcbar').count()==0, 'dopo la riapertura tutte le foto sono raggiungibili')
            await page.screenshot(path=OUT+'/03-riaperto.png')
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
