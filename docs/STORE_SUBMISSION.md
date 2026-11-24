# Google Play & Apple App Store 上架合规与打包指南

本项目（`com.linlimap.seniors` v2.1.0）已完成双商店审核核心对齐。以下为正式提交清单与操作步骤。

---

## 一、已完成的代码级对齐项

| 审核要求 | 本项目实现位置 | 状态 |
| :--- | :--- | :--- |
| Android Target SDK ≥ 36（Android 16） | `android/variables.gradle` (`targetSdkVersion = 36`) | 已对齐 |
| 正式版强制全链路 HTTPS（关闭明文 HTTP 与 WebView 调试） | `capacitor.config.json`、`android/app/build.gradle`（`release` 强制 `usesCleartextTraffic=false`）、`android/app/src/main/res/xml/network_security_config.xml` | 已对齐 |
| Google Play AAB + R8 混淆与 Release 签名 | `android/app/build.gradle`（`signingConfigs.release`、`minifyEnabled true`）、`android/app/proguard-rules.pro` | 已对齐 |
| App 内自助永久注销账号 | `DELETE /api/auth/me` + `src/auth/AuthModal.jsx` 危险操作区 | 已对齐 |
| Google Play 公开网页版删号 URL | `/account-deletion.html` + `POST /api/public/account-deletion` | 已对齐 |
| 公开隐私政策页 + App 内置隐私说明 | `/privacy.html` + `src/dialogs.jsx` (`PrivacyPolicy`) | 已对齐 |
| Apple iOS 权限用途文案 & 出口合规 & Privacy Manifest | `ios/App/App/Info.plist`、`ios/App/App/PrivacyInfo.xcprivacy` | 已对齐 |
| 商店图标与宣传图（无 Alpha 通道 1024px / 512px / 1024×500） | `store-assets/`、`ios/.../AppIcon.appiconset/`、`android/.../mipmap-*` | 已对齐 |
| 正式商店版隐藏服务器调试框 & 消除 Web 措辞 | 构建设置 `VITE_STORE_RELEASE=true`；原生端自动切换为手机系统文案 | 已对齐 |

---

## 二、上架前必须由发布方准备的 3 项外部资源

1. **带正式域名与受信任 HTTPS 证书的公网后端**：例如 `https://map.yourdomain.com`（不可使用裸 IP 或自签名证书），确保以下三个地址公网 HTTPS 可访问：
   - API 健康检查：`https://map.yourdomain.com/api/health`
   - 隐私政策 URL：`https://map.yourdomain.com/privacy.html`
   - 账号删除 URL：`https://map.yourdomain.com/account-deletion.html`
2. **审核演示账号**：提前在生产后端创建一个普通测试账号（如 `reviewer` / `Review@2026`），填写到 Google Play「应用访问权限」和 App Store Connect「App 审核信息」中。
3. **第三方地图数据许可核验**：如面向大规模公开发行，请确认所选影像源、路径算路与街面实拍图（可在管理员后台配置自有或商业授权瓦片源）符合商用条款。

---

## 三、Google Play 正式包（.aab）打包步骤

### 1. 生成正式发布签名密钥（仅首次执行，务必离线妥善备份 `.jks`！）
```powershell
keytool -genkeypair -v `
  -keystore android\linli-upload.jks `
  -alias linli-upload `
  -keyalg RSA -keysize 2048 -validity 10000
```
复制 `android/keystore.properties.example` 为 `android/keystore.properties`（已被 `.gitignore` 忽略），填入实际密码与别名。

### 2. 编译正式签名 `.aab`
```powershell
$env:VITE_STORE_RELEASE = "true"
$env:VITE_API_BASE_URL = "https://map.yourdomain.com"
npm run android:aab
```
产物位于：`android/app/build/outputs/bundle/release/app-release.aab`。

### 3. Google Play 控制台填写速查
- **隐私政策**：`https://map.yourdomain.com/privacy.html`
- **删除账号网址**：`https://map.yourdomain.com/account-deletion.html`
- **数据安全（Data Safety）**：
  - 位置信息（精确位置）：仅用于应用功能（定位与导航），不与第三方广告共享，传输加密，用户可选；
  - 个人信息（用户 ID / 姓名 / 可选手机号）与照片：仅用于账号登录与跨设备同步，支持用户随时永久删除；
  - 广告与追踪：否。
- **个人开发者新号**：先发布到「封闭测试」轨道，邀请至少 12 名测试者连续测试 14 天后即可申请正式生产发布。

---

## 四、Apple App Store（iOS）打包与提交步骤

1. 在 macOS（**Xcode 26 及以上，iOS 26 SDK**）上拉取仓库并同步正式配置：
   ```bash
   export VITE_STORE_RELEASE=true
   export VITE_API_BASE_URL="https://map.yourdomain.com"
   npm ci
   npm run ios:sync
   npm run ios:open
   ```
2. 在 Xcode 中选中 `App` Target → **Signing & Capabilities** 选择您的 Apple Developer Team，自动管理签名证书。
3. 顶部设备选择 **Any iOS Device (arm64)** → 菜单 **Product → Archive** → **Distribute App → App Store Connect** 上传构建版本。
4. 在 App Store Connect 填写：
   - **App 隐私（Privacy Nutrition Labels）**：与 `ios/App/App/PrivacyInfo.xcprivacy` 保持一致（精确位置不关联身份、用户 ID 与主动上传照片关联账号仅用于 App 功能、全部不用于追踪）。
   - **支持网址 / 隐私政策网址**：填入您的 HTTPS 域名对应页面。
   - **中国大陆区上架**：需在 App Store Connect 补填工信部 App ICP 备案号；若仅上架中国大陆以外地区则无需备案。
5. **无 Mac 电脑时**：可直接在 GitHub 仓库的 **Actions → Store Release Builds** 手动触发云端构建，自动同时验证 Android `.aab` 与 macOS Xcode iOS 编译！
