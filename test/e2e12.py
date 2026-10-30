# v0.5.1: regolazioni (luminosita', temperatura, tinta) a schermo e in esportazione
import asyncio, os, subprocess, time, base64, io, json
from playwright.async_api import async_playwright
from PIL import Image, ImageStat
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e12'); os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
def med(im):
    s = ImageStat.Stat(im); return [round(v, 1) for v in s.median]
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8782'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':900}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            await page.goto('http://localhost:8782/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            await page.locator('.tile').nth(0).dblclick(); await page.wait_for_timeout(300)
            await page.locator('.tile').nth(3).dblclick(); await page.wait_for_timeout(1500)
            phs = page.locator('.stage .spread > .ph')
            async def sample(k):
                bb = await phs.nth(k).bounding_box()
                cx, cy = bb['x'] + bb['width']*0.12, bb['y'] + bb['height']*0.82
                png = await page.screenshot(clip={'x': cx-5, 'y': cy-5, 'width': 10, 'height': 10})
                return med(Image.open(io.BytesIO(png)).convert('RGB'))
            async def setv(name, v):
                await page.evaluate("([n, v]) => { const i = document.querySelector('.adjbar input[aria-label=\"'+n+'\"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, String(v)); i.dispatchEvent(new Event('input', {bubbles:true})); }", [name, v])
                await page.wait_for_timeout(400)
            c0 = await sample(0)
            await phs.nth(0).click(); await page.wait_for_timeout(200)
            check(await page.locator('.floatbar >> text=Regola').count()==1, 'nel menu della foto c’è "Regola"')
            await page.click('.floatbar >> text=Regola'); await page.wait_for_selector('.adjbar')
            check(await page.locator('.adjbar input[type=range]').count()==3, 'tre cursori: Luminosità, Temperatura, Tinta')
            await setv('Luminosità', 50); c1 = await sample(0)
            check(sum(c1) > sum(c0) + 30, 'Luminosità +50 schiarisce (%s -> %s)' % (c0, c1))
            await setv('Luminosità', 0); await setv('Temperatura', 70); c2 = await sample(0)
            check(c2[0] > c0[0] + 5 and c2[2] < c0[2] - 5, 'Temperatura +70: più rosso/giallo, meno blu (%s -> %s)' % (c0, c2))
            await page.screenshot(path=OUT+'/01-regola.png')
            await setv('Temperatura', 0); await setv('Tinta', 70); c3 = await sample(0)
            check(c3[1] < c0[1] - 5, 'Tinta +70: verso il magenta, meno verde (%s -> %s)' % (c0, c3))
            # doppio clic azzera
            await page.locator('.adjbar input[aria-label="Tinta"]').dblclick(); await page.wait_for_timeout(300)
            check(await page.locator('.adjbar input[aria-label="Tinta"]').input_value()=='0', 'doppio clic sul cursore lo azzera')
            await setv('Luminosità', 30); await setv('Temperatura', 40)
            await page.click('.adjbar >> text=OK'); await page.wait_for_timeout(300)
            check(await page.locator('.adjbar').count()==0, 'OK chiude la regolazione')
            cA = await sample(0)
            # Cmd+Z annulla tutta la regolazione, Cmd+Shift+Z la rimette
            await page.keyboard.press('Meta+z'); await page.wait_for_timeout(400)
            cU = await sample(0); check(abs(sum(cU) - sum(c0)) < 6, 'Cmd+Z annulla la regolazione')
            await page.keyboard.press('Meta+Shift+z'); await page.wait_for_timeout(400)
            # l'altra foto non cambia
            o0 = await sample(1)
            # Tutta la tavola
            await phs.nth(0).click(); await page.click('.floatbar >> text=Regola'); await page.wait_for_selector('.adjbar')
            await page.click('.adjbar >> text=Tutta la tavola'); await page.keyboard.press('Enter'); await page.wait_for_timeout(400)
            o1 = await sample(1)
            check(sum(o1) > sum(o0) + 15, '"Tutta la tavola" applica le stesse regolazioni all’altra foto')
            # salvataggio nel progetto
            await page.wait_for_timeout(1200)
            album = json.loads(base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Matrimonio Test.album'])")))
            adjs = [it.get('adj') for it in album['spreads'][0]['items']]
            check(all(a and a.get('l')==30 and a.get('t')==40 for a in adjs), 'regolazioni salvate nel progetto %s' % adjs)
            # esportazione: il JPG ha le stesse correzioni dello schermo
            await page.click('.topbar >> text=Esporta'); await page.click('.seg.what >> text=Solo tavole (JPG)')
            await page.fill('.modal input[placeholder^="Tutte"]', '1')
            await page.click('.modal-foot >> text=Esporta'); await page.wait_for_selector('.okmsg', timeout=180000)
            await page.click('.modal-foot >> text=Chiudi')
            data = base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Tavole stampa','tavola-01.jpg'])"))
            im = Image.open(io.BytesIO(data)).convert('RGB')
            sp = await page.locator('.stage .spread').bounding_box(); bb = await phs.nth(0).bounding_box()
            fx = (bb['x'] + bb['width']*0.12 - sp['x']) / sp['width']; fy = (bb['y'] + bb['height']*0.82 - sp['y']) / sp['height']
            X, Y = int(fx*im.width), int(fy*im.height)
            e = med(im.crop((X-15, Y-15, X+15, Y+15)))
            diff = max(abs(e[i]-cA[i]) for i in range(3))
            check(diff <= 8, 'JPG esportato = schermo (schermo %s, JPG %s, differenza max %.0f)' % (cA, e, diff))
            # B/N + regolazioni
            await phs.nth(0).click(); await page.click('.floatbar >> text=B/N'); await page.wait_for_timeout(400)
            g = await sample(0); check(max(g) - min(g) <= 3, 'B/N insieme alle regolazioni resta grigio neutro (%s)' % g)
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
