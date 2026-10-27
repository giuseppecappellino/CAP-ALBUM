# v0.4.4: qualita' del provino PDF (Leggera / Media / Alta)
import asyncio, os, subprocess, time, base64, re, io
from playwright.async_api import async_playwright
from PIL import Image
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e9'); os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
def pdf_images(data):
    return [(int(w), int(h)) for w, h in re.findall(rb'/Width (\d+) /Height (\d+)', data)] or [(int(w), int(h)) for h, w in re.findall(rb'/Height (\d+) /Width (\d+)', data)]
def first_jpeg(data):
    a = data.find(b'\xff\xd8\xff'); b = data.find(b'\xff\xd9', a)
    return data[a:b+2]
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8779'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':900}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            await page.goto('http://localhost:8779/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            await page.locator('.tile').nth(0).dblclick(); await page.wait_for_timeout(300)
            await page.locator('.tile').nth(1).dblclick(); await page.wait_for_timeout(300)
            await page.locator('.strip-item').nth(1).click(); await page.locator('.tile').nth(2).dblclick(); await page.wait_for_timeout(500)
            res = {}
            for q in ('Leggera', 'Media', 'Alta'):
                await page.click('.topbar >> text=Esporta'); await page.wait_for_selector('.modal .proofq')
                await page.locator('.modal input[type=checkbox]').first.uncheck()   # solo PDF
                await page.click('.proofq >> text=%s' % q); await page.wait_for_timeout(150)
                if q == 'Media': await page.screenshot(path=OUT+'/01-dialogo.png')
                t0 = time.time()
                await page.click('.modal-foot >> text=Esporta'); await page.wait_for_selector('.okmsg', timeout=180000)
                dt = time.time() - t0
                files = await page.evaluate("window.__ls(['Matrimonio Test'])")
                pdf = [f for f in files if f.endswith('.pdf')][0]
                data = base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test', %r])" % pdf))
                open(OUT+'/provino-%s.pdf' % q.lower(), 'wb').write(data)
                imgs = pdf_images(data)
                jp = first_jpeg(data); Image.open(io.BytesIO(jp)).save(OUT+'/tavola1-%s.png' % q.lower())
                res[q] = (len(data), imgs[0] if imgs else None, dt, len(imgs))
                print('  %s: %.0f KB, pagina %s, %d pagine, %.1f s' % (q, len(data)/1024, imgs[0] if imgs else '?', len(imgs), dt))
                await page.click('.modal-foot >> text=Chiudi'); await page.wait_for_timeout(300)
            check(res['Leggera'][1][0] < res['Media'][1][0] < res['Alta'][1][0], 'risoluzione crescente: %s < %s < %s' % (res['Leggera'][1], res['Media'][1], res['Alta'][1]))
            check(res['Media'][1][0] >= 3500, 'Media: tavola larga almeno 3500 px (%d)' % res['Media'][1][0])
            check(res['Leggera'][0] < res['Media'][0] < res['Alta'][0], 'peso crescente')
            await page.click('.topbar >> text=Esporta'); await page.wait_for_selector('.modal .proofq')
            on = await page.locator('.proofq .seg button.on').text_content()
            check(on == 'Alta', 'la qualità scelta viene ricordata (%s)' % on)
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
