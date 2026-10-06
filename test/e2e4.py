import asyncio, os, subprocess, time
from playwright.async_api import async_playwright
ROOT='/home/claude/impaginatore'
OUT='/tmp/claude-0/-home-claude-cap-album/e7f6ba56-cd65-51c6-b869-07f8a3266013/scratchpad/e2e4'
os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0] + """
window.__picks = [];
const __orig = window.__TEST_PICK_DIR;
window.__TEST_PICK_DIR = async (opts) => { window.__picks.push(opts || {}); return __orig(opts); };
"""
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8772'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':860}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            await page.goto('http://localhost:8772/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa foto')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            r = await page.evaluate("""async () => { const o = window.__picks[window.__picks.length-1]; const svc = await window.__svc(); return { hasStart: !!o.startIn, same: o.startIn ? await o.startIn.isSameEntry(svc) : false, id: o.id || null }; }""")
            check(r['hasStart'] and r['same'] and r['id'] is None, 'importazione: la finestra parte dalla cartella del progetto %s' % r)
            # zoom libreria
            async def tile(): return await page.evaluate("() => { const t=document.querySelector('.tile').getBoundingClientRect(); const i=document.querySelector('.tile img').getBoundingClientRect(); const cols=getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length; return {w:t.width,h:t.height,iw:i.width,ih:i.height,cols}; }")
            t0 = await tile()
            await page.screenshot(path=OUT+'/01-zoom-base.png')
            await page.locator('input[aria-label="Zoom delle miniature"]').fill('260'); await page.wait_for_timeout(400)
            t1 = await tile()
            check(t1['w']>=260 and t1['iw']>t0['iw']*2 and t1['cols']<t0['cols'], 'zoom: miniature da %.0f a %.0f px, colonne da %d a %d' % (t0['iw'], t1['iw'], t0['cols'], t1['cols']))
            check(t1['iw'] <= t1['w'] and t1['ih'] <= t1['h'], 'la foto resta dentro il riquadro')
            await page.screenshot(path=OUT+'/02-zoom-grande.png')
            await page.locator('input[aria-label="Zoom delle miniature"]').fill('70'); await page.wait_for_timeout(300)
            t2 = await tile(); check(t2['cols']>t0['cols'], 'zoom minimo: piu foto visibili (%d colonne)' % t2['cols'])
            await page.locator('input[aria-label="Zoom delle miniature"]').fill('180'); await page.wait_for_timeout(200)
            # trascinamento ancora funzionante con miniature grandi
            await page.locator('.tile').nth(0).dblclick(); await page.wait_for_timeout(500)
            check(await page.locator('.stage .spread > .ph').count()==1, 'doppio clic aggiunge ancora la foto alla tavola')
            await page.wait_for_timeout(900); await page.reload(); await page.wait_for_timeout(700)
            await page.click('.trow >> text=Matrimonio Test'); await page.wait_for_selector('.editor'); await page.wait_for_timeout(600)
            v = await page.locator('input[aria-label="Zoom delle miniature"]').input_value(); check(v=='180', 'lo zoom scelto viene ricordato (%s)' % v)
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
