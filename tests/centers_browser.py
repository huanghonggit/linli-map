"""Check cross-city camera movement and persistence in an isolated browser profile."""
from pathlib import Path
import sys
from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5173/'


def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, geolocation={'longitude': 121.48, 'latitude': 31.22, 'accuracy': 5}, permissions=['geolocation'])
        requests = []
        def geocode(route):
            requests.append(route.request.url)
            features = [{'geometry': {'type':'Point','coordinates':[118.7968,32.0647]}, 'properties':{'name':'鼓楼公园','city':'南京市','district':'鼓楼区','osm_id':73,'osm_type':'W'}}]
            route.fulfill(json={'features':features},headers={'access-control-allow-origin':'*'})
        ctx.route('https://photon.komoot.io/api/**',geocode)
        page = ctx.new_page()
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(BASE,wait_until='domcontentloaded')
        def click(name): page.get_by_role('button', name=name, exact=True).click()
        def settings(): return page.evaluate("JSON.parse(localStorage.getItem('linli-map:v1'))")
        def on_map(lat,lon):
            # Verify actual displayed satellite tiles, in addition to the center label.
            page.wait_for_function('''([lat,lon])=>Array.from(document.querySelectorAll('.leaflet-tile')).some(t=>{
                const parts=new URL(t.src).pathname.match(/tile\\/(\\d+)\\/(\\d+)\\/(\\d+)$/);if(!parts)return false;
                const n=2**Number(parts[1]),x=Math.floor((lon+180)/360*n),y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n);
                return +parts[2]===y && +parts[3]===x;
            })''', arg=[lat,lon],timeout=15000)
        click('2D 平面')
        click('设置中心')
        field=page.get_by_label('输入城市、街道或地标')
        field.fill('天津市');field.press('Enter')
        page.get_by_role('button',name='天津 天津市区 · 天津站附近').click()
        page.get_by_label('这里也是我的家').check();click('设为地图中心')
        on_map(39.1357517,117.2036841)
        old_home=settings()['home']
        click('设置中心');click('上海');click('只保存中心点')
        expect(page.locator('.place-title')).to_have_text('我的家')
        click('切换到 上海');on_map(31.2319264,121.4715447)
        assert settings()['home']==old_home and len(settings()['centers'])==2
        page.reload(wait_until='domcontentloaded');expect(page.locator('.place-title')).to_have_text('上海')
        click('设置中心');click('切换到 天津');expect(page.locator('.place-title')).to_have_text('天津');click('设置中心')
        field.fill('南京 鼓楼公园');assert not requests;click('搜索')
        page.get_by_role('button',name='鼓楼公园 南京市 · 鼓楼区').click();click('设为地图中心')
        expect(page.locator('.place-title')).to_have_text('鼓楼公园');assert len(requests)==1
        click('设置中心');click('使用当前位置');expect(page.get_by_role('heading',name='确认地图中心')).to_be_visible(timeout=18000)
        page.locator('#place-name').fill('上海住处');click('设为地图中心');expect(page.locator('.place-title')).to_have_text('上海住处')
        s=settings();assert s['center']['lat']==31.22 and s['center']['lon']==121.48 and len(s['centers'])==4 and s['home']==old_home
        page.reload(wait_until='domcontentloaded');click('设置中心');expect(page.get_by_role('button',name='当前中心 上海住处')).to_be_disabled()
        click('切换到 天津');expect(page.locator('.place-title')).to_have_text('天津')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth') and not errors,errors
        browser.close()
        print('PASS: city input / quick add / save only / real camera tiles / cross-city switch / home preservation / reload / online selection / current-position center.')

if __name__=='__main__':run()
