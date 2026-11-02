# v0.7.3: ridimensiona progetto (nuovo formato, mantieni o rimpagina)
import asyncio, os, subprocess, time, base64, json
from playwright.async_api import async_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e18'); os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))[:8]
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
GEOM = """() => { const sp=document.querySelector('.stage .spread').getBoundingClientRect();
  const r=[...document.querySelectorAll('.stage .spread > .ph')].map(e=>{const b=e.getBoundingClientRect(); return [b.x-sp.x,b.y-sp.y,b.width,b.height];});
  return { W: sp.width, H: sp.height, r: r }; }"""
def overl(a, b):
    return max(0, min(a[0]+a[2], b[0]+b[2]) - max(a[0], b[0])) * max(0, min(a[1]+a[3], b[1]+b[3]) - max(a[1], b[1]))
def sane(g):
    inside = all(x >= -1 and y >= -1 and x+w <= g['W']+1 and y+h <= g['H']+1 for x, y, w, h in g['r'])
    ov = max([overl(a, b) for i, a in enumerate(g['r']) for b in g['r'][i+1:]] or [0])
    return inside and ov < 2
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8788'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    async def album():
        await page.wait_for_timeout(1300)
        return json.loads(base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Matrimonio Test.album'])")))
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
            await page.goto('http://localhost:8788/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            # tavola 1: 5 foto + un divisore spostato a mano (albero personalizzato) + testo
            for i in range(5): await page.locator('.tile').nth(i).dblclick(); await page.wait_for_timeout(500)
            dv = page.locator('.stage .divider').first
            if await dv.count():
                bb = await dv.bounding_box()
                await page.mouse.move(bb['x']+bb['width']/2, bb['y']+bb['height']/2); await page.mouse.down()
                await page.mouse.move(bb['x']+bb['width']/2+40, bb['y']+bb['height']/2+20, steps=5); await page.mouse.up(); await page.wait_for_timeout(400)
            sp = await page.locator('.stage .spread').bounding_box()
            await page.keyboard.press('t'); await page.mouse.click(sp['x']+sp['width']*0.6, sp['y']+sp['height']*0.5); await page.wait_for_timeout(200)
            await page.keyboard.type('Titolo'); await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
            a0 = await album()
            g0 = await page.evaluate(GEOM)
            print('   prima: size', a0['size'], 'tree' in a0['spreads'][0], a0['spreads'][0]['texts'][0])
            await page.screenshot(path=OUT+'/01-prima.png')

            # 1) dialogo dal formato nel titolo
            await page.click('.fmtbtn'); await page.wait_for_selector('.modal.resize')
            check(await page.locator('.modal.resize .rzbox').count()==2, 'il dialogo mostra vecchio e nuovo formato')
            await page.fill('input[aria-label="Nuova larghezza"]', '30'); await page.fill('input[aria-label="Nuova altezza"]', '20')
            await page.wait_for_timeout(200)
            check(await page.locator('.modal.resize .notice').count()==1, 'avvisa che le proporzioni cambiano')
            await page.screenshot(path=OUT+'/02-dialogo.png')
            await page.click('.modal.resize .modal-foot >> text=Ridimensiona'); await page.wait_for_timeout(900)
            a1 = await album()
            check(a1['size']=={'w':60,'h':20} and a1['inputW']==30 and a1['inputH']==20, 'nuovo formato salvato (60 × 20 cm di tavola)')
            check(len(a1['spreads'])==len(a0['spreads']) and len(a1['spreads'][0]['items'])==5, 'stesse tavole e stesse foto')
            check(('tree' in a1['spreads'][0]) == ('tree' in a0['spreads'][0]), '"Mantieni impaginazione": la disposizione personalizzata resta')
            t0 = a0['spreads'][0]['texts'][0]; t1 = a1['spreads'][0]['texts'][0]
            check(abs(t1['x']/60 - t0['x']/81) < 0.01 and abs(t1['y']/20 - t0['y']/30.5) < 0.01, 'il testo resta nello stesso punto della tavola')
            check(t1['size'] < t0['size'], 'il corpo del testo scala con il formato (%s -> %s pt)' % (t0['size'], t1['size']))
            check(a1['spreads'][0]['s']['margin']==a0['spreads'][0]['s']['margin'], 'margini in cm invariati (opzione non scelta)')
            g1 = await page.evaluate(GEOM)
            check(abs(g1['W']/g1['H'] - 3) < 0.02, 'a schermo la tavola ha le nuove proporzioni (%.2f)' % (g1['W']/g1['H']))
            check(len(g1['r'])==5 and sane(g1), 'foto tutte dentro la tavola e senza sovrapposizioni')
            check('30 × 20' in (await page.locator('.fmtbtn').text_content()), 'il titolo mostra il nuovo formato')
            await page.screenshot(path=OUT+'/03-30x20-mantieni.png')
            # 2) Cmd+Z torna al formato di prima
            await page.keyboard.press('Meta+z'); await page.wait_for_timeout(500)
            a2 = await album(); g2 = await page.evaluate(GEOM)
            check(a2['size']==a0['size'] and a2['spreads'][0]['texts'][0]['size']==t0['size'], 'Cmd+Z ripristina formato e testi')
            check(abs(g2['W']/g2['H'] - g0['W']/g0['H']) < 0.01, 'a schermo torna la tavola di prima')
            # 3) rimpagina tutto + scala margini, tavola doppia 40x30
            await page.click('.fmtbtn'); await page.wait_for_selector('.modal.resize')
            await page.click('.modal.resize >> text=Tavola doppia')
            await page.fill('input[aria-label="Nuova larghezza"]', '40'); await page.fill('input[aria-label="Nuova altezza"]', '30')
            await page.click('.modal.resize >> text=Rimpagina tutto'); await page.click('.modal.resize label.check >> text=Scala anche')
            await page.click('.modal.resize .modal-foot >> text=Ridimensiona'); await page.wait_for_timeout(900)
            a3 = await album(); g3 = await page.evaluate(GEOM)
            check(a3['measure']=='double' and a3['size']=={'w':40,'h':30}, 'tavola doppia 40 × 30')
            check('tree' not in a3['spreads'][0] and a3['spreads'][0].get('combo')==0 and a3['spreads'][0].get('eng')==3, '"Rimpagina tutto": tavola ricomposta in automatico')
            check(a3['spreads'][0]['s']['margin'] < a0['spreads'][0]['s']['margin'], 'margini scalati in proporzione (%s -> %s)' % (a0['spreads'][0]['s']['margin'], a3['spreads'][0]['s']['margin']))
            check(len(g3['r'])==5 and sane(g3), 'rimpaginata: foto dentro la tavola e senza sovrapposizioni')
            await page.screenshot(path=OUT+'/04-40x30-rimpagina.png')
            # 4) esportazione nel nuovo formato
            await page.click('.topbar >> text=Esporta'); await page.click('.seg.what >> text=Solo tavole (JPG)')
            await page.fill('.modal input[placeholder^="Tutte"]', '1')
            await page.click('.modal-foot >> text=Esporta'); await page.wait_for_selector('.okmsg', timeout=180000)
            from PIL import Image; import io
            im = Image.open(io.BytesIO(base64.b64decode(await page.evaluate("window.__readFile(['Matrimonio Test','Tavole stampa','tavola-01.jpg'])"))))
            check(im.size==(4724, 3543), 'JPG esportato nel nuovo formato (%d × %d px)' % im.size)
            await page.click('.modal-foot >> text=Chiudi')
            # 5) dall'elenco progetti: copia ridimensionata (l'ambiente di test può bloccarsi sull'elenco)
            await page.wait_for_timeout(900)
            await page.click('text=‹ Progetti'); await page.wait_for_selector('.list-screen')
            await page.click('.trow:has-text("Matrimonio Test") .rsz'); await page.wait_for_selector('.modal.resize')
            await page.fill('input[aria-label="Nuova larghezza"]', '30'); await page.fill('input[aria-label="Nuova altezza"]', '20')
            await page.click('.modal.resize .modal-foot >> text=Crea copia'); await page.wait_for_timeout(1500)
            ls = await page.evaluate("() => window.__ls(['Matrimonio Test'])")
            check('Matrimonio Test 30×20.album' in ls and 'Matrimonio Test.album' in ls, 'dall’elenco: copia ridimensionata accanto all’originale %s' % [x for x in ls if x.endswith('.album')])
            rows = await page.evaluate("() => [...document.querySelectorAll('.trow:not(.thead) strong')].map(e=>e.textContent)")
            check('Matrimonio Test 30×20' in rows, 'la copia compare nell’elenco')
            await page.screenshot(path=OUT+'/05-elenco.png')
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
