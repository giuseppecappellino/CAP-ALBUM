# v0.7.0: testi nell'impaginato (20 font, dimensione, grassetto, spaziatura, interlinea, colore)
import asyncio, os, subprocess, time, base64, io, json
from playwright.async_api import async_playwright
from PIL import Image, ImageOps
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e15'); os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))[:4]
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
def ink_box(im, thr=80):
    g = ImageOps.invert(im.convert('L')).point(lambda v: 255 if v > thr else 0)
    return g.getbbox()
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8785'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':900}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            await page.goto('http://localhost:8785/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            await page.locator('.tile').nth(0).dblclick(); await page.wait_for_timeout(900)
            sp = await page.locator('.stage .spread').bounding_box()
            # 1) aggiungi testo con il tasto T e clic sulla pagina destra (in basso, area bianca)
            await page.keyboard.press('t'); await page.wait_for_timeout(150)
            check(await page.locator('.stage .spread.addtext').count()==1, 'tasto T: modalità "aggiungi testo"')
            await page.mouse.click(sp['x']+sp['width']*0.75, sp['y']+sp['height']*0.88); await page.wait_for_timeout(300)
            check(await page.locator('.stage .txt textarea').count()==1, 'clic sulla tavola: casella di testo pronta per scrivere')
            await page.keyboard.type('Giulia & Marco'); await page.keyboard.press('Enter'); await page.keyboard.type('sposi · 12 giugno')
            await page.keyboard.press('Escape'); await page.wait_for_timeout(500)
            check(await page.locator('.stage .txt canvas').count()==1, 'Esc conclude la scrittura, il testo resta in tavola')
            # 2) formattazione
            await page.locator('.stage .txt').first.click(); await page.wait_for_timeout(200)
            check(await page.locator('.textbar').count()==1, 'clic sul testo: barra di formattazione')
            await page.click('.textbar .fontbtn'); await page.wait_for_timeout(300)
            nf = await page.locator('.fontlist .fitem').count(); check(nf==20, '20 font nel menu (%d)' % nf)
            await page.screenshot(path=OUT+'/01-font.png')
            await page.click('.fontlist .fitem >> text=Great Vibes'); await page.wait_for_timeout(600)
            fl = await page.evaluate("() => document.fonts.check('20px \"CAP Great Vibes\"')"); check(fl, 'il font scelto viene caricato')
            for _ in range(5): await page.click('.textbar .sizectl .tb >> nth=1')
            await page.click('.textbar button[title^="Grassetto"]')
            await page.click('.textbar button[title="Allinea a sinistra"]')
            async def rng(label, v):
                await page.evaluate("([l,v]) => { const i=document.querySelector('.textbar input[aria-label=\"'+l+'\"]'); i.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i,String(v)); i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); }", [label, v]); await page.wait_for_timeout(200)
            await rng('Spaziatura', 120); await rng('Interlinea', 1.6)
            await page.click('.textbar .sw >> nth=3'); await page.wait_for_timeout(600)
            await page.screenshot(path=OUT+'/02-formattato.png')
            await page.wait_for_timeout(1200)
            album = json.loads(base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Matrimonio Test.album'])")))
            t = album['spreads'][0].get('texts', [{}])[0]
            print('   testo salvato:', {k: t.get(k) for k in ('text','font','size','bold','align','ls','lh','color','w')})
            check(t.get('text')=='Giulia & Marco\nsposi · 12 giugno' and t.get('font')=='great-vibes' and t.get('size')==38 and t.get('bold') and t.get('align')=='left' and t.get('ls')==120 and abs(t.get('lh',0)-1.6)<1e-6 and t.get('color')=='#b08d57',
                  'testo e formattazione salvati nel progetto')
            # 3) disegno: il canvas non è vuoto e cambia con la dimensione
            ink = await page.evaluate("() => { const c=document.querySelector('.stage .txt canvas'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for (let i=3;i<d.length;i+=4) if (d[i]>100) n++; return n; }")
            check(ink > 500, 'il testo è disegnato (%d pixel)' % ink)
            # 4) sposta e allarga
            tb = await page.locator('.stage .txt').first.bounding_box()
            await page.mouse.move(tb['x']+tb['width']/2, tb['y']+tb['height']/2); await page.mouse.down(); await page.mouse.move(tb['x']+tb['width']/2-120, tb['y']+tb['height']/2-40, steps=6); await page.mouse.up(); await page.wait_for_timeout(300)
            tb2 = await page.locator('.stage .txt').first.bounding_box()
            check(abs((tb['x']-tb2['x'])-120) < 3, 'trascinando, il testo si sposta')
            rh = await page.locator('.stage .txt .th.r').bounding_box()
            await page.mouse.move(rh['x']+4, rh['y']+10); await page.mouse.down(); await page.mouse.move(rh['x']+64, rh['y']+10, steps=5); await page.mouse.up(); await page.wait_for_timeout(300)
            tb3 = await page.locator('.stage .txt').first.bounding_box(); check(tb3['width'] > tb2['width'] + 50, 'la maniglia destra allarga la casella')
            # 5) elimina e annulla
            await page.keyboard.press('Backspace'); await page.wait_for_timeout(300)
            check(await page.locator('.stage .txt').count()==0, 'Canc elimina il testo selezionato')
            await page.keyboard.press('Meta+z'); await page.wait_for_timeout(400)
            check(await page.locator('.stage .txt').count()==1, 'Cmd+Z lo rimette')
            # 6) testo vuoto non resta
            await page.click('.tool >> text=Aggiungi'); await page.mouse.click(sp['x']+sp['width']*0.25, sp['y']+sp['height']*0.9); await page.wait_for_timeout(200)
            await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
            check(await page.locator('.stage .txt').count()==1, 'una casella lasciata vuota sparisce')
            # 7) esportazione: il testo c'è e ha la stessa misura dello schermo
            await page.locator('.stage .txt').first.click(); await page.wait_for_timeout(100)
            await page.keyboard.press('Escape')
            tbE = await page.locator('.stage .txt').first.bounding_box(); spE = await page.locator('.stage .spread').bounding_box()
            scr = Image.open(io.BytesIO(await page.screenshot(clip={'x': tbE['x'], 'y': tbE['y'], 'width': tbE['width'], 'height': tbE['height']})))
            sbox = ink_box(scr)
            await page.click('.topbar >> text=Esporta'); await page.click('.seg.what >> text=Solo tavole (JPG)')
            await page.fill('.modal input[placeholder^="Tutte"]', '1')
            await page.click('.modal-foot >> text=Esporta'); await page.wait_for_selector('.okmsg', timeout=180000); await page.click('.modal-foot >> text=Chiudi')
            im = Image.open(io.BytesIO(base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Tavole stampa','tavola-01.jpg'])"))))
            k = im.width / spE['width']
            crop = im.crop((int((tbE['x']-spE['x'])*k), int((tbE['y']-spE['y'])*k), int((tbE['x']-spE['x']+tbE['width'])*k), int((tbE['y']-spE['y']+tbE['height'])*k)))
            crop.save(OUT+'/03-export-testo.png'); scr.save(OUT+'/03-schermo-testo.png')
            ebox = ink_box(crop)
            print('   ingombro schermo', sbox, 'export', ebox, 'scala', round(k,2))
            if sbox and ebox:
                rw = ((ebox[2]-ebox[0])/k) / (sbox[2]-sbox[0]); rh2 = ((ebox[3]-ebox[1])/k) / (sbox[3]-sbox[1])
                check(abs(rw-1) < 0.06 and abs(rh2-1) < 0.08, 'nel JPG esportato il testo ha la stessa misura e gli stessi a capo (larghezza %.2f, altezza %.2f)' % (rw, rh2))
            else: check(False, 'testo non trovato nell’export')
            # 8) inverti pagine sposta anche il testo
            x0 = (await page.locator('.stage .txt').first.bounding_box())['x']
            await page.keyboard.press('i'); await page.wait_for_timeout(700)
            x1 = (await page.locator('.stage .txt').first.bounding_box())['x']
            check(abs(abs(x1-x0) - spE['width']/2) < 3, 'Inverti pagine porta il testo sull’altra pagina')
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
