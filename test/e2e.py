import asyncio, base64, io, json, sys, os, subprocess, time
from playwright.async_api import async_playwright
from PIL import Image

ROOT='/home/claude/impaginatore'
OUT='/tmp/claude-0/-home-claude/e7f6ba56-cd65-51c6-b869-07f8a3266013/scratchpad/e2e'
os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))

SETUP = """
async (names) => {
  const root = await navigator.storage.getDirectory();
  for await (const [n] of root.entries()) await root.removeEntry(n, {recursive:true});
  const svc = await root.getDirectoryHandle('Matrimonio Test', {create:true});
  const jpg = await svc.getDirectoryHandle('JPG', {create:true});
  for (const n of names) {
    const b = await (await fetch('/test/photos/'+n)).blob();
    const fh = await jpg.getFileHandle(n, {create:true}); const w = await fh.createWritable(); await w.write(b); await w.close();
  }
  return true;
}"""
INIT = """
window.__pickQueue = [];
window.__TEST_PICK_DIR = async () => { const f = window.__pickQueue.shift(); if (!f) throw Object.assign(new Error('abort'), {name:'AbortError'}); return f(); };
window.__svc = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Matrimonio Test');
window.__readFile = async (parts) => { let d = await navigator.storage.getDirectory(); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); const f = await (await d.getFileHandle(name)).getFile(); const buf = new Uint8Array(await f.arrayBuffer()); let s=''; for (let i=0;i<buf.length;i+=32768) s+=String.fromCharCode.apply(null, buf.subarray(i,i+32768)); return btoa(s); };
window.__ls = async (parts) => { let d = await navigator.storage.getDirectory(); for (const p of parts) d = await d.getDirectoryHandle(p); const o=[]; for await (const [n] of d.entries()) o.push(n); return o.sort(); };
"""

async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8765'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    errors=[]
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            ctx = await b.new_context(viewport={'width':1512,'height':820})
            await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('console', lambda m: errors.append(m.text) if m.type in ('error',) else None)
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            await page.goto('http://localhost:8765/index.html')
            await page.evaluate(SETUP, PHOTOS)
            await page.screenshot(path=OUT+'/01-lista.png')

            # nuovo progetto
            await page.click('text=+ Nuovo progetto')
            await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…')
            await page.wait_for_timeout(300)
            await page.fill('.np-main input[type=text] >> nth=0', 'Matrimonio Test')
            await page.screenshot(path=OUT+'/02-nuovo.png')
            await page.click('text=Tavola doppia'); await page.wait_for_timeout(100)
            txt = await page.inner_text('.result'); print('RESULT doppia:', txt)
            await page.click('text=Pagina singola'); await page.wait_for_timeout(100)
            txt = await page.inner_text('.result'); print('RESULT singola:', txt)
            await page.click('text=Crea progetto')
            await page.wait_for_selector('.editor', timeout=5000)

            # import
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa foto')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            print('import ok, tiles:', await page.locator('.tile').count())

            # aggiungi foto con doppio clic
            for i in [0,1,2,3]:
                await page.locator('.tile').nth(i).dblclick()
            await page.wait_for_timeout(800)
            n = await page.locator('.editor .stage .ph').count(); print('foto sulla tavola:', n)
            await page.screenshot(path=OUT+'/03-editor.png')

            # trascina una foto sopra la prima foto (inserimento)
            src = page.locator('.tile').nth(6)
            dst = page.locator('.editor .stage .ph').nth(0)
            await src.drag_to(dst, target_position={'x':5,'y':20})
            await page.wait_for_timeout(500)
            print('dopo trascinamento:', await page.locator('.editor .stage .ph').count())
            # combinazioni
            c0 = await page.inner_text('.counter')
            await page.keyboard.press('ArrowDown'); await page.wait_for_timeout(200)
            c1 = await page.inner_text('.counter'); print('combinazioni', c0.replace('\n',' '), '->', c1.replace('\n',' '))
            await page.screenshot(path=OUT+'/04-combo.png')
            await page.keyboard.press('w'); await page.wait_for_timeout(400)
            await page.screenshot(path=OUT+'/05-intera.png')
            await page.keyboard.press('w'); await page.keyboard.press('d'); await page.wait_for_timeout(400)
            await page.screenshot(path=OUT+'/06-dividi.png')
            # seleziona e B/N
            await page.locator('.editor .stage .ph').nth(0).click()
            await page.click('.floatbar >> text=B/N'); await page.wait_for_timeout(300)
            # ritaglio
            await page.locator('.editor .stage .ph').nth(1).dblclick(); await page.wait_for_timeout(200)
            await page.screenshot(path=OUT+'/07-ritaglio.png')
            await page.click('.floatbar >> text=OK')
            # tavola 2
            await page.keyboard.press('ArrowRight')
            for i in [8,9,10]:
                await page.locator('.tile').nth(i).dblclick()
            await page.wait_for_timeout(500)
            # stepper spacco
            await page.locator('input[type=range][aria-label=Spacco]').fill('0.6')
            await page.locator('input[type=range][aria-label=Margine]').fill('0.9')
            await page.wait_for_timeout(1500)
            await page.screenshot(path=OUT+'/08-tavola2.png')
            # combos dialog
            await page.click('button[aria-label="Tutte le combinazioni"]'); await page.wait_for_timeout(500)
            await page.screenshot(path=OUT+'/09-combinazioni.png')
            await page.locator('.combo-tile').nth(2).click()
            # undo/redo
            await page.keyboard.press('Control+z'); await page.keyboard.press('Control+Shift+z')

            # export
            await page.click('.topbar >> text=Esporta')
            await page.fill('.modal input[placeholder^="Tutte"]', '1-3')
            await page.click('.modal-foot >> text=Esporta')
            await page.wait_for_selector('.okmsg', timeout=120000)
            print('EXPORT:', await page.inner_text('.okmsg'))
            await page.screenshot(path=OUT+'/10-export.png')
            files = await page.evaluate("window.__ls(['Matrimonio Test','Tavole stampa'])"); print('file export:', files)
            root_files = await page.evaluate("window.__ls(['Matrimonio Test'])"); print('cartella servizio:', root_files)
            b64 = await page.evaluate("window.__readFile(['Matrimonio Test','Tavole stampa','tavola-01.jpg'])")
            data = base64.b64decode(b64); open(OUT+'/tavola-01.jpg','wb').write(data)
            im = Image.open(io.BytesIO(data)); print('JPG:', im.size, 'dpi', im.info.get('dpi'), 'icc', len(im.info.get('icc_profile') or b''), 'bytes', len(data))
            pdf = [f for f in root_files if f.endswith('.pdf')][0]
            b64 = await page.evaluate("window.__readFile(['Matrimonio Test', %s])" % json.dumps(pdf))
            open(OUT+'/provino.pdf','wb').write(base64.b64decode(b64))
            await page.click('.modal-foot >> text=Chiudi')

            # salvataggio e riapertura
            await page.wait_for_timeout(1200)
            album = json.loads(base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Matrimonio Test.album'])")))
            print('album: foto', len(album['photos']), 'tavole', len(album['spreads']), 'foto tav1', len(album['spreads'][0]['items']), 'split', album['spreads'][0]['split'])
            await page.reload(); await page.wait_for_timeout(800)
            await page.screenshot(path=OUT+'/11-lista-dopo.png')
            await page.click('.trow >> text=Matrimonio Test')
            await page.wait_for_selector('.editor', timeout=5000)
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=30000)
            print('riaperto, foto su tavola 1:', await page.locator('.editor .stage .ph').count())
            await page.screenshot(path=OUT+'/12-riaperto.png')
            await b.close()
    finally:
        srv.terminate()
    print('ERRORI CONSOLE:', errors if errors else 'nessuno')

asyncio.run(main())
