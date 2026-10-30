# v0.6.0: rimozione oggetti (pennello + MI-GAN nel browser)
import asyncio, os, subprocess, time, base64, io, json
from playwright.async_api import async_playwright
from PIL import Image, ImageStat
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e14'); os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))[:3]
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
def region_stats(im, box):
    c = im.crop(box).convert('RGB'); s = ImageStat.Stat(c)
    return [round(v) for v in s.mean], [round(v) for v in s.stddev]
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8784'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':900}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            page.on('console', lambda m: print('CONSOLE', m.text[:160]) if m.type in ('error',) else None)
            await page.goto('http://localhost:8784/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.evaluate("""async () => { const svc = await window.__svc(); const jpg = await svc.getDirectoryHandle('JPG');
              const b = await (await fetch('/test/astronaut.jpg')).blob(); const fh = await jpg.getFileHandle('ZZ_astronauta.jpg', {create:true}); const w = await fh.createWritable(); await w.write(b); await w.close(); }""")
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % (len(PHOTOS)+1), timeout=60000)
            await page.locator('.tile').last.dblclick(); await page.wait_for_timeout(1500)
            ph = page.locator('.stage .spread > .ph').first
            await ph.click(); await page.wait_for_timeout(200)
            check(await page.locator('.floatbar >> text=Rimuovi oggetti').count()==1, 'nel menu della foto c’è "Rimuovi oggetti"')
            await page.click('.floatbar >> text=Rimuovi oggetti'); await page.wait_for_selector('.erasebox')
            await page.wait_for_function("() => { const i=document.querySelector('.erase-frame img'); return i && i.naturalWidth > 1000; }", timeout=30000)
            fr = await page.locator('.erase-frame').bounding_box()
            png = await page.screenshot(clip=fr); before = Image.open(io.BytesIO(png))
            RB = (int(fr['width']*0.72), int(fr['height']*0.05), int(fr['width']*0.9), int(fr['height']*0.5))   # zona del razzo
            sb = region_stats(before, RB)
            # pennello grande e tratti verticali sul razzo
            await page.evaluate("() => { const i=document.querySelector('.erase-bar input[type=range]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i,'90'); i.dispatchEvent(new Event('input',{bubbles:true})); }")
            for fx in (0.70, 0.76, 0.82, 0.88, 0.93):
                await page.mouse.move(fr['x']+fr['width']*fx, fr['y']+fr['height']*0.0+2); await page.mouse.down()
                await page.mouse.move(fr['x']+fr['width']*fx, fr['y']+fr['height']*0.56, steps=12); await page.mouse.up()
            await page.wait_for_timeout(200)
            await page.screenshot(path=OUT+'/01-pennello.png')
            check(await page.locator('.erase-bar >> text=Rimuovi').first.is_enabled(), 'dopo i tratti il pulsante "Rimuovi" è attivo')
            await page.keyboard.press('Meta+z'); await page.wait_for_timeout(150)
            await page.mouse.move(fr['x']+fr['width']*0.93, fr['y']+2); await page.mouse.down(); await page.mouse.move(fr['x']+fr['width']*0.93, fr['y']+fr['height']*0.56, steps=12); await page.mouse.up()
            t0 = time.time()
            await page.click('.erase-bar >> text=Rimuovi')
            await page.wait_for_selector('.erase-busy', timeout=5000)
            await page.wait_for_selector('.erase-busy', state='detached', timeout=180000)
            dt = time.time()-t0
            check(await page.locator('.erase-err').count()==0, 'elaborazione completata senza errori in %.1f s (comprende il caricamento del modello)' % dt)
            await page.wait_for_timeout(1500)
            png = await page.screenshot(clip=fr); after = Image.open(io.BytesIO(png)); after.save(OUT+'/02-dopo.png'); before.save(OUT+'/00-prima.png')
            sa = region_stats(after, RB)
            print('   razzo prima:', sb, ' dopo:', sa)
            check(sa[1][0] < sb[1][0]*0.6, 'il razzo è sparito: la zona diventa sfondo uniforme (variazione %d -> %d)' % (sb[1][0], sa[1][0]))
            check('ritocc' in (await page.locator('.erase-top').text_content()), 'l’intestazione indica i ritocchi applicati')
            # confronta
            cb = await page.locator('.erase-bar >> text=Confronta').bounding_box()
            await page.mouse.move(cb['x']+10, cb['y']+10); await page.mouse.down(); await page.wait_for_timeout(400)
            pc = await page.screenshot(clip=fr); sc = region_stats(Image.open(io.BytesIO(pc)), RB)
            await page.mouse.up()
            check(abs(sc[1][0]-sb[1][0]) < 8, 'tenendo premuto "Confronta" si vede l’originale')
            await page.click('.erase-bar >> text=Fatto'); await page.wait_for_timeout(1500)
            # file e progetto
            ls = await page.evaluate("window.__ls(['Matrimonio Test','.impaginatore','erase'])")
            check(len(ls)==1 and ls[0].endswith('.jpg'), 'versione ripulita salvata nella cartella nascosta del servizio (%s)' % ls)
            await page.wait_for_timeout(1200)
            album = json.loads(base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Matrimonio Test.album'])")))
            er = [x for x in album['photos'] if x['name']=='ZZ_astronauta.jpg'][0].get('erase')
            check(er and len(er['strokes'])==5 and er['file']==ls[0], 'i tratti sono salvati nel progetto (%d)' % (len(er['strokes']) if er else 0))
            orig = await page.evaluate("window.__ls(['Matrimonio Test','JPG'])")
            check('ZZ_astronauta.jpg' in orig, 'il file originale resta al suo posto')
            # in tavola e in esportazione
            await page.click('.topbar >> text=Esporta'); await page.click('.seg.what >> text=Solo tavole (JPG)')
            await page.fill('.modal input[placeholder^="Tutte"]', '1')
            await page.click('.modal-foot >> text=Esporta'); await page.wait_for_selector('.okmsg', timeout=180000); await page.click('.modal-foot >> text=Chiudi')
            data = base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Tavole stampa','tavola-01.jpg'])"))
            im = Image.open(io.BytesIO(data))
            sp = await page.locator('.stage .spread').bounding_box(); pb = await ph.bounding_box()
            fx0 = (pb['x']-sp['x'])/sp['width']; fy0 = (pb['y']-sp['y'])/sp['height']; fw = pb['width']/sp['width']; fh = pb['height']/sp['height']
            box = (int((fx0+fw*0.72)*im.width), int((fy0+fh*0.05)*im.height), int((fx0+fw*0.9)*im.width), int((fy0+fh*0.5)*im.height))
            se = region_stats(im, box); im.crop((int(fx0*im.width), int(fy0*im.height), int((fx0+fw)*im.width), int((fy0+fh)*im.height))).resize((600,600)).save(OUT+'/03-export.png')
            check(se[1][0] < sb[1][0]*0.6, 'anche nel JPG esportato il razzo non c’è (variazione %d)' % se[1][0])
            # ripristina
            await ph.click(); await page.click('.floatbar >> text=Rimuovi oggetti'); await page.wait_for_selector('.erasebox')
            page.once('dialog', lambda d: asyncio.ensure_future(d.accept()))
            await page.click('.erase-bar >> text=Ripristina originale'); await page.wait_for_timeout(2500)
            check('ritocc' not in (await page.locator('.erase-top').text_content()), '"Ripristina originale" toglie la rimozione')
            await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
            check(await page.locator('.erasebox').count()==0, 'Esc chiude')
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
