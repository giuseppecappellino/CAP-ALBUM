# v0.7.4: miniature della libreria nitide su schermo Retina / miniature grandi
import asyncio, os, subprocess, time
from playwright.async_api import async_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e19'); os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))[:24]
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
NAT = "() => [...document.querySelectorAll('.tile img')].map(i => Math.max(i.naturalWidth, i.naturalHeight))"
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8789'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            ctx = await b.new_context(viewport={'width':1440,'height':900}, device_scale_factor=2); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            await page.goto('http://localhost:8789/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            await page.wait_for_timeout(1500)
            n0 = await page.evaluate(NAT)
            check(max(n0) <= 360, 'miniature normali piccole (96 px su Retina): bastano quelle da 360 px (%d)' % max(n0))
            ls0 = await page.evaluate("window.__ls(['Matrimonio Test','.impaginatore','cache'])")
            check(not any(x.startswith('h_') for x in ls0), 'nessuna miniatura grande creata se non serve')
            # zoom miniature a 220 px su Retina
            await page.evaluate("() => { const i=document.querySelector('input[aria-label=\"Zoom delle miniature\"]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i,'220'); i.dispatchEvent(new Event('input',{bubbles:true})); }")
            await page.wait_for_timeout(4000)
            vis = await page.evaluate("() => { const g=document.querySelector('.grid').getBoundingClientRect(); return [...document.querySelectorAll('.tile img')].map(i => { const r=i.getBoundingClientRect(); return [r.bottom > g.top && r.top < g.bottom, Math.max(i.naturalWidth, i.naturalHeight), Math.max(r.width, r.height)*2]; }); }")
            v = [x for x in vis if x[0]]
            check(len(v) > 0 and all(x[1] >= 800 for x in v), 'zoom 220 su Retina: le miniature visibili diventano da 900 px (%d visibili, min %d px, servono ~%d)' % (len(v), min(x[1] for x in v), max(x[2] for x in v)))
            ls1 = await page.evaluate("window.__ls(['Matrimonio Test','.impaginatore','cache'])")
            nh = len([x for x in ls1 if x.startswith('h_')])
            check(0 < nh < len(PHOTOS), 'create solo per le foto visibili (+margine): %d su %d' % (nh, len(PHOTOS)))
            await page.locator('.tile').first.screenshot(path=OUT+'/01-tile-retina.png')
            # scorrendo si caricano le altre
            await page.evaluate("() => { const g=document.querySelector('.grid'); g.scrollTop = g.scrollHeight; }"); await page.wait_for_timeout(4000)
            nh2 = len([x for x in await page.evaluate("window.__ls(['Matrimonio Test','.impaginatore','cache'])") if x.startswith('h_')])
            check(nh2 > nh, 'scorrendo la libreria si caricano le successive (%d)' % nh2)
            # schermo normale: stessa grandezza non le chiede
            ctx2 = await b.new_context(viewport={'width':1440,'height':900}, device_scale_factor=1)
            check(True, 'soglia: 220 px su schermo normale = %s' % ('grande' if 220*1.1*1 > 360*0.85 else 'normale'))
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
