import sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
base = (sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:4173').rstrip('/')
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
 for w,h in ((390,844),(1366,768),(1920,1080)):
  ctx=b.new_context(viewport={'width':w,'height':h},device_scale_factor=1,reduced_motion='reduce' if w==1366 else 'no-preference');pg=ctx.new_page();errors=[];resources=[]
  pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('response',lambda r:resources.append(r.url));get=lambda n:pg.get_by_role('button',name=n,exact=True)
  pg.goto(base+'/?map=ruiheyuan&radius=5&full=1&view=street',wait_until='domcontentloaded');engine=pg.locator('.globe-engine');expect(engine).to_have_attribute('data-close-view','satellite',timeout=30000)
  pg.wait_for_function('Number(document.querySelector(".globe-engine").dataset.imageryLevel)>=18',timeout=30000)
  expect(pg.locator('.ground-evidence')).to_be_visible();expect(pg.locator('.ground-evidence img')).to_be_visible();pg.screenshot(path=f'.test-output/aerial-{w}.png');
  for _ in range(12):
   if pg.locator('.scale').inner_text()=='5 米':break
   get('放大地图').click()
  expect(pg.locator('.scale')).to_have_text('5 米');pg.wait_for_function('Number(document.querySelector(".globe-engine").dataset.imageryLevel)===19',timeout=30000);pg.screenshot(path=f'.test-output/aerial-5m-{w}.png');get('打开附近实拍大图').click();expect(pg.get_by_role('dialog')).to_be_visible();img=pg.locator('.recognition-photo-window img');pg.wait_for_function('document.querySelector(".recognition-photo-window img")?.naturalWidth>0',timeout=18000);print(w,h,'aerial 19, image width',img.evaluate('e=>e.naturalWidth'),flush=True);get('关闭窗口').click();get('地图上看').click();get('向左环看45度').click();get('缩小地图').click();assert not errors,errors
  assert not any('ground-cover-' in u or '/assets/canopy-' in u for u in resources);ctx.close()
 b.close()
