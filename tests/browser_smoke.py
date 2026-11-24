"""Exercise user journeys with deterministic GPS and routing, without sending private locations."""
import json
import math
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5173'
ROOT = Path(__file__).resolve().parents[1]

INSTRUMENT = """(() => {
 let watch, seq=0;window.events={spoken:[],tones:0,stops:0};window.geoDenied=false;
 const gps=(lat,lon,accuracy=5)=>({coords:{latitude:lat,longitude:lon,accuracy,heading:0,speed:1},timestamp:Date.now()+(++seq)*1000});
 window.emitFix=(lat,lon,accuracy)=>watch?.(gps(lat,lon,accuracy));
 Object.defineProperty(navigator,'geolocation',{value:{
  getCurrentPosition:(ok,fail)=>window.geoDenied?fail({code:1}):ok(gps(30.25186,120.1557)),
  watchPosition:ok=>{watch=ok;return 12;},clearWatch:()=>{watch=null;window.events.stops++;}
 }});
 Object.defineProperty(window,'speechSynthesis',{value:{speak:u=>events.spoken.push(u.text),cancel:()=>{}}});
 if(window.AudioContext){const original=AudioContext.prototype.createOscillator;AudioContext.prototype.createOscillator=function(){events.tones++;return original.call(this);};}
})()"""

def route_fixture(request):
    raw=request.request.url.split('/driving/')[1].split('?')[0]
    start,end=[[float(n) for n in pt.split(',')] for pt in raw.split(';')]
    mid=[start[0],end[1]]
    coords=[start,mid,end]
    instructions=[{'maneuver':{'type':kind,'modifier':mod,'location':p},'name':'测试道路'} for kind,mod,p in [('depart','straight',start),('turn','left',mid),('arrive','straight',end)]]
    request.fulfill(json={'code':'Ok','routes':[{'distance':1900,'duration':1500,'geometry':{'coordinates':coords},'legs':[{'steps':instructions}]}],'waypoints':[{'distance':2},{'distance':3}]},headers={'access-control-allow-origin':'*'})

def run():
    with sync_playwright() as tool:
        browser=tool.chromium.launch(channel='chrome',headless=True,args=['--enable-unsafe-swiftshader'])
        context=browser.new_context(viewport={'width':1280,'height':820})
        context.add_init_script(INSTRUMENT)
        context.route('https://routing.openstreetmap.de/**',route_fixture)
        # The no-network regional view should keep its satellite texture and accurate terrain.
        context.route('https://server.arcgisonline.com/**',lambda r:r.abort())
        page=context.new_page(); errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(BASE,wait_until='domcontentloaded')
        b=lambda name:page.get_by_role('button',name=name,exact=True)
        dialog=page.get_by_role('dialog')
        expect(page.locator('.map-stage')).to_have_attribute('data-mode','model',timeout=25000)
        b('放大地图').click();b('缩小地图').click();b('2D 平面').click()
        expect(page.locator('.map-stage')).to_have_attribute('data-mode','flat')
        b('设置中心').click(); b('3 公里').click();b('查看整个范围').click()
        expect(b('九宫格')).to_have_attribute('aria-pressed','true');b('九宫格').click()
        b('大字模式').click();expect(page.locator('html')).to_have_attribute('data-large','true'); b('大字模式').click()
        b('公园散步').click();expect(dialog.get_by_text('柳浪闻莺')).to_be_visible();b('关闭窗口').click()
        page.locator('.landmark-card').filter(has_text='白堤').click();b('存为常去').click()
        page.locator('input[type=file]').set_input_files(ROOT/'public/media/bai-causeway.webp'); b('家人住处').click();b('保存到常去地点').click()
        expect(dialog.get_by_text('家人住处')).to_be_visible();b('关闭窗口').click();page.reload(wait_until='domcontentloaded')
        b('常去地点').click();expect(dialog.get_by_text('家人住处')).to_be_visible()
        assert page.evaluate("JSON.parse(localStorage.getItem('linli-map:v1')).saved[0].photo.startsWith('data:image/jpeg')")
        b('关闭窗口').click();b('设置中心').click();b('在地图上点选').click();b('选画面中心').click()
        page.get_by_label('这里也是我的家').check();b('设为地图中心').click()
        expect(page.locator('.place-title')).to_have_text('我的家');b('一键回家 从当前位置步行回家').click()
        expect(page.get_by_role('heading',name='到达目的地附近')).to_be_visible();b('完成导航').click()
        page.locator('.landmark-card').filter(has_text='雷峰塔').click();b('去这里').click()
        expect(page.get_by_text('25 分钟',exact=True)).to_be_visible();b('骑行').click();expect(b('骑行')).to_have_attribute('aria-pressed','true')
        b('从当前位置开始导航').click();expect(page.get_by_role('heading',name='正在导航')).to_be_visible()
        page.evaluate('emitFix(30.2508,120.1587,95)');expect(page.get_by_text('等定位更准一些')).to_be_visible()
        assert page.evaluate('events.tones')==0
        page.evaluate('emitFix(30.2508,120.1587,5)'); page.evaluate('emitFix(30.25075,120.1587,5)');expect(page.get_by_text('您可能走偏了')).to_be_visible()
        assert page.evaluate('events.tones')==2
        assert any('走偏' in s for s in page.evaluate('events.spoken'))
        b('按当前位置重新规划').click();expect(page.get_by_role('heading',name='正在导航')).to_be_visible()
        page.evaluate('emitFix(30.233859,120.145,5)');page.evaluate('emitFix(30.233859,120.145,5)');expect(page.get_by_role('heading',name='到达目的地附近')).to_be_visible();b('完成导航').click();assert page.evaluate('events.stops')>=2
        page.evaluate('window.geoDenied=true');page.locator('.home-card').click();expect(page.get_by_role('alert')).to_contain_text('定位权限已关闭');b('关闭路线').click()
        for width in [1440,1024,768,390,320]:
            page.set_viewport_size({'width':width,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        b('大字模式').click();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert not errors,errors
        browser.close();print('PASS: 3D/2D, zoom, grid, category, large text, photo, persistence, home, foot/bike, compass, noisy GPS, two beeps + speech, reroute, arrival, permission denial, responsive layouts.')
if __name__=='__main__':run()
