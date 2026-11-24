"""Open the public preset like a phone user and switch actual local 3D datasets."""
from pathlib import Path
from urllib.request import urlopen
import json,sys
from playwright.sync_api import sync_playwright,expect
base=(sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5173').rstrip('/')
counts={r:len(json.load(urlopen(f'{base}/models/v1/ruiheyuan-{r}/manifest.json',timeout=15))['chunks']) for r in (5,8,10)}
with sync_playwright() as p:
    b=p.chromium.launch(channel='chrome',headless=True,args=['--enable-unsafe-swiftshader']);ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=1);pg=ctx.new_page();failures=[];network=[]
    pg.on('pageerror',lambda e:failures.append(str(e)));pg.on('response',lambda r:network.append(r.url));pg.on('console',lambda e:failures.append(e.text[:200]) if 'Shader Error' in e.text else None)
    # Local models must be genuinely usable with all third-party cartography disabled.
    ctx.route('https://server.arcgisonline.com/**',lambda r:r.abort())
    ctx.route('https://wayback.maptiles.arcgis.com/**',lambda r:r.abort())
    def verify(r):
        expect(pg.locator('.place-title')).to_have_text('瑞和苑');expect(pg.locator('.map-stage')).to_have_attribute('data-model',f'ruiheyuan-{r}',timeout=35000);expect(pg.locator('.map-stage')).to_have_attribute('data-mode','model');pg.wait_for_function('(n)=>Number(document.querySelector(".globe-engine").dataset.blocks)===n',arg=counts[r],timeout=60000)
        group=pg.get_by_role('group',name='瑞和苑建模范围');expect(group.get_by_role('button',name=f'{r} 公里',exact=True)).to_have_attribute('aria-pressed','true');assert f'radius={r}' in pg.url
        assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not failures,failures
    for r in (5,8,10):
        pg.goto(f'{base}/?map=ruiheyuan&radius={r}',wait_until='domcontentloaded');verify(r);print('Mobile direct link',r,'km:',counts[r],'mesh blocks OK',flush=True)
    expect(pg.locator('.globe-engine')).to_have_attribute('data-texture-resolution','full',timeout=40000)
    pg.locator('.map-card').screenshot(path='.test-output/ruiheyuan-10km.png');group=pg.get_by_role('group',name='瑞和苑建模范围')
    for r in (5,8,10,5):group.get_by_role('button',name=f'{r} 公里',exact=True).click();verify(r)
    pg.get_by_role('button',name='看清街区').click();pg.reload(wait_until='domcontentloaded');verify(5)
    assert not any(u.endswith('/cesium/Cesium.js') for u in network);print('In-page switching, reload and local 3D verified.',flush=True);b.close()
