# v0.5.0: trascinamento fluido (attesa, margine sulle soglie, rilascio = anteprima) + nuovi layout
import asyncio, os, subprocess, time
from playwright.async_api import async_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e11'); os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0] + """
window.__dt = null;
window.__dragStart = (sel, i) => { const t = document.querySelectorAll(sel)[i]; window.__dt = new DataTransfer(); t.dispatchEvent(new DragEvent('dragstart', {bubbles:true, dataTransfer: window.__dt})); };
window.__over = (x, y) => { const el = document.elementFromPoint(x, y) || document.querySelector('.stage .spread'); el.dispatchEvent(new DragEvent('dragover', {bubbles:true, cancelable:true, dataTransfer: window.__dt, clientX:x, clientY:y})); };
window.__drop = (x, y) => { const el = document.elementFromPoint(x, y) || document.querySelector('.stage .spread'); el.dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer: window.__dt, clientX:x, clientY:y})); };
window.__rects = () => { const s=document.querySelector('.stage .spread').getBoundingClientRect(); return [...document.querySelectorAll('.stage .spread > .ph')].map(e => { const r=e.getBoundingClientRect(); return [Math.round(r.left-s.left), Math.round(r.top-s.top), Math.round(r.width), Math.round(r.height)]; }).sort().join('|'); };
"""
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8781'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':900}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            await page.goto('http://localhost:8781/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            for i in (0, 2, 3): await page.locator('.tile').nth(i).dblclick(); await page.wait_for_timeout(300)
            await page.wait_for_timeout(700)
            phs = page.locator('.stage .spread > .ph')
            boxes = [await phs.nth(k).bounding_box() for k in range(3)]
            base = await page.evaluate("window.__rects()")

            # 1) passaggio veloce sopra le foto: l'anteprima non cambia a ogni passo
            await page.evaluate("""() => { window.__changes = 0; window.__last = window.__rects();
              window.__mo = new MutationObserver(() => { const r = window.__rects(); if (r !== window.__last) { window.__changes++; window.__last = r; } });
              window.__mo.observe(document.querySelector('.stage'), {subtree:true, childList:true, attributes:true, attributeFilter:['style']}); }""")
            await page.evaluate("window.__dragStart('.tile', 6)")
            pts = []
            for bb in boxes:
                for fx, fy in ((0.05, 0.5), (0.5, 0.5), (0.95, 0.5), (0.5, 0.05), (0.5, 0.95)):
                    pts.append((bb['x']+bb['width']*fx, bb['y']+bb['height']*fy))
            for (x, y) in pts:
                await page.evaluate("([x,y]) => window.__over(x,y)", [x, y]); await page.wait_for_timeout(40)
            fast_changes = await page.evaluate("window.__changes")
            check(fast_changes <= 1, 'passaggio veloce su 15 punti: anteprima cambiata %d volte (prima: a ogni punto)' % fast_changes)
            # 2) sosta: l'anteprima compare
            bb = boxes[1]
            for _ in range(5):
                await page.evaluate("([x,y]) => window.__over(x,y)", [bb['x']+bb['width']*0.5, bb['y']+bb['height']*0.5]); await page.wait_for_timeout(60)
            await page.wait_for_timeout(1000)
            check(await page.locator('.stage .spread.previewing').count()==1 and await page.locator('.stage .spread > .ph.incoming').count()>=1, 'fermandosi al centro di una foto l’anteprima compare dopo un attimo')
            prev_center = await page.evaluate("window.__rects()")
            hint = await page.locator('.drophint').text_content() if await page.locator('.drophint').count() else None
            check(hint and 'Sostituisci' in hint, 'al centro compare l’etichetta "Sostituisci" (%s)' % hint)
            await page.screenshot(path=OUT+'/00-sostituisci.png')
            # 3) margine sulla soglia: a 0,26 dal bordo resta "al centro"
            await page.evaluate("([x,y]) => window.__over(x,y)", [bb['x']+bb['width']*0.2, bb['y']+bb['height']*0.5]); await page.wait_for_timeout(1000)
            check(await page.evaluate("window.__rects()") == prev_center, 'a un quinto dal bordo resta "Sostituisci": zona centrale ampia')
            # 4) bordo netto: cambia, e il rilascio produce esattamente l'anteprima
            await page.evaluate("([x,y]) => window.__over(x,y)", [bb['x']+bb['width']*0.06, bb['y']+bb['height']*0.5]); await page.wait_for_timeout(1100)
            prev_edge = await page.evaluate("window.__rects()")
            check(prev_edge != prev_center, 'spostandosi sul bordo l’anteprima passa a "inserisci a lato"')
            hint = await page.locator('.drophint').text_content() if await page.locator('.drophint').count() else None
            check(hint and 'a sinistra' in hint, 'sul bordo l’etichetta dice "Metti a sinistra" (%s)' % hint)
            await page.screenshot(path=OUT+'/01-anteprima-bordo.png')
            await page.evaluate("([x,y]) => window.__drop(x,y)", [bb['x']+bb['width']*0.5, bb['y']+bb['height']*0.5])
            await page.wait_for_timeout(1100)
            check(await phs.count()==4, 'rilascio: 4 foto in tavola')
            check(await page.evaluate("window.__rects()") == prev_edge, 'il rilascio dà esattamente l’impaginazione vista in anteprima')
            await page.evaluate("window.__mo.disconnect()")
            # 5) animazione di scambio piu' lenta durante l'anteprima
            dur = await page.evaluate("() => { const s=document.querySelector('.stage .spread'); s.classList.add('previewing'); const d=getComputedStyle(s.querySelector('.ph')).transitionDuration; s.classList.remove('previewing'); return d; }")
            check('0.62s' in dur, 'durante l’anteprima le foto si spostano con un’animazione di 0,62 s (%s)' % dur)
            # 6) nuovi layout: piu' alternative con frecce
            cnt = await page.locator('.counter span').first.text_content()
            await page.keyboard.press('ArrowDown'); await page.wait_for_timeout(600)
            check(await phs.count()==4, 'frecce: alternative disponibili (%s)' % cnt.strip())
            await page.screenshot(path=OUT+'/02-alternativa.png')
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
