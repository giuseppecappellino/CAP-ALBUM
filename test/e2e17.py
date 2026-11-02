# v0.7.2: specchia/capovolgi, importa nel capitolo aperto, rinomina progetto, visualizza file esportati, foglio dopo quello aperto
import asyncio, os, subprocess, time, base64, io, json
from playwright.async_api import async_playwright
from PIL import Image, ImageChops, ImageOps, ImageStat
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e17'); os.makedirs(OUT, exist_ok=True)
ALL=sorted(os.listdir(ROOT+'/test/photos'))
PHOTOS=ALL[:4]; MORE=ALL[4:7]
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
def inner(im):
    w, h = im.size; return im.crop((int(w*.1), int(h*.1), int(w*.9), int(h*.9)))
def diff(a, b):
    a = inner(a); b = inner(b)
    a = a.convert('L').resize((200, 200)); b = b.convert('L').resize((200, 200))
    return ImageStat.Stat(ImageChops.difference(a, b)).mean[0]
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8787'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':900}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            prompts = []
            async def dlg(d):
                if d.type == 'prompt' and prompts: await d.accept(prompts.pop(0))
                else: await d.accept()
            page.on('dialog', lambda d: asyncio.ensure_future(dlg(d)))
            await page.goto('http://localhost:8787/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.evaluate("""async (names) => { const svc = await window.__svc(); const d = await svc.getDirectoryHandle('Sposa', {create:true});
              for (const n of names) { const b = await (await fetch('/test/photos/'+n)).blob(); const fh = await d.getFileHandle(n, {create:true}); const w = await fh.createWritable(); await w.write(b); await w.close(); } }""", MORE)
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('label.check >> text=Usa capitoli')
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            await page.wait_for_timeout(500)

            # 1) capitolo: creato -> si entra dentro -> l'importazione va lì
            prompts.append('Preparazione sposa')
            await page.click('.chips >> text=+ Capitolo'); await page.wait_for_timeout(400)
            check(await page.locator('.chips .chip.on >> text=Preparazione sposa').count()==1, 'il capitolo appena creato si apre da solo')
            check(await page.locator('.intochap').count()==1, 'accanto a Importa compare "Importa in «Preparazione sposa»"')
            check(await page.locator('.tile').count()==0, 'il capitolo nuovo è vuoto')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('Sposa'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(MORE), timeout=60000)
            await page.wait_for_timeout(500)
            check(await page.locator('.tile').count()==len(MORE), 'le foto importate dentro il capitolo compaiono subito lì (%d)' % await page.locator('.tile').count())
            await page.click('.chips >> text=Tutti'); await page.wait_for_timeout(300)
            check(await page.locator('.tile').count()==len(PHOTOS)+len(MORE), 'in "Tutti" ci sono tutte le foto')
            await page.screenshot(path=OUT+'/01-capitolo.png')

            # 2) specchia e capovolgi
            await page.locator('.tile').nth(0).dblclick(); await page.wait_for_timeout(1200)
            ph = page.locator('.stage .spread > .ph').first
            pb = await ph.bounding_box()
            shot0 = Image.open(io.BytesIO(await page.screenshot(clip=pb)))
            await ph.click(); await page.click('.floatbar >> text=Regola'); await page.wait_for_selector('.adjbar')
            await page.click('.adjbar >> text=Specchia'); await page.click('.adjbar >> text=OK'); await page.keyboard.press('Escape'); await page.wait_for_timeout(600)
            shot1 = Image.open(io.BytesIO(await page.screenshot(clip=pb)))
            shot0.save(OUT+'/f0.png'); shot1.save(OUT+'/f1.png'); d_m = diff(ImageOps.mirror(shot0), shot1); d_o = diff(shot0, shot1)
            check(d_m < 6 and d_o > d_m*2, 'Specchia: a schermo la foto è riflessa destra/sinistra (scarto %.1f, dall’originale %.1f)' % (d_m, d_o))
            await ph.click(); await page.click('.floatbar >> text=Regola'); await page.wait_for_selector('.adjbar')
            await page.click('.adjbar >> text=Capovolgi'); await page.wait_for_timeout(300)
            check(await page.locator('.adjbar .tb.on').count()==2, 'i due pulsanti risultano attivi')
            await page.click('.adjbar >> text=OK'); await page.keyboard.press('Escape'); await page.wait_for_timeout(600)
            shot2 = Image.open(io.BytesIO(await page.screenshot(clip=pb)))
            shot2.save(OUT+'/f2.png'); d_r = diff(shot0.rotate(180), shot2)
            check(d_r < 6, 'Specchia + Capovolgi = foto ruotata di 180° (scarto %.1f)' % d_r)
            await page.wait_for_timeout(1500)
            album = json.loads(base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Matrimonio Test.album'])")))
            it = album['spreads'][0]['items'][0]
            check(it.get('fh') and it.get('fv'), 'specchia/capovolgi salvati nel progetto')
            # export della tavola: la foto è capovolta come a schermo
            sp = await page.locator('.stage .spread').bounding_box()
            await page.click('.topbar >> text=Esporta'); await page.click('.seg.what >> text=Solo tavole (JPG)')
            await page.click('.modal-foot >> text=Esporta'); await page.wait_for_selector('.okmsg', timeout=180000)
            im = Image.open(io.BytesIO(base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Tavole stampa','tavola-01.jpg'])"))))
            k = im.width / sp['width']
            crop = im.crop((int((pb['x']-sp['x'])*k), int((pb['y']-sp['y'])*k), int((pb['x']-sp['x']+pb['width'])*k), int((pb['y']-sp['y']+pb['height'])*k)))
            crop.save(OUT+'/f3.png'); d_e = diff(crop, shot2); d_e0 = diff(crop, shot0)
            check(d_e < 8 and d_e0 > d_e*1.5, 'nel JPG esportato la foto è specchiata e capovolta come a schermo (scarto %.1f)' % d_e)

            # 3) visualizza file dopo l'esportazione
            check(await page.locator('.exported .exprow').count()>=1, 'dopo l’export compare il percorso della cartella')
            path_txt = await page.locator('.exported .exprow .mono').first.text_content()
            check('Tavole stampa' in path_txt, 'il percorso indica la cartella delle tavole (%s)' % path_txt)
            await page.screenshot(path=OUT+'/02-esportato.png')
            await page.click('.exported >> text=Visualizza file'); await page.wait_for_selector('.expview')
            await page.wait_for_function("document.querySelectorAll('.exptile img').length >= 1", timeout=30000)
            nt = await page.locator('.exptile').count(); check(nt == len(album['spreads']), 'la galleria mostra tutte le tavole esportate (%d)' % nt)
            await page.screenshot(path=OUT+'/03-galleria.png')
            await page.locator('.exptile').first.click(); await page.wait_for_selector('.expbig img')
            await page.wait_for_function("() => { const i=document.querySelector('.expbig img'); return i && i.naturalWidth > 2000; }", timeout=20000)
            check(True, 'clic su una tavola: si apre a piena risoluzione')
            await page.keyboard.press('ArrowRight'); await page.wait_for_timeout(500)
            check('2 di' in (await page.locator('.expbig .look-bar').text_content()), 'freccia destra: tavola successiva')
            await page.keyboard.press('Escape'); await page.wait_for_timeout(200)
            check(await page.locator('.expbig').count()==0 and await page.locator('.expview').count()==1, 'Esc torna alla griglia')
            await page.keyboard.press('Escape'); await page.wait_for_timeout(200)
            check(await page.locator('.expview').count()==0 and await page.locator('.modal').count()==1, 'Esc di nuovo chiude la galleria, il dialogo resta')
            await page.click('.modal-foot >> text=Chiudi')
            # provino: pulsante Apri provino
            await page.click('.topbar >> text=Esporta'); await page.click('.seg.what >> text=Solo provino (PDF)')
            await page.click('.modal-foot >> text=Esporta'); await page.wait_for_selector('.okmsg', timeout=180000)
            await page.evaluate("() => { window.__opened = []; const o = window.open; window.open = function(u, t) { const rec = { first: u, href: '' }; window.__opened.push(rec); return { closed: false, close() {}, location: { set href(v) { rec.href = v; } } }; }; }")
            await page.click('.exported >> text=Apri provino'); await page.wait_for_timeout(1500)
            info = await page.evaluate("async () => { const o = window.__opened[0]; const href = o.href; let blob = null; if (href.startsWith('blob:')) { const r = await fetch(href); const b = await r.blob(); blob = [b.type, b.size, new TextDecoder().decode((await b.slice(0,5).arrayBuffer()))]; } return { n: window.__opened.length, href: href, blob: blob }; }")
            print('   provino:', info)
            check(info['n']==1 and info['blob'] and info['blob'][2]=='%PDF-', 'Apri provino apre il PDF in una nuova scheda')
            pdfp = page
            await page.click('.modal-foot >> text=Chiudi')

            # 4) aggiungi foglio: dopo quello aperto, anche dal pannello a sinistra
            n0 = len(album['spreads'])
            await page.locator('.stage .spread > .ph').first.wait_for()
            await page.click('.tools >> text=+ Aggiungi'); await page.wait_for_timeout(500)
            check(await page.locator('.stage .spread > .ph').count()==0, 'il pulsante nel pannello a sinistra apre un foglio vuoto')
            await page.wait_for_timeout(1500)
            album = json.loads(base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Matrimonio Test.album'])")))
            check(len(album['spreads'])==n0+1 and len(album['spreads'][1]['items'])==0 and len(album['spreads'][0]['items'])==1,
                  'il nuovo foglio è il 2°, subito dopo quello aperto, non in fondo')
            await page.keyboard.press('ArrowLeft'); await page.wait_for_timeout(300)
            await page.keyboard.press('n'); await page.wait_for_timeout(1500)
            album = json.loads(base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Matrimonio Test.album'])")))
            check(len(album['spreads'])==n0+2 and len(album['spreads'][0]['items'])==1, 'tasto N: altro foglio dopo quello aperto')

            # 5) rinomina dal titolo nell'editor
            prompts.append('Giulia e Marco')
            await page.click('.pname'); await page.wait_for_timeout(2000)
            check('Giulia e Marco' in (await page.locator('.pname').text_content()), 'clic sul nome: il progetto si rinomina')
            ls = await page.evaluate("window.__ls(['Matrimonio Test'])")
            check('Giulia e Marco.album' in ls and 'Matrimonio Test.album' not in ls, 'anche il file .album viene rinominato (%s)' % [x for x in ls if x.endswith('.album')])
            alb = json.loads(base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Giulia e Marco.album'])")))
            check(alb['name']=='Giulia e Marco' and len(alb['photos'])==len(PHOTOS)+len(MORE), 'il progetto rinominato ha tutto il contenuto')
            await page.screenshot(path=OUT+'/04-rinominato.png')
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
