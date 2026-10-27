# v0.4.2: selezione multipla, copia / taglia / incolla fra tavole, duplica progetto
import asyncio, os, subprocess, time
from playwright.async_api import async_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e7'); os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8777'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':900}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            prompts = []
            async def on_dialog(d):
                if d.type == 'prompt' and prompts: await d.accept(prompts.pop(0))
                else: await d.accept()
            page.on('dialog', lambda d: asyncio.ensure_future(on_dialog(d)))
            await page.goto('http://localhost:8777/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            for i in (0, 1, 3): await page.locator('.tile').nth(i).dblclick(); await page.wait_for_timeout(250)
            phs = page.locator('.stage .spread > .ph')
            async def cnt(): return await phs.count()
            async def nsel(): return await page.locator('.stage .spread > .ph.sel').count()
            async def go(i): await page.locator('.strip-item').nth(i).click(); await page.wait_for_timeout(350)
            check(await cnt()==3, 'tavola 1 con 3 foto')

            # 1) una foto: copia e incolla in un'altra tavola
            await phs.nth(0).click(); 
            await page.keyboard.press('Meta+c'); await page.wait_for_timeout(200)
            t = await page.locator('.toast').text_content(); check('copiata' in t, 'Cmd+C: %s' % t)
            await go(1); await page.keyboard.press('Meta+v'); await page.wait_for_timeout(500)
            check(await cnt()==1, 'Cmd+V incolla la foto nella tavola 2')
            badge = await page.evaluate("() => [...document.querySelectorAll('.tile .badge')].map(e=>e.textContent)")
            check('2' in badge, 'la foto copiata risulta usata 2 volte (badge %s)' % badge)
            await go(0); check(await cnt()==3, 'la tavola 1 resta intatta dopo la copia')

            # 2) Cmd+A + copia, incolla in tavola vuota con la stessa impaginazione
            await page.keyboard.press('Meta+a'); await page.wait_for_timeout(200)
            check(await nsel()==3, 'Cmd+A seleziona tutte le foto della tavola')
            check('3 foto selezionate' in (await page.locator('.floatbar').text_content()), 'barra: 3 foto selezionate con Copia/Taglia')
            await page.screenshot(path=OUT+'/01-selezione-tutte.png')
            async def boxes():
                return await page.evaluate("() => { const s=document.querySelector('.stage .spread').getBoundingClientRect(); return [...document.querySelectorAll('.stage .spread > .ph')].map(e=>{const r=e.getBoundingClientRect(); return [Math.round(r.left-s.left),Math.round(r.top-s.top),Math.round(r.width),Math.round(r.height)];}).sort(); }")
            # rendo la tavola 1 "manuale" spostando un bordo, per verificare che lo schema venga copiato
            dv = page.locator('.stage .divider').first
            if await dv.count():
                bb = await dv.bounding_box()
                await page.mouse.move(bb['x']+bb['width']/2, bb['y']+bb['height']/2); await page.mouse.down()
                await page.mouse.move(bb['x']+bb['width']/2+60, bb['y']+bb['height']/2+40, steps=5); await page.mouse.up(); await page.wait_for_timeout(500)
            await page.keyboard.press('Meta+a'); await page.wait_for_timeout(150)
            b1 = await boxes()
            await page.keyboard.press('Meta+c'); await go(2); await page.keyboard.press('Meta+v'); await page.wait_for_timeout(700)
            b2 = await boxes()
            check(b1 == b2 and len(b2)==3, 'tavola vuota: incollata identica (posizioni %s)' % ('uguali' if b1==b2 else '%s vs %s' % (b1,b2)))
            t = await page.locator('.toast').text_content(); check('stessa impaginazione' in t, 'messaggio: %s' % t)

            # 3) taglia: sposta senza doppioni
            await phs.nth(0).click(); await page.keyboard.press('Meta+x'); await page.wait_for_timeout(400)
            check(await cnt()==2, 'Cmd+X toglie la foto dalla tavola 3')
            await go(3); await page.keyboard.press('Meta+v'); await page.wait_for_timeout(500)
            check(await cnt()==1, 'incollata nella tavola 4')
            await page.keyboard.press('Meta+z'); await page.wait_for_timeout(400)
            check(await cnt()==0, 'Cmd+Z annulla l’incolla')
            await page.keyboard.press('Meta+Shift+z'); await page.wait_for_timeout(400)
            # incolla in tavola gia' piena: si aggiunge
            await go(0); await page.keyboard.press('Meta+v'); await page.wait_for_timeout(500)
            check(await cnt()==4, 'incolla in una tavola piena: la foto si aggiunge (4)')

            # 4) selezione a rettangolo e Maiusc+clic
            await page.keyboard.press('Escape'); await page.wait_for_timeout(150)
            sp = await page.locator('.stage .spread').bounding_box()
            st = await page.locator('.stage').bounding_box()
            await page.mouse.move(st['x']+8, st['y']+8); await page.mouse.down()
            await page.mouse.move(sp['x']+sp['width']*0.35, sp['y']+sp['height']-5, steps=8)
            mq = await page.locator('.marquee').count()
            await page.screenshot(path=OUT+'/02-rettangolo.png')
            await page.mouse.up(); await page.wait_for_timeout(250)
            n1 = await nsel()
            check(mq==1 and 1 <= n1 < 4, 'trascinando un rettangolo si selezionano solo le foto toccate (%d)' % n1)
            # Maiusc+clic su una non selezionata
            idx = await page.evaluate("() => [...document.querySelectorAll('.stage .spread > .ph')].findIndex(e => !e.classList.contains('sel'))")
            await phs.nth(idx).click(modifiers=['Shift']); await page.wait_for_timeout(150)
            check(await nsel()==n1+1, 'Maiusc+clic aggiunge una foto alla selezione')
            # Canc elimina le selezionate
            before = await cnt(); await page.keyboard.press('Backspace'); await page.wait_for_timeout(400)
            check(await cnt()==before-(n1+1), 'Canc toglie tutte le foto selezionate')
            await page.keyboard.press('Meta+z'); await page.wait_for_timeout(400)
            check(await cnt()==before, 'Cmd+Z le rimette')
            # pulsante Incolla nella barra quando nulla e' selezionato
            await page.keyboard.press('Escape'); await page.wait_for_timeout(200)
            check(await page.locator('.floatbar >> text=Incolla').count()==1, 'con qualcosa negli appunti compare il pulsante Incolla')

            # 5) duplica progetto
            await page.wait_for_timeout(900)
            await page.click('text=‹ Progetti'); await page.wait_for_selector('.list-screen')
            prompts.append('Matrimonio Test - album genitori')
            await page.click('.trow:has-text("Matrimonio Test") .dup'); await page.wait_for_timeout(1200)
            rows = await page.evaluate("() => [...document.querySelectorAll('.trow:not(.thead) strong')].map(e=>e.textContent)")
            check('Matrimonio Test - album genitori' in rows and 'Matrimonio Test' in rows, 'duplica progetto: nuova riga in elenco %s' % rows)
            ls = await page.evaluate("() => window.__ls(['Matrimonio Test'])")
            check('Matrimonio Test - album genitori.album' in ls and 'Matrimonio Test.album' in ls, 'file della copia nella stessa cartella %s' % ls)
            await page.screenshot(path=OUT+'/03-elenco-duplicato.png')
            # nome gia' esistente
            prompts.append('Matrimonio Test - album genitori')
            first = page.locator('.trow:not(.thead)').filter(has_text='Matrimonio Test').first
            await first.locator('.dup').click(); await page.wait_for_timeout(600)
            nt = await page.locator('.notice').text_content()
            check('già un progetto' in nt, 'nome già usato: avviso, nessuna sovrascrittura')
            # apro la copia: stesse tavole, foto raggiungibili
            await page.click('.trow >> text=Matrimonio Test - album genitori'); await page.wait_for_selector('.editor')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=30000)
            check(await page.locator('.srcbar').count()==0, 'la copia ritrova le cartelle delle foto senza chiedere')
            check(await cnt()==4, 'la copia ha le stesse tavole (tavola 1 con 4 foto)')
            title = await page.locator('.topbar strong').first.text_content(); check(title=='Matrimonio Test - album genitori', 'nome della copia nel titolo')
            # modifica la copia: l'originale non cambia
            await phs.nth(0).click(); await page.keyboard.press('Backspace'); await page.wait_for_timeout(1200)
            await page.click('text=‹ Progetti'); await page.wait_for_selector('.list-screen')
            await page.locator('.trow:not(.thead)').filter(has_text='Matrimonio Test').filter(has_not_text='genitori').first.click(); await page.wait_for_selector('.editor'); await page.wait_for_timeout(500)
            check(await cnt()==4 and (await page.locator('.topbar strong').first.text_content())=='Matrimonio Test', 'l’originale non cambia quando modifichi la copia')
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
