# v0.4.6: anteprima grande nella libreria con la barra spaziatrice
import asyncio, os, subprocess, time
from playwright.async_api import async_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e10'); os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8780'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':900}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))  # BEFOREUNLOAD
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            await page.goto('http://localhost:8780/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            await page.wait_for_timeout(500)
            tiles = page.locator('.tile')
            async def name(): return (await page.locator('.look-name').text_content()) if await page.locator('.lookbox').count() else None
            # spazio senza nulla selezionato: niente
            await page.keyboard.press('Space'); await page.wait_for_timeout(200)
            check(await page.locator('.lookbox').count()==0, 'spazio senza foto selezionata: nessuna anteprima')
            # clic + spazio
            await tiles.nth(4).click(); await page.keyboard.press('Space'); await page.wait_for_timeout(400)
            check(await name()=='DSC1004.jpg', 'clic + spazio apre l’anteprima della foto (%s)' % await name())
            await page.wait_for_function("() => { const i=document.querySelector('.look-img img'); return i && i.naturalWidth >= 1000; }", timeout=20000)
            sz = await page.evaluate("() => { const i=document.querySelector('.look-img img'); const r=i.getBoundingClientRect(); return {nw:i.naturalWidth, nh:i.naturalHeight, w:r.width, h:r.height}; }")
            check(sz['nh'] >= 1700 and sz['h'] > 650, 'anteprima nitida (sorgente %dx%d) e grande sullo schermo (%dx%d px)' % (sz['nw'], sz['nh'], sz['w'], sz['h']))
            await page.screenshot(path=OUT+'/01-anteprima.png')
            # frecce
            await page.keyboard.press('ArrowRight'); await page.wait_for_timeout(300)
            check(await name()=='DSC1005.jpg', '→ passa alla foto successiva')
            sel = await page.evaluate("() => [...document.querySelectorAll('.tile.sel .nm')].map(e=>e.textContent)")
            check(sel==['DSC1005'], 'la selezione nella libreria segue l’anteprima (%s)' % sel)
            await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.wait_for_timeout(300)
            check(await name()=='DSC1003.jpg', '← torna indietro')
            n_sp = await page.locator('.strip-item.on').count()
            on_before = await page.evaluate("() => [...document.querySelectorAll('.strip-item')].findIndex(e=>e.classList.contains('on'))")
            check(on_before==0, 'con l’anteprima aperta le frecce non cambiano tavola')
            # invio = aggiungi
            await page.keyboard.press('Enter'); await page.wait_for_timeout(600)
            check(await page.locator('.stage .spread > .ph').count()==1, 'Invio aggiunge la foto alla tavola')
            check(await page.locator('.lookbox').count()==1, 'l’anteprima resta aperta dopo l’aggiunta')
            await page.screenshot(path=OUT+'/02-aggiunta.png')
            # spazio chiude
            await page.keyboard.press('Space'); await page.wait_for_timeout(300)
            check(await page.locator('.lookbox').count()==0, 'spazio chiude l’anteprima')
            # esc chiude, clic fuori chiude
            await page.keyboard.press('Space'); await page.wait_for_timeout(300)
            check(await name()=='DSC1003.jpg', 'spazio riapre l’ultima foto scelta')
            await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
            check(await page.locator('.lookbox').count()==0, 'Esc chiude')
            await page.keyboard.press('Space'); await page.wait_for_timeout(300)
            await page.mouse.click(30, 30); await page.wait_for_timeout(300)
            check(await page.locator('.lookbox').count()==0, 'clic sullo sfondo chiude')
            # foto della tavola selezionata + spazio
            await page.locator('.stage .spread > .ph').first.click(); await page.keyboard.press('Space'); await page.wait_for_timeout(300)
            check(await name()=='DSC1003.jpg', 'anche una foto selezionata nella tavola si apre con lo spazio')
            await page.keyboard.press('Escape')
            # Cmd+Z ancora funzionante
            await page.keyboard.press('Meta+z'); await page.wait_for_timeout(400)
            check(await page.locator('.stage .spread > .ph').count()==0, 'Cmd+Z annulla l’aggiunta')
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
