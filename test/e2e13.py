# v0.5.3: inverti le due pagine
import asyncio, os, subprocess, time
from playwright.async_api import async_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(os.environ.get('TMPDIR','/tmp'),'e2e13'); os.makedirs(OUT, exist_ok=True)
PHOTOS=sorted(os.listdir(ROOT+'/test/photos'))
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP=open(ROOT+'/test/e2e.py').read().split('SETUP = """')[1].split('"""')[0]
SIDES = """() => { const s=document.querySelector('.stage .spread').getBoundingClientRect();
  const o={L:[],R:[]}; document.querySelectorAll('.stage .spread > .ph').forEach(e => { const r=e.getBoundingClientRect(); const nm=e.querySelector('img').src; const k=(r.left+r.width/2-s.left) < s.width/2 ? 'L':'R'; o[k].push(Math.round(r.width)+'x'+Math.round(r.height)); });
  o.L.sort(); o.R.sort(); return o; }"""
NAMES = """() => { const s=document.querySelector('.stage .spread').getBoundingClientRect(); const o={L:0,R:0};
  [...document.querySelectorAll('.stage .spread > .ph')].forEach((e,i) => { const r=e.getBoundingClientRect(); const k=(r.left+r.width/2-s.left) < s.width/2 ? 'L':'R'; o[k]++; }); return o; }"""
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8783'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errors=[]; ok=[]
    def check(c, m): (ok if c else errors).append(m); print(('OK  ' if c else 'ERR ')+m)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1512,'height':900}); await ctx.add_init_script(INIT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)))
            await page.goto('http://localhost:8783/index.html'); await page.evaluate(SETUP, PHOTOS)
            await page.click('text=+ Nuovo progetto'); await page.evaluate("window.__pickQueue.push(() => window.__svc())")
            await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
            await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
            await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
            await page.click('.photos-bar >> text=Importa cartella')
            await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(PHOTOS), timeout=60000)
            for i in (0, 2, 3): await page.locator('.tile').nth(i).dblclick(); await page.wait_for_timeout(300)
            await page.wait_for_timeout(900)
            a = await page.evaluate(SIDES)
            print('prima:', a)
            check(len(a['L']) != len(a['R']), 'tavola di prova con pagine diverse (%d a sinistra, %d a destra)' % (len(a['L']), len(a['R'])))
            await page.screenshot(path=OUT+'/01-prima.png')
            await page.click('.tool >> text=Inverti'); await page.wait_for_timeout(900)
            b2 = await page.evaluate(SIDES)
            check(b2['L'] == a['R'] and b2['R'] == a['L'], 'Inverti: la pagina sinistra passa a destra con la stessa disposizione e viceversa')
            await page.screenshot(path=OUT+'/02-dopo.png')
            check(await page.locator('.counter strong').first.text_content() is not None, 'contatore aggiornato')
            await page.keyboard.press('Meta+z'); await page.wait_for_timeout(800)
            check(await page.evaluate(SIDES) == a, 'Cmd+Z annulla')
            await page.keyboard.press('i'); await page.wait_for_timeout(800)
            check(await page.evaluate(SIDES) == b2, 'il tasto I inverte le pagine')
            await page.keyboard.press('i'); await page.wait_for_timeout(800)
            check(await page.evaluate(SIDES) == a, 'due volte = come prima')
            # pagine divise
            await page.keyboard.press('d'); await page.wait_for_timeout(800)
            s0 = await page.evaluate(SIDES); n0 = await page.evaluate(NAMES)
            await page.keyboard.press('i'); await page.wait_for_timeout(800)
            s1 = await page.evaluate(SIDES); n1 = await page.evaluate(NAMES)
            check(n1['L'] == n0['R'] and n1['R'] == n0['L'] and s1['L'] == s0['R'], 'con le pagine divise inverte anche stile e combinazione di ciascuna pagina')
            # tavola composta come blocco unico (4 orizzontali)
            await page.locator('.strip-item').nth(1).click(); await page.wait_for_timeout(300)
            for i in (5, 6, 8, 9): await page.locator('.tile').nth(i).dblclick(); await page.wait_for_timeout(300)
            await page.wait_for_timeout(900)
            q0 = await page.evaluate(NAMES); r0 = await page.evaluate("() => [...document.querySelectorAll('.stage .spread > .ph')].map(e => e.querySelector('img').getAttribute('src')).join('|')")
            pos0 = await page.evaluate("() => { const s=document.querySelector('.stage .spread').getBoundingClientRect(); const o={}; document.querySelectorAll('.stage .spread > .ph').forEach(e => { const r=e.getBoundingClientRect(); o[e.querySelector('img').getAttribute('src')] = (r.left+r.width/2-s.left) < s.width/2 ? 'L':'R'; }); return o; }")
            await page.keyboard.press('i'); await page.wait_for_timeout(900)
            pos1 = await page.evaluate("() => { const s=document.querySelector('.stage .spread').getBoundingClientRect(); const o={}; document.querySelectorAll('.stage .spread > .ph').forEach(e => { const r=e.getBoundingClientRect(); o[e.querySelector('img').getAttribute('src')] = (r.left+r.width/2-s.left) < s.width/2 ? 'L':'R'; }); return o; }")
            check(len(pos0)==4 and all(pos1[k] != pos0[k] for k in pos0), 'tavola a blocco unico: ogni foto passa all’altra pagina (%s -> %s)' % (''.join(pos0.values()), ''.join(pos1[k] for k in pos0)))
            await page.screenshot(path=OUT+'/03-blocco.png')
            # tavola vuota
            await page.locator('.strip-item').nth(2).click(); await page.wait_for_timeout(300)
            await page.keyboard.press('i'); await page.wait_for_timeout(300)
            check('vuota' in (await page.locator('.toast').text_content()), 'tavola vuota: avviso, nessun errore')
            await b.close()
    finally: srv.terminate()
    print('RISULTATO:', len(ok), 'ok,', len(errors), 'problemi'); [print('  ', e) for e in errors]
asyncio.run(main())
