import asyncio, os, subprocess, time, json
from playwright.async_api import async_playwright
ROOT='/home/claude/impaginatore'
INIT=open(ROOT+'/test/e2e.py').read().split('INIT = """')[1].split('"""')[0]
SETUP = """
async ([folder, names]) => {
  const root = await navigator.storage.getDirectory();
  for await (const [n] of root.entries()) await root.removeEntry(n, {recursive:true});
  const svc = await root.getDirectoryHandle('Matrimonio Test', {create:true});
  const jpg = await svc.getDirectoryHandle('JPG', {create:true});
  for (const n of names) {
    const b = await (await fetch('/test/'+folder+'/'+n)).blob();
    const fh = await jpg.getFileHandle(n, {create:true}); const w = await fh.createWritable(); await w.write(b); await w.close();
  }
  return true;
}"""
async def run(folder):
    names=sorted(os.listdir(ROOT+'/test/'+folder))
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':1512,'height':820}); await ctx.add_init_script(INIT)
        page=await ctx.new_page(); errs=[]
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://localhost:8766/index.html')
        await page.evaluate(SETUP,[folder,names])
        await page.click('text=+ Nuovo progetto')
        await page.evaluate("window.__pickQueue.push(() => window.__svc())")
        await page.click('.np-main >> text=Scegli…'); await page.wait_for_timeout(200)
        await page.click('text=Crea progetto'); await page.wait_for_selector('.editor')
        await page.evaluate("window.__pickQueue.push(async () => (await window.__svc()).getDirectoryHandle('JPG'))")
        t=time.time(); await page.click('.photos-bar >> text=Importa foto')
        await page.wait_for_function("document.querySelectorAll('.tile').length === %d" % len(names), timeout=900000)
        ti=time.time()-t
        # tempo di risposta: aggiunta di 6 foto e cambio combinazione
        t=time.time()
        for i in range(6): await page.locator('.tile').nth(i*7).dblclick()
        await page.keyboard.press('ArrowDown'); await page.wait_for_timeout(50)
        tr=(time.time()-t)
        # riapertura (cache)
        await page.click('text=‹ Progetti'); await page.wait_for_timeout(500)
        t=time.time(); await page.click('.trow >> text=Matrimonio Test')
        await page.wait_for_function("document.querySelectorAll('.tile img').length === %d" % len(names), timeout=300000)
        to=time.time()-t
        # export 1 tavola
        await page.click('.topbar >> text=Esporta'); await page.fill('.modal input[placeholder^="Tutte"]','1')
        await page.click('.modal label.check >> nth=1')  # togli pdf
        t=time.time(); await page.click('.modal-foot >> text=Esporta'); await page.wait_for_selector('.okmsg', timeout=300000); te=time.time()-t
        print(f'{folder}: {len(names)} foto | import {ti:.1f}s ({ti/len(names)*1000:.0f} ms/foto) | 6 aggiunte+combinazione {tr:.2f}s | riapertura {to:.1f}s | export 1 tavola {te:.1f}s | errori {errs}')
        await b.close()
async def main():
    srv=subprocess.Popen(['python3','-m','http.server','8766'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
    try:
        await run('big'); await run('many')
    finally: srv.terminate()
asyncio.run(main())
