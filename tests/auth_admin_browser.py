"""End-to-end Playwright verification of 3D realistic lighting, user auth/sync, and admin console."""
import sys
from playwright.sync_api import sync_playwright, expect

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8799").rstrip("/")


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=True,
            args=["--enable-unsafe-swiftshader"],
        )
        ctx = browser.new_context(viewport={"width": 1280, "height": 840})
        ctx.route("https://server.arcgisonline.com/**", lambda r: r.abort())
        ctx.route("https://wayback.maptiles.arcgis.com/**", lambda r: r.abort())
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(BASE, wait_until="domcontentloaded")
        b = lambda name: page.get_by_role("button", name=name, exact=True)
        dialog = page.get_by_role("dialog")

        # 1. Verify realistic 3D model map loads & lighting switcher works
        expect(page.locator(".map-stage")).to_have_attribute("data-mode", "model", timeout=25000)
        light_btn = page.get_by_role("button", name="切换实景光影")
        expect(light_btn).to_be_visible()
        light_btn.click()
        expect(page.get_by_role("status")).to_contain_text("暖阳")

        # 2. Register a new regular user and verify cloud sync
        b("账号登录").click()
        expect(dialog).to_be_visible()
        dialog.get_by_role("tab", name="注册新账号").click()
        dialog.get_by_label("用户名（2~24 位）").fill("senior_zhang")
        dialog.get_by_label("您的称呼（选填）").fill("张奶奶")
        dialog.get_by_label("登录密码").fill("zhang12345")
        dialog.get_by_role("button", name="注册并自动登录").click()
        expect(page.get_by_role("button", name="张奶奶")).to_be_visible(timeout=8000)
        expect(page.get_by_role("button", name="管理后台")).to_have_count(0)

        # Logout regular user
        page.get_by_role("button", name="张奶奶").click()
        dialog.get_by_role("button", name="退出当前账号").click()
        expect(b("账号登录")).to_be_visible(timeout=8000)

        # 3. Login as admin and exercise full Admin Console
        b("账号登录").click()
        dialog.get_by_label("用户名或手机号").fill("admin")
        dialog.get_by_label("登录密码").fill("Admin@123456")
        dialog.get_by_role("button", name="立即登录").click()
        expect(page.get_by_role("button", name="管理后台")).to_be_visible(timeout=8000)

        # Open Admin Dashboard -> check overview & 3D models table
        page.get_by_role("button", name="管理后台").click()
        expect(dialog.get_by_text("已部署三维街区模型资产")).to_be_visible(timeout=8000)
        expect(dialog.get_by_text("杭州湖滨公园")).to_be_visible()

        # Users tab -> verify senior_zhang appears
        dialog.get_by_role("tab", name="用户管理").click()
        expect(dialog.get_by_text("张奶奶")).to_be_visible(timeout=8000)

        # Landmarks tab -> publish a community landmark near West Lake
        dialog.get_by_role("tab", name="地标实景").click()
        dialog.get_by_placeholder("地标或店铺名称（如：社区助老食堂）").fill("湖滨助老驿站")
        dialog.get_by_role("button", name="发布公共地标").click()
        expect(dialog.get_by_text("湖滨助老驿站")).to_be_visible(timeout=8000)

        # Settings & Announcements tab -> publish community notice
        dialog.get_by_role("tab", name="地图与公告").click()
        dialog.get_by_placeholder("公告标题（如：本周三西湖断桥周边施工绕行提醒）").fill("春季西湖漫步提示")
        dialog.get_by_placeholder("填写简短易懂的提醒内容，支持首页长辈一键语音收听…").fill("湖滨路段人流较多，建议慢行注意安全。")
        dialog.get_by_role("button", name="发布公告").click()
        expect(dialog.get_by_text("春季西湖漫步提示")).to_be_visible(timeout=8000)

        # Audit logs tab
        dialog.get_by_role("tab", name="审计日志").click()
        expect(dialog.get_by_text("admin.landmark.create")).to_be_visible(timeout=8000)

        # Close admin dialog -> verify announcement banner & new community landmark appear live on main page
        b("关闭窗口").click()
        expect(page.locator(".announce-bar")).to_contain_text("春季西湖漫步提示")
        expect(page.locator(".landmark-cards")).to_contain_text("湖滨助老驿站")

        # Responsive overflow check even with admin nav & announcement banner visible
        for width in [1440, 1024, 768, 390, 320]:
            page.set_viewport_size({"width": width, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"overflow at {width}px"

        assert not errors, errors
        browser.close()
        print("PASS: Realistic 3D lighting, user registration/login/logout, admin dashboard (overview/users/landmarks/announcements/audit), live propagation, and 320-1440px responsive layout.")


if __name__ == "__main__":
    run()
