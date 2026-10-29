# v0.4.3: impaginazione veloce ordinata (doppio clic) + margine esterno in pagina intera
import asyncio, os, subprocess, time
from playwright.async_api import async_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e8'); os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
GEOM = """() => { const s=document.querySelector('.stage .spread').getBoundingClientRect();
  return { W: s.width, H: s.height, ph: [...document.querySelectorAll('.stage .spread > .ph')].map(e => { const r=e.getBoundingClientRect(), i=e.querySelector('img').getBoundingClientRect();
    return { x: r.left-s.left, y: r.top-s.top, w: r.width, h: r.height, iw: i.width, ih: i.height }; }) }; }"""
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8778'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':900}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))  # BEFOREUNLOAD
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            await page.goto('http://localhost:8778/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            orient = await page.evaluate("() => [...document.querySelectorAll('.tile img')].map(i => { const r=i.getBoundingClientRect(); return r.width >= r.height ? 'H' : 'V'; })")
            print('orientamenti:', ''.join(orient))
            def uncropped(g): return all(abs(q['iw']-q['w']) < 2.5 and abs(q['ih']-q['h']) < 2.5 for q in g['ph'])
            def crossing(g): return [q for q in g['ph'] if q['x'] < g['W']/2 - 2 and q['x']+q['w'] > g['W']/2 + 2]
            # sequenze miste aggiunte con doppio clic, una foto alla volta
            for n in range(1, 8):
                await page.locator('.tile').nth(n-1).dblclick(); await page.wait_for_timeout(700)
                g = await page.evaluate(GEOM)
                cr = crossing(g)
                check(len(g['ph'])==n and uncropped(g) and (n == 1 or not cr), '%d foto (%s): intere, %s' % (n, ''.join(orient[:n]), 'nessuna a cavallo della piega' if not cr else '%d a cavallo della piega' % len(cr)))
                await page.screenshot(path=OUT+'/%02d-foto.png' % n)
            # tavola personalizzata a mano (bordo trascinato) e poi doppio clic: si ricompone senza ritagli
            await page.locator('.strip-item').nth(1).click(); await page.wait_for_timeout(300)
            for i in (8, 9, 10): await page.locator('.tile').nth(i).dblclick(); await page.wait_for_timeout(400)
            dv = page.locator('.stage .divider').first
            bb = await dv.bounding_box()
            await page.mouse.move(bb['x']+bb['width']/2, bb['y']+bb['height']/2); await page.mouse.down()
            await page.mouse.move(bb['x']+bb['width']/2+80, bb['y']+bb['height']/2+50, steps=5); await page.mouse.up(); await page.wait_for_timeout(500)
            g = await page.evaluate(GEOM); check(not uncropped(g), 'dopo il bordo trascinato le foto sono ritagliate (situazione di partenza)')
            await page.locator('.tile').nth(11).dblclick(); await page.wait_for_timeout(700)
            g = await page.evaluate(GEOM)
            check(len(g['ph'])==4 and uncropped(g) and not crossing(g), 'doppio clic su tavola modificata a mano: ricomposta, 4 foto intere')
            await page.screenshot(path=OUT+'/10-ricomposta.png')
            await page.keyboard.press('Meta+z'); await page.wait_for_timeout(500)
            check(len((await page.evaluate(GEOM))['ph'])==3, 'Cmd+Z torna alla tavola modificata a mano')
            await page.keyboard.press('Meta+Shift+z'); await page.wait_for_timeout(500)

            # pagina intera con margine esterno
            await page.keyboard.press('w'); await page.wait_for_timeout(700)
            lbl = await page.locator('.tool.slider').nth(1).locator('span').first.text_content()
            check(lbl.strip()=='Margine esterno', 'in pagina intera il cursore diventa "Margine esterno"')
            g0 = await page.evaluate(GEOM)
            def bbox(g): return (min(q['x'] for q in g['ph']), min(q['y'] for q in g['ph']), max(q['x']+q['w'] for q in g['ph']), max(q['y']+q['h'] for q in g['ph']))
            b0 = bbox(g0); check(b0[0] < 1.5 and b0[1] < 1.5 and abs(b0[2]-g0['W']) < 1.5, 'pagina intera senza margine: le foto arrivano ai bordi')
            inp = page.locator('.tool.slider').nth(1).locator('input.val')
            await inp.fill('2'); await inp.press('Enter'); await page.wait_for_timeout(700)
            g1 = await page.evaluate(GEOM); b1 = bbox(g1)
            pxcm = g1['W'] / 81.0
            check(abs(b1[0]-2*pxcm) < 2 and abs(b1[1]-2*pxcm) < 2 and abs((g1['W']-b1[2])-2*pxcm) < 2 and abs((g1['H']-b1[3])-2*pxcm) < 2,
                  'margine esterno 2 cm su tutti i lati (%.1f %.1f %.1f %.1f px, atteso %.1f)' % (b1[0], b1[1], g1['W']-b1[2], g1['H']-b1[3], 2*pxcm))
            await page.screenshot(path=OUT+'/11-intera-margine.png')
            await page.evaluate("() => document.activeElement && document.activeElement.blur()")
            await page.keyboard.press('+'); await page.wait_for_timeout(500)
            v = await inp.input_value(); check(v=='2,5', 'il tasto + aumenta il margine esterno (%s)' % v)
            await page.keyboard.press('w'); await page.wait_for_timeout(600)
            v = await page.locator('.tool.slider').nth(1).locator('input.val').input_value()
            check(v=='1', 'tornando a "Formato" il margine resta quello di prima (%s)' % v)
            await page.keyboard.press('w'); await page.wait_for_timeout(600)
            v = await page.locator('.tool.slider').nth(1).locator('input.val').input_value()
            check(v=='2,5', 'e in pagina intera ritrova il suo margine esterno (%s)' % v)
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
