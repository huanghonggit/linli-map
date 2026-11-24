from pathlib import Path
import sys
from playwright.sync_api import sync_playwright, expect

base = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173').rstrip('/')
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
    for native in (True, False):
        page = browser.new_page(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        if not native:
            page.add_init_script("Object.defineProperty(document,'fullscreenEnabled',{value:false})")
        page.goto(base+'/?map=ruiheyuan&radius=5', wait_until='domcontentloaded')
        get=lambda name: page.get_by_role('button',name=name,exact=True)
        get('全屏地图').click()
        page.wait_for_selector('.expanded-map')
        if native: assert page.evaluate('Boolean(document.fullscreenElement)')
        for w,h in [(390,844),(844,390)]:
            page.set_viewport_size({'width':w,'height':h})
            page.wait_for_function('''()=>{const r=document.querySelector('.expanded-map').getBoundingClientRect();return r.width===innerWidth && r.height===innerHeight && r.y===0 && r.x===0}''')
        page.set_viewport_size({'width':390,'height':844})
        get('看店面实拍').click()
        expect(page.locator('.globe-engine')).to_have_attribute('data-close-view','satellite',timeout=30000)
        names=[]
        for j in range(4):
            names.append(page.locator('.facade-caption strong').inner_text())
            pin=page.locator('.facade-pin')
            expect(pin).to_be_visible()
            pin.click()
            pgphoto=page.get_by_role('dialog').locator('.recognition-photo-window img')
            expect(pgphoto).to_be_visible(timeout=18000)
            page.wait_for_function('document.querySelector(".recognition-photo-window img")?.naturalWidth>=400',timeout=18000)
            get('放大照片').click();get('关闭窗口').click()
            get('下一家').click()
        assert len(set(names))==4
        get('收起门面实拍').click();get('认路口').click();get('关闭窗口').click();get('退出全屏').click()
        expect(page.locator('.expanded-map')).to_have_count(0)
        assert page.evaluate('!document.documentElement.style.overflow && !document.querySelector("main .sidebar").inert') and not errors,errors
        page.goto(base+'/?map=ruiheyuan&radius=5&full=1',wait_until='domcontentloaded');get('退出全屏').click()
        print('Mobile fullscreen, street imagery, 4 original storefront photos, exit and direct link OK; native =', native,flush=True)
        page.close()
    browser.close()
