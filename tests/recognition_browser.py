from pathlib import Path
from io import BytesIO
import sys,time
from PIL import Image
from playwright.sync_api import sync_playwright,expect
BASE=(sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5173').rstrip('/')

with sync_playwright() as p:
    b=p.chromium.launch(channel='chrome',headless=True,args=['--enable-unsafe-swiftshader'])
    ctx=b.new_context(**p.devices['iPhone 13']);ctx.add_init_script("Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},speak(u){window.lastUtterance=u.text}}});")
    page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text[:170]) if 'Shader Error' in m.text else None)
    def click(name):page.get_by_role('button',name=name,exact=True).click()
    def dialog():return page.get_by_role('dialog')
    page.goto(BASE+'/?map=ruiheyuan&radius=5&look=shop',wait_until='domcontentloaded');expect(dialog().get_by_role('heading',name='认店铺')).to_be_visible(timeout=15000)
    dialog().get_by_role('button',name='吉祥里生鲜超市',exact=False).first.click();expect(dialog().get_by_text('周建路166号',exact=True)).to_be_visible();click('读给我听');assert '黑底牌' in page.evaluate('lastUtterance')
    photo=dialog().get_by_role('button',name='放大实拍照片');photo.wait_for();page.wait_for_function('document.querySelector(".recognition-picture img")?.naturalWidth>0',timeout=18000);photo.click();click('放大照片');assert dialog().locator('.recognition-photo-window').evaluate('e=>e.scrollWidth>e.clientWidth');click('返回上一步');click('地图近看')
    expect(page.locator('.globe-engine')).to_have_attribute('data-close-view','satellite',timeout=30000)
    page.wait_for_function('Number(document.querySelector(".globe-engine").dataset.imageryLevel)>=18',timeout=40000);print('Storefront photo, location, speech, zoom and live satellite close-up:',page.locator('.globe-engine').get_attribute('data-imagery-level'),flush=True)
    click('向左环看45度');click('向右环看45度');click('认路口');dialog().get_by_role('button',name='周东南路与瑞和路',exact=False).first.click();expect(dialog().get_by_role('img',name='周东南路与瑞和路，按实际道路方向绘制，北朝上')).to_be_visible();click('放大实拍照片');assert dialog().locator('.recognition-photo-window img').evaluate('e=>e.naturalWidth')==2048;click('返回上一步');click('看360°街景');expect(dialog().get_by_role('link',name='打开这个路口的百度地图')).to_have_attribute('href','https://map.baidu.com/mobile/webapp/place/detail/qt=ninf&uid=f986becec3a6f9f6ae31e5bd');expect(dialog().get_by_text('百度参考画面摄于',exact=False)).to_be_visible()
    # A synthetic 2:1 image validates rendering and persistence in this isolated test browser only.
    fixture=BytesIO();Image.new('RGB',(1024,512),'#808d99').save(fixture,'JPEG');dialog().locator('.own-pano summary').click();dialog().locator('.own-pano input').set_input_files({'name':'sphere-test.jpg','mimeType':'image/jpeg','buffer':fixture.getvalue()});expect(dialog().locator('.own-sphere canvas')).to_be_visible(timeout=12000);click('全景向左转');click('放大全景');click('关闭窗口');click('认路口');dialog().get_by_role('button',name='周东南路与瑞和路',exact=False).first.click();click('看360°街景');expect(dialog().locator('.own-sphere canvas')).to_be_visible();click('关闭窗口');
    click('认路口');dialog().get_by_label('选路口或输入路名').fill('无此路口-000');expect(dialog().get_by_text('这个范围还没有收录',exact=False)).to_be_visible();click('关闭窗口');click('认店铺');dialog().get_by_label('选店铺或输入店名').fill('益丰');dialog().get_by_role('button',name='益丰大药房',exact=False).first.click();expect(dialog().get_by_text('瑞安路214号，安阁苑中区北门旁')).to_be_visible();
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth') and not errors,errors
    print('Mobile street evidence, point-specific panorama landing, local 360 drag/zoom persistence and search passed.',flush=True);b.close()
