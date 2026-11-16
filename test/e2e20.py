# v0.8.0: trascinamento con pausa (niente scambi immediati) + nuove combinazioni per tante foto
import asyncio, os, subprocess, time, base64, json
from playwright.async_api import async_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e20'); os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))[:14]
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0] + """
window.__dragStart = (sel, i) => { const t = document.querySelectorAll(sel)[i]; window.__dt = new DataTransfer(); t.dispatchEvent(new DragEvent('dragstart', {bubbles:true, dataTransfer: window.__dt})); };
window.__over = (x, y) => { const el = document.elementFromPoint(x, y) || document.querySelector('.stage .spread'); el.dispatchEvent(new DragEvent('dragover', {bubbles:true, cancelable:true, dataTransfer: window.__dt, clientX:x, clientY:y})); };
window.__drop = (x, y) => { const el = document.elementFromPoint(x, y) || document.querySelector('.stage .spread'); el.dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer: window.__dt, clientX:x, clientY:y})); };
window.__end = (sel, i) => { const t = document.querySelectorAll(sel)[i]; if (t) t.dispatchEvent(new DragEvent('dragend', {bubbles:true})); };
"""
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
RECTS = "() => [...document.querySelectorAll('.stage .spread > .ph')].map(e => { const b = e.getBoundingClientRect(); const im = e.querySelector('img'); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height), im ? im.naturalWidth + 'x' + im.naturalHeight + im.src.slice(-12) : '']; })"
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8790'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':900}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            await page.goto('http://localhost:8790/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            for i in range(5): await page.locator('.tile').nth(i).dblclick(); await page.wait_for_timeout(450)
            await page.wait_for_timeout(600)
            r0 = await page.evaluate(RECTS)
            async def album():
                await page.wait_for_timeout(1300)
                return json.loads(base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Matrimonio Test.album'])")))
            order0 = [it['id'] for it in (await album())['spreads'][0]['items']]

            # 1) trascino la foto 0 passando sopra le altre SENZA fermarmi: nessuna foto si sposta
            await page.evaluate("window.__dragStart('.stage .spread > .ph', 0)")
            moved = False
            for step in range(30):
                tgt = r0[1 + step % 4]
                x = tgt[0] + tgt[2]*0.5 + (step % 5)*9 - 18; y = tgt[1] + tgt[3]*0.5 + (step % 3)*9 - 9
                await page.evaluate("([x,y]) => window.__over(x,y)", [x, y]); await page.wait_for_timeout(70)
                if await page.evaluate(RECTS) != r0: moved = True
            check(not moved, 'trascinando sopra le altre foto senza fermarsi (2 secondi) nessuna foto si sposta')
            check(await page.locator('.dropzone').count()==1, 'si vede evidenziata la foto di destinazione')
            # 2) al centro di una foto: "Scambia"; vicino al bordo alto: "Metti sopra"; sempre senza spostare nulla
            t2 = r0[2]
            await page.evaluate("([x,y]) => window.__over(x,y)", [t2[0]+t2[2]*0.5, t2[1]+t2[3]*0.5]); await page.wait_for_timeout(120)
            txt = await page.locator('.dropzone .drophint').text_content()
            check(await page.locator('.dropzone.center').count()==1 and 'Scambia' in txt, 'centro della foto: evidenziata con "Scambia"')
            await page.screenshot(path=OUT+'/01-evidenzia-scambia.png')
            await page.evaluate("([x,y]) => window.__over(x,y)", [t2[0]+t2[2]*0.5, t2[1]+t2[3]*0.04]); await page.wait_for_timeout(120)
            txt = await page.locator('.dropzone .drophint').text_content()
            check(await page.locator('.dropzone.edge.top').count()==1 and 'sopra' in txt, 'bordo alto: barra e "Metti sopra"')
            check(await page.evaluate(RECTS) == r0, 'e la disposizione è ancora quella di partenza')
            await page.screenshot(path=OUT+'/02-evidenzia-sopra.png')
            # 3) resto fermo ~1 secondo: compare l'anteprima
            cx, cy = t2[0]+t2[2]*0.5, t2[1]+t2[3]*0.5
            await page.evaluate("([x,y]) => window.__over(x,y)", [cx, cy])
            for _ in range(5): await page.wait_for_timeout(100); await page.evaluate("([x,y]) => window.__over(x,y)", [cx+1, cy])
            check(await page.evaluate(RECTS) == r0, 'dopo mezzo secondo fermo: ancora nessuno spostamento')
            for _ in range(9): await page.wait_for_timeout(100); await page.evaluate("([x,y]) => window.__over(x,y)", [cx+1, cy])
            await page.wait_for_timeout(900)
            r1 = await page.evaluate(RECTS)
            check(r1 != r0 and await page.locator('.dropzone').count()==0, 'dopo circa un secondo fermo compare l’anteprima dello scambio')
            await page.screenshot(path=OUT+'/03-anteprima.png')
            # 4) piccoli movimenti: l'anteprima resta; mi allontano: torna tutto com'era
            for d in (6, 14, 22): await page.evaluate("([x,y]) => window.__over(x,y)", [cx+d, cy+d/2]); await page.wait_for_timeout(120)
            await page.wait_for_timeout(800)
            check(await page.evaluate(RECTS) == r1, 'muovendo poco il cursore l’anteprima resta ferma (niente rimbalzi)')
            t4 = r0[4]
            await page.evaluate("([x,y]) => window.__over(x,y)", [t4[0]+t4[2]*0.5, t4[1]+t4[3]*0.5]); await page.wait_for_timeout(100)
            await page.evaluate("([x,y]) => window.__over(x,y)", [t4[0]+t4[2]*0.5+12, t4[1]+t4[3]*0.5]); await page.wait_for_timeout(700)
            check(await page.evaluate(RECTS) == r0, 'allontanandosi le foto tornano al loro posto')
            # 5) rilascio subito (senza pausa) sul centro: scambio 0 <-> 4
            await page.evaluate("([x,y]) => window.__drop(x,y)", [t4[0]+t4[2]*0.5, t4[1]+t4[3]*0.5]); await page.evaluate("window.__end('.stage .spread > .ph', 0)")
            a1 = await album(); order1 = [it['id'] for it in a1['spreads'][0]['items']]
            exp = order0[:]; exp[0], exp[4] = exp[4], exp[0]
            check(order1 == exp, 'rilasciando subito sul centro le due foto si scambiano')
            check(await page.locator('.dropzone').count()==0, 'a fine trascinamento l’evidenziazione sparisce')
            # 6) rilascio sul bordo: la foto si inserisce accanto
            await page.wait_for_timeout(500); rA = await page.evaluate(RECTS)
            await page.evaluate("window.__dragStart('.stage .spread > .ph', 0)")
            tt = rA[3]
            for _ in range(3): await page.evaluate("([x,y]) => window.__over(x,y)", [tt[0]+tt[2]*0.96, tt[1]+tt[3]*0.5]); await page.wait_for_timeout(80)
            check(await page.locator('.dropzone.edge.right').count()==1, 'bordo destro evidenziato')
            await page.evaluate("([x,y]) => window.__drop(x,y)", [tt[0]+tt[2]*0.96, tt[1]+tt[3]*0.5]); await page.evaluate("window.__end('.stage .spread > .ph', 0)")
            a2 = await album()
            check(a2['spreads'][0].get('tree') is not None and len(a2['spreads'][0]['items'])==5, 'rilascio sul bordo: la foto viene messa accanto (disposizione personalizzata)')

            # 7) nuove combinazioni con tante foto
            await page.keyboard.press('n'); await page.wait_for_timeout(300)
            await page.click('.chips >> text=Non usate') if await page.locator('.chips >> text=Non usate').count() else None
            for i in range(9): await page.locator('.tile:not(.used)').first.dblclick(); await page.wait_for_timeout(450)
            await page.wait_for_timeout(500)
            n_ph = await page.locator('.stage .spread > .ph').count(); check(n_ph==9, 'tavola con 9 foto (%d)' % n_ph)
            a3 = await album(); check(a3['spreads'][1].get('eng')==4, 'le tavole nuove usano il nuovo motore')
            await page.click('button[aria-label="Tutte le combinazioni"]'); await page.wait_for_selector('.modal.combos')
            nc = await page.locator('.combo-grid > *').count(); head = await page.locator('.modal.combos .modal-head').text_content(); check('120' in head or '1' in head.split('alternative')[0][-4:], 'combinazioni disponibili per 9 foto: %s' % head)
            await page.screenshot(path=OUT+'/04-combinazioni-9.png')
            info = await page.evaluate("""() => { const L = window.Layout; const ars=[1.5,1.5,0.667,1.5,1.5,0.667,1.5,1.5,1.5,0.667];
              const r = L.combos({ars, width:79, height:28.5, gap:0.5, mode:'fit', align:'center', fold:39.5, foldGap:2});
              const st = {}; r.slice(0,24).forEach(x => st[x.st]=(st[x.st]||0)+1);
              const crop = r.every(x => x.rects.every(q => Math.abs(q.w/q.h - ars[q.i]) < 0.01));
              const inside = r.every(x => x.rects.every(q => q.x>-0.01 && q.y>-0.01 && q.x+q.w<79.01 && q.y+q.h<28.51));
              return { n: r.length, st, crop, inside }; }""")
            print('   stili nelle prime 24:', info['st'])
            check(info['crop'], '10 foto: in tutte le combinazioni le foto restano nel loro formato (mai ritagliate)')
            check(info['inside'], 'e stanno tutte dentro la tavola')
            check(len(info['st']) >= 3, 'le prime 24 combinazioni alternano almeno 3 stili diversi')
            await page.click('.modal.combos >> text=Chiudi')
            # 8) tavola impaginata con una versione precedente: aprendo le combinazioni passa al nuovo motore senza cambiare aspetto
            for combo in (0, 3, 7):
                await page.evaluate("(c) => { const s = window.__capSession; const sp = s.project.spreads[1]; sp.eng = 3; sp.combo = c; sp.tree = null; s.changed(); }", combo); await page.wait_for_timeout(900)
                rb = await page.evaluate(RECTS)
                await page.click('button[aria-label="Tutte le combinazioni"]'); await page.wait_for_selector('.modal.combos'); await page.click('.modal.combos >> text=Chiudi'); await page.wait_for_timeout(900)
                ra = await page.evaluate(RECTS)
                st = await page.evaluate("() => { const sp = window.__capSession.project.spreads[1]; return [sp.eng, sp.combo, !!sp.tree]; }")
                check(st[0]==4 and ra == rb, 'tavola vecchia (combinazione %d): passa al nuovo motore con lo stesso aspetto %s' % (combo+1, '(n. %d del nuovo elenco)' % (st[1]+1) if not st[2] else '(tenuta come disposizione fissa)'))
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
