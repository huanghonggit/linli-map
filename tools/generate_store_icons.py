"""Generate Google Play & Apple App Store compliant icons and feature graphics from public/mark.svg."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SVG_MARK = (ROOT / "public/mark.svg").read_text(encoding="utf-8")

ICON_HTML = f"""<!doctype html>
<html>
<body style="margin:0;width:1024px;height:1024px;background:#27634b;display:grid;place-items:center;overflow:hidden;">
  <div style="width:920px;height:920px;">
    {SVG_MARK.replace('<svg ', '<svg width="920" height="920" ')}
  </div>
</body>
</html>"""

FEATURE_HTML = f"""<!doctype html>
<html>
<body style="margin:0;width:1024px;height:500px;background:linear-gradient(135deg,#215741 0%,#2d6f53 55%,#448964 100%);display:flex;align-items:center;justify-content:center;gap:54px;font-family:'Microsoft YaHei UI','PingFang SC',sans-serif;color:#fffdf6;overflow:hidden;">
  <div style="width:220px;height:220px;border-radius:52px;box-shadow:0 18px 42px rgba(14,38,27,.38);overflow:hidden;flex-shrink:0;">
    {SVG_MARK.replace('<svg ', '<svg width="220" height="220" ')}
  </div>
  <div style="max-width:600px;">
    <div style="display:inline-block;padding:6px 14px;border-radius:999px;background:rgba(246,199,113,.2);border:1px solid rgba(246,199,113,.65);color:#fbe1a6;font-size:20px;font-weight:700;margin-bottom:14px;">实景三维卫星 · 大字语音导航</div>
    <h1 style="margin:0;font-size:66px;font-weight:800;letter-spacing:-1px;line-height:1.12;">邻里地图</h1>
    <p style="margin:16px 0 0;font-size:28px;line-height:1.45;color:#e7f2ea;">认地标、找公园、一键步行回家<br/>写实三维街区与跨设备云同步</p>
  </div>
</body>
</html>"""


def strip_alpha_png(src: Path, dst: Path, size: tuple[int, int]):
    """Resize and convert to opaque RGB PNG (required by Apple App Store for AppIcon)."""
    from PIL import Image

    with Image.open(src) as im:
        rgb = im.convert("RGB").resize(size, Image.Resampling.LANCZOS)
        dst.parent.mkdir(parents=True, exist_ok=True)
        rgb.save(dst, format="PNG", optimize=True)


def run(mode="all"):
    out = ROOT / "store-assets"
    out.mkdir(parents=True, exist_ok=True)
    raw_icon = out / "_tmp_icon_1024.png"
    feature_png = out / "googleplay-feature-1024x500.png"

    if mode in ("all", "render"):
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True)
            page = browser.new_page(viewport={"width": 1024, "height": 1024}, device_scale_factor=1)
            page.set_content(ICON_HTML)
            page.screenshot(path=str(raw_icon))

            page.set_viewport_size({"width": 1024, "height": 500})
            page.set_content(FEATURE_HTML)
            page.screenshot(path=str(feature_png))
            browser.close()

    if mode in ("all", "resize"):
        # App Store 1024x1024 (strictly opaque RGB)
        strip_alpha_png(raw_icon, out / "appstore-icon-1024.png", (1024, 1024))
        strip_alpha_png(
            raw_icon,
            ROOT / "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
            (1024, 1024),
        )
        # Google Play 512x512
        strip_alpha_png(raw_icon, out / "googleplay-icon-512.png", (512, 512))

        # Replace legacy Android mipmap PNG icons so Android 7 devices also show Linli Map brand icon
        densities = {
            "mdpi": 48,
            "hdpi": 72,
            "xhdpi": 96,
            "xxhdpi": 144,
            "xxxhdpi": 192,
        }
        for d, px in densities.items():
            base = ROOT / f"android/app/src/main/res/mipmap-{d}"
            if base.exists():
                strip_alpha_png(raw_icon, base / "ic_launcher.png", (px, px))
                strip_alpha_png(raw_icon, base / "ic_launcher_round.png", (px, px))

        raw_icon.unlink(missing_ok=True)
        print("Generated store-assets and iOS/Android icons successfully.")


if __name__ == "__main__":
    import sys

    run(sys.argv[1] if len(sys.argv) > 1 else "all")
