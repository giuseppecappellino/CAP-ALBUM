# v0.7.1: libreria in finestra separata + togliere foto (e doppioni) dalla libreria
import asyncio, os, subprocess, time, base64, json
from playwright.async_api import async_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e16'); os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))[:8]
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8786'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1400,'height':860}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            await page.goto('http://localhost:8786/index.html'); await page.evaluate(SETUP, PHOTOS)
            # cartella "Copia" con 3 doppioni (stesso nome e stesso contenuto)
            await page.evaluate("""async (names) => { const svc = await window.__svc(); const d = await svc.getDirectoryHandle('Copia', {create:true});
              for (const n of names) { const b = await (await fetch('/test/photos/'+n)).blob(); const fh = await d.getFileHandle(n, {create:true}); const w = await fh.createWritable(); await w.write(b); await w.close(); } }""", PHOTOS[:3])
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            await page.wait_for_timeout(2600)
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('Copia'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % (len(PHOTOS)+3), timeout=60000)
            await page.wait_for_timeout(500)

            # 1) libreria in finestra separata
            st_before = await page.locator('.stage').bounding_box()
            async with page.expect_popup() as pi:
                await page.click('.photos-bar .winbtn')
            lib = await pi.value
            lib.on('pageerror', lambda e: errors.append('PAGEERROR(lib) '+str(e)))
            await lib.wait_for_selector('.photos.inwin .tile img', timeout=15000)
            await page.wait_for_timeout(400)
            check(await page.locator('.editor .photos').count()==0 and await page.locator('.editor.detached').count()==1, 'la libreria esce dalla finestra principale')
            nt = await lib.locator('.tile').count(); check(nt == len(PHOTOS)+3, 'la finestra separata mostra tutte le foto (%d)' % nt)
            st_after = await page.locator('.stage').bounding_box()
            check(st_after['height'] > st_before['height'] + 150, 'lo spazio di lavoro si allarga (%.0f -> %.0f px)' % (st_before['height'], st_after['height']))
            await lib.screenshot(path=OUT+'/01-finestra-libreria.png'); await page.screenshot(path=OUT+'/02-finestra-principale.png')
            # 2) doppio clic nella finestra libreria -> foto nella tavola
            await lib.locator('.tile').nth(3).dblclick(); await page.wait_for_timeout(700)
            check(await page.locator('.stage .spread > .ph').count()==1, 'doppio clic nella finestra libreria: la foto entra nella tavola')
            check(await lib.locator('.tile .badge').count()>=1, 'la finestra libreria segna la foto come usata')
            # 3) trascinamento dalla finestra libreria alla tavola
            await lib.evaluate("() => { const t=document.querySelectorAll('.tile')[5]; t.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()})); }")
            sp = await page.locator('.stage .spread').bounding_box()
            for _ in range(6):
                await page.evaluate("([x,y]) => { const el=document.elementFromPoint(x,y); el.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer(),clientX:x,clientY:y})); }", [sp['x']+sp['width']*0.85, sp['y']+sp['height']*0.5]); await page.wait_for_timeout(80)
            await page.evaluate("([x,y]) => { const el=document.elementFromPoint(x,y); el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer(),clientX:x,clientY:y})); }", [sp['x']+sp['width']*0.85, sp['y']+sp['height']*0.5])
            await page.wait_for_timeout(800)
            check(await page.locator('.stage .spread > .ph').count()==2, 'trascinando dalla finestra libreria alla tavola la foto entra')
            # 4) tasti nella finestra libreria: spazio = anteprima
            await lib.locator('.tile').nth(1).click(); await lib.keyboard.press('Space'); await page.wait_for_timeout(500)
            check(await page.locator('.lookbox').count()==1, 'spazio nella finestra libreria apre l’anteprima grande')
            await lib.keyboard.press('Escape'); await page.wait_for_timeout(300)
            # 5) doppioni
            await lib.click('.libsel >> text=Trova doppioni'); await lib.wait_for_timeout(300)
            ns = await lib.locator('.tile.sel').count(); check(ns==3, 'trova doppioni: seleziona le 3 copie (%d)' % ns)
            await lib.click('.libsel >> text=Togli dalla libreria'); await lib.wait_for_selector('.modal')
            await lib.screenshot(path=OUT+'/03-conferma.png')
            await lib.click('.modal-foot >> text=Togli'); await lib.wait_for_timeout(600)
            nt2 = await lib.locator('.tile').count(); check(nt2 == len(PHOTOS), 'doppioni tolti dalla libreria (%d foto)' % nt2)
            check(await page.locator('.stage .spread > .ph').count()==2, 'le foto in tavola non vengono toccate')
            # 6) togliere una foto usata in tavola: avviso e la tavola si aggiorna
            await lib.locator('.tile:has(.badge)').first.click(); await lib.keyboard.press('Backspace'); await lib.wait_for_selector('.modal')
            w = await lib.locator('.modal .warn').count(); check(w==1, 'se la foto è già in tavola la conferma lo dice')
            await lib.click('.modal-foot >> text=Togli'); await lib.wait_for_timeout(700)
            check(await page.locator('.stage .spread > .ph').count()==1 and await lib.locator('.tile').count()==len(PHOTOS)-1, 'foto tolta da libreria e tavola')
            await page.keyboard.press('Meta+z'); await page.wait_for_timeout(300)
            check(await page.locator('.stage .spread > .ph').count()==1, 'Cmd+Z dopo una rimozione non rimette foto non più esistenti')
            # 7) riaggancia dalla finestra libreria
            await lib.click('.photos-bar .winbtn'); await page.wait_for_timeout(700)
            check(lib.is_closed() and await page.locator('.editor .photos').count()==1, '"Riaggancia" chiude la finestra e riporta la libreria nella principale')
            # 8) chiudendo la finestra a mano la libreria torna nella principale
            async with page.expect_popup() as pi2:
                await page.click('.photos-bar .winbtn')
            lib2 = await pi2.value; await lib2.wait_for_selector('.photos.inwin')
            await lib2.close(); await page.wait_for_timeout(1500)
            check(await page.locator('.editor .photos').count()==1, 'chiudendo la finestra a mano la libreria torna nella principale')
            # 9) progetto salvato senza le foto tolte
            await page.wait_for_timeout(1200)
            album = json.loads(base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Matrimonio Test.album'])")))
            pids = {x['id'] for x in album['photos']}
            check(len(album['photos'])==len(PHOTOS)-1 and all(it['pid'] in pids for sp_ in album['spreads'] for it in sp_['items']), 'progetto salvato coerente (%d foto)' % len(album['photos']))
            ls = await page.evaluate("window.__ls(['Matrimonio Test','Copia'])"); check(len(ls)==3, 'i file dei doppioni restano sul disco')
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
