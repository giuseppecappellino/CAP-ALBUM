import asyncio, os, subprocess, time
from playwright.async_api import async_playwright
ROOT='/home/claude/impaginatore'
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e5')
os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8773'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1720,'height':900}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))  # BEFOREUNLOAD
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            await page.goto('http://localhost:8773/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('label.check:has-text("Margini di sicurezza") input')
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)

            # --- margini di sicurezza: un solo contorno sulla tavola intera
            g = await page.evaluate("""() => { const s=document.querySelector('.stage .spread').getBoundingClientRect(); const gs=[...document.querySelectorAll('.stage .spread .guide')].map(e=>e.getBoundingClientRect()); return {n:gs.length, sw:s.width, gw: gs[0]&&gs[0].width, gl: gs[0] && gs[0].left - s.left}; }""")
            check(g['n']==1 and g['gw'] > g['sw']*0.9, 'margini di sicurezza: un solo contorno esterno sulla tavola (%s)' % g)
            await page.screenshot(path=OUT+'/01-guide.png')

            # --- riordino tavole
            await page.locator('.tile').nth(0).dblclick(); await page.wait_for_timeout(400)
            await page.click('.addbtn'); await page.click('.addbtn'); await page.click('.addbtn'); await page.wait_for_timeout(300)
            n = await page.locator('.strip-item').count()
            # attuale: ultima tavola; le foto stanno nella tavola 1
            async def withPhoto(): return await page.evaluate("() => [...document.querySelectorAll('.strip-item')].map(e => e.querySelectorAll('.ph').length)")
            before = await withPhoto()
            a = await page.locator('.strip-item').nth(0).bounding_box(); z = await page.locator('.strip-item').nth(3).bounding_box()
            await page.mouse.move(a['x']+a['width']/2, a['y']+a['height']/2); await page.mouse.down()
            for k in range(1, 12): await page.mouse.move(a['x']+a['width']/2 + (z['x']+z['width']*0.8-a['x'])*k/11, a['y']+a['height']/2); await page.wait_for_timeout(20)
            mark = await page.locator('.strip-item:nth-child(5).ins-before').count()
            await page.screenshot(path=OUT+'/02-trascina-tavola.png')
            await page.mouse.up(); await page.wait_for_timeout(400)
            after = await withPhoto()
            check(before[0]==1 and after[3]==1 and after[0]==0 and mark==1, 'tavola 1 trascinata in quarta posizione: %s -> %s' % (before, after))
            on = await page.evaluate("() => [...document.querySelectorAll('.strip-item')].findIndex(e => e.classList.contains('on'))")
            check(on == 3, 'la tavola spostata resta selezionata (%d)' % on)
            await page.keyboard.press('Meta+z'); await page.wait_for_timeout(300)
            check((await withPhoto())[0]==1, 'Cmd+Z annulla lo spostamento')
            await page.keyboard.press('Meta+Shift+z'); await page.wait_for_timeout(300)
            # clic semplice cambia ancora tavola
            await page.locator('.strip-item').nth(1).click(); await page.wait_for_timeout(200)
            on = await page.evaluate("() => [...document.querySelectorAll('.strip-item')].findIndex(e => e.classList.contains('on'))")
            check(on == 1, 'clic su una tavola la apre ancora')
            await page.locator('.strip-item').nth(3).click(); await page.wait_for_timeout(300)

            # --- pannello a destra
            await page.click('.dockbtn'); await page.wait_for_timeout(500)
            r = await page.evaluate("() => { const ph=document.querySelector('.photos').getBoundingClientRect(), st=document.querySelector('.stage').getBoundingClientRect(), sp=document.querySelector('.strip').getBoundingClientRect(); return {phL:ph.left, phT:ph.top, phH:ph.height, stR:st.right, spR:sp.right, H:innerHeight, cls:document.querySelector('.editor').className}; }")
            check('dock-right' in r['cls'] and r['phL'] >= r['stR']-1 and r['phH'] > r['H']*0.8 and r['spR'] <= r['phL']+1, 'pannello foto a destra, alto quanto la finestra %s' % r)
            await page.screenshot(path=OUT+'/03-pannello-destra.png')
            rz = await page.locator('.resizer').bounding_box()
            await page.mouse.move(rz['x']+4, rz['y']+200); await page.mouse.down(); await page.mouse.move(rz['x']-150, rz['y']+200, steps=6); await page.mouse.up(); await page.wait_for_timeout(300)
            w2 = await page.evaluate("() => document.querySelector('.photos').getBoundingClientRect().width")
            check(abs(w2 - (1720 - r['phL'] + 154)) < 6, 'il bordo sinistro del pannello si trascina (larghezza %.0f)' % w2)
            await page.locator('.tile').nth(1).dblclick(); await page.wait_for_timeout(400)
            check(await page.locator('.stage .spread > .ph').count()==2, 'con il pannello a destra il doppio clic aggiunge la foto')

            # --- ritaglio da un lato
            phs = page.locator('.stage .spread > .ph')
            b0 = await phs.nth(0).bounding_box()
            await phs.nth(0).dblclick(); await page.wait_for_selector('.crop-side.e')
            check(await page.locator('.crop-side').count()==4, 'nel ritaglio ci sono le 4 maniglie dei lati')
            e = await page.locator('.crop-side.e').bounding_box()
            await page.mouse.move(e['x']+e['width']/2, e['y']+e['height']/2); await page.mouse.down()
            await page.mouse.move(e['x']+e['width']/2 - b0['width']*0.4, e['y']+e['height']/2, steps=8)
            await page.screenshot(path=OUT+'/04-taglio-lato.png')
            await page.mouse.up(); await page.wait_for_timeout(900)
            await page.screenshot(path=OUT+'/05-dopo-taglio.png')
            await page.keyboard.press('Escape'); await page.wait_for_timeout(1800)
            b1 = await phs.nth(0).bounding_box()
            r0 = b0['width']/b0['height']; r1 = b1['width']/b1['height']
            check(abs(r1 - r0*0.6) < 0.06*r0, 'tagliato il lato destro del 40%%: forma %.2f -> %.2f (attesa %.2f), la tavola si ricompone' % (r0, r1, r0*0.6))
            await page.screenshot(path=OUT+'/06-ricomposta.png')
            # riapro: ripristina torna alla forma originale
            await phs.nth(0).dblclick(); await page.wait_for_selector('.floatbar >> text=Ripristina')
            await page.click('.floatbar >> text=Ripristina'); await page.click('.floatbar >> text=OK'); await page.wait_for_timeout(700)
            b2 = await phs.nth(0).bounding_box(); check(abs(b2['width']/b2['height'] - r0) < 0.03*r0, 'Ripristina riporta la forma originale')

            # --- ricordato dopo riapertura
            await page.wait_for_timeout(900); await page.reload(); await page.wait_for_timeout(700)
            await page.click('.trow >> text=Matrimonio Test'); await page.wait_for_selector('.editor'); await page.wait_for_timeout(600)
            check('dock-right' in await page.evaluate("() => document.querySelector('.editor').className"), 'la posizione del pannello viene ricordata')
            check((await withPhoto())[3] >= 1 and (await withPhoto())[0]==0, 'l\'ordine delle tavole resta salvato')
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
