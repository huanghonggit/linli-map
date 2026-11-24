# 邻里地图

点“公园散步”找附近的公园，点地标照片看路线。第一次打开时，地图展示杭州西湖的卫星影像。家、常去地点、照片和字号保存在当前浏览器，使用时无需注册。

## 第一次使用

1. 点 **设置中心**，输入城市或地标后点 **搜索**，在结果里选位置。也可以点 **使用当前位置** 或 **在地图上点选**。选 **设为地图中心** 后，地点会出现在 **我的中心点** 里，下次点名字即可切换。选 **只保存中心点** 可以先存下次要去的地方。要更新家的位置，勾选 **这里也是我的家**。
2. 选择 **1、3、5 或 10 公里**。点标题旁的范围按钮可看全图。打开 **九宫格** 后，点“东北”等方位可放大该区。双指捏合或点加减号都能缩放。
3. 点生活图标、地标照片或常去地点，选 **去这里**。预览从地图中心算起。开始导航时，应用会获取所在位置，再按步行或骑行道路重新算路。
4. 点 **一键回家** 从当前位置步行回家。途中需要看方向时，保持页面在前台。指南针取得行进方向后，箭头以行进方向为前方；站着未取得方向时，表盘显示北朝上。

**给地点配照片** 打开“常去地点 → 添加常去地点”，点地图或使用当前位置，选一张门口的照片。可以直接点“买菜的地方”“家人住处”等名称，全程只需点按。

## 街区三维模型（v2.0 写实与极速引擎）

选择杭州湖滨公园、天津站或上海人民广场附近的中心后，地图默认打开预先生成的三维模型。这三个区域各覆盖 5 公里。浦东瑞和苑取瑞和路 168 弄小区边界的几何中心，地图下方可直接切换 5、8、10 公里。手机可打开 `https://111.228.54.20/?map=ruiheyuan&radius=5`，将末尾数字换成 `8` 或 `10` 即可直达对应范围。点击 **楼体示意** 可查看楼体下方的影像，点击 **看清街区** 可放大，地图下方支持切换 **晴日 / 暖阳 / 柔和** 实景光影与左右环看。

- **写实渲染与建模**：三维引擎采用 ACES 色调映射、物理大气散射天空穹顶与远景雾效、地形法线山体阴影（Hillshade）与湖河水面微反光；所有已建模区域均支持真实卫星屋顶投影融合、按建筑实高自适应的程序化立面（低层民居 / 中高层住宅 / 超高层玻璃幕墙与首层底商）以及地面接触环境光遮蔽（Ground AO）。离线构建脚本 `tools/model/buildings.py` 支持 LoD2 坡屋顶（`gabled` / `hipped` / `pyramidal`）与建筑语义属性保留。
- **极速加载与坐标精准度**：全部已建模区域均在构建时生成内容寻址单请求首屏启动包（`tools/presetAssets.mjs`），建筑分块采用 Web Worker 池并行解码与 4 并发视锥优先加载；高清卫星瓦片内置「内存 LRU + Cache API 持久化 + 双缓冲无缝融合」及 Service Worker 静态/模型缓存；`src/geo.js` 提供亚分米级 `WGS-84 ↔ GCJ-02` 双向坐标纠偏。

```powershell
python -m pip install -r tools/model/requirements.txt
python tools/model/rasters.py tianjin
python tools/model/buildings.py tianjin --infer-roofs
```

## 用户系统与管理员后台

项目内置基于 Node.js 22 原生 SQLite（WAL）的全栈后端服务（`server/`），提供用户账号云端同步与管理员 RBAC 控制台：

- **普通用户**：支持用户名/手机号注册与登录（`scrypt` 随机盐哈希 + HS256 JWT）、跨 Web 与安卓 App 自动同步「我的家」「我的中心点」「常去地点（含门面照）」「大字/语音偏好」，离线本机依然可用。
- **管理员控制台**：使用管理员账号登录后，顶部导航出现 **管理后台** 入口，可查看运行指标与三维模型资产、增删改停用户及分配角色、发布公共社区地标（支持高德 GCJ-02 一键纠偏与实拍图上传）、发布首页语音公告、在线配置高清影像源 / 默认光影 / Cesium Token / 强制登录门禁、审计操作日志。
- **初始管理员**：默认账号 `admin`，初始密码 `Admin@123456`（建议通过环境变量 `LINLI_ADMIN_USERNAME` / `LINLI_ADMIN_PASSWORD` 指定，或首次登录后立即在个人中心修改）。

## 安卓 App 构建与访问登录

项目已集成 **Capacitor 8** 原生安卓工程（`android/`），内置硬件加速 WebGL 2 渲染、原生高精度 GPS 定位、硬件返回键处理、状态栏安全区适配与持久化 Token 登录：

1. 启动后端与站点服务（监听 `0.0.0.0:8787`，终端会打印局域网 IP）：
   ```powershell
   npm run build
   npm run start
   ```
2. 同步最新前端产物到安卓工程：
   ```powershell
   npm run android:sync
   ```
3. 生成 APK（两种方式任选其一）：
   - **Android Studio / 本机 JDK 21 + Android SDK 36**：运行 `npm run android:open` 打开 `android/` 工程，或运行 `npm run android:apk` 生成 `android/app/build/outputs/apk/debug/app-debug.apk`。
   - **Docker 容器免装 SDK 一键打包**：
     ```powershell
     docker build -f android/Dockerfile.build -t linli-android-builder .
     docker run --rm -v "${PWD}/releases:/out" linli-android-builder
     ```
4. **手机安装后访问登录**：打开「邻里地图」App → 点击顶部 **账号登录** → 在「服务器地址设置」中填写后端地址（公网 HTTPS 如 `https://111.228.54.20`，或同 Wi-Fi 局域网地址如 `http://192.168.x.x:8787`）并点 **保存并测速** → 登录普通账号或管理员账号即可同步地图数据与进入管理后台。

## 在本机运行

```powershell
npm ci
# 开发模式（前端 Vite + 后端 API 分终端运行，Vite 自动代理 /api）
npm run api
npm run dev

# 生产单进程全栈模式（静态产物 + API 一体监听 8787）
npm run build
npm run start

# 全套单元与后端 API 测试
npm test
```

浏览器端到端回归测试（需 Python Playwright + Chrome）：

```powershell
python tests/browser_smoke.py http://127.0.0.1:8787
python tests/auth_admin_browser.py http://127.0.0.1:8787
```

## 服务器上的隔离部署

公网版使用独立 Docker 容器和网络，HTTPS 入口在 443 端口。Caddy 负责签发和续期 IP 证书。站点文件以只读方式挂载，证书状态保存在本项目专用目录 `/opt/linli-map/tls`。本机检查地址是 `http://127.0.0.1:18088/`。

在服务器上查看当前发布版本的运行状态：

```sh
cd /opt/linli-map/current/deploy
docker compose --env-file site.env -f compose.yaml -f compose.https.yaml ps
```

## 影像、地形与路线

| 内容 | 本项目的用法 |
| --- | --- |
| 三维卫星地图 | Cesium 将 Esri World Imagery 贴到地形上。示例区自带西湖的 Sentinel‑2 卫星底图和真实高程，山区可以看到起伏。移到其他地区后请求 Esri World Elevation。设备不支持 WebGL 2 时切换到 Leaflet 平面卫星图。 |
| 摄影测量三维城市 | 可选。把具有资产 `2275207` 访问权限、限本站域名的**公开浏览器令牌**配置到 `.env.local` 中的 `VITE_CESIUM_ION_TOKEN`，重启开发服务或重建静态站点。城市模型在服务有覆盖的区域显示。 |
| 生活地点 | 首屏包含西湖周围的公开地点样本。其他位置可按分类在线查询，优先使用 Photon，必要时使用 Overpass。地图和列表显示各地点与中心的直线距离。 |
| 步行与骑行 | FOSSGIS 的两个 OSRM 路网分别规划步行和骑行。导航时间、路线和转向来自所选路网。服务无法算路时，页面提示重试或换一个入口。 |

默认图层和可选城市模型参考 [God’s Eye View](https://github.com/bilawalsidhu/gods-eye-view)。数据服务的许可、覆盖和可用性由各提供方决定。[FOSSGIS 路由服务说明](https://routing.openstreetmap.de/about.html) · [浏览器定位说明](https://developer.mozilla.org/zh-CN/docs/Web/API/Geolocation_API)

## 偏航与定位

设备上报的定位误差大于 45 米时，导航提示等待。连续两次有效定位偏离道路超过 `max(32 米, 1.8 × 定位误差)`，页面显示偏航提示、响两声，并在开启语音时播报。再次提醒至少间隔 25 秒。点 **按当前位置重新规划** 可以重新算路。结束导航后停止监听位置。

路线服务会收到起点和终点，在线地点服务会收到选定的查询中心。足迹只用于当前导航。清除浏览器的网站数据会移除家、收藏、照片和偏好。手机的静音设置、定位服务和中文语音会影响室外体验，实际使用时请留意路口信号和入口。

## 资料署名

- 卫星影像来自 Esri World Imagery 及各地影像贡献者。西湖随附底图取自 **Sentinel‑2 cloudless 2016 by EOX**，含修改后的 Copernicus Sentinel 数据（2016），已裁切、重投影并转换为 WebP。[EOX 图层与署名](https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 西湖高程从 Mapzen Terrain Tiles 的 Terrarium 瓦片采样，全球底图使用 Cesium 随附的 Natural Earth。其他地区在线高程来自 Esri。[Terrain Tiles 数据来源](https://registry.opendata.aws/terrain-tiles/)
- 道路和示例地点 © OpenStreetMap contributors，按 ODbL 许可。示例经纬度与导航接口均使用 WGS84。[OpenStreetMap 版权与许可](https://www.openstreetmap.org/copyright)
- 白堤照片由钉钉拍摄，雷峰塔由 Yinweichen 拍摄，均为 CC BY-SA 4.0。曲院风荷照片由 zhiyin586 拍摄，为 CC BY 3.0。随附副本经过缩小和 WebP 转换，分别沿用原许可。[白堤](https://commons.wikimedia.org/wiki/File:Bai_Causeway.jpg) · [雷峰塔](https://commons.wikimedia.org/wiki/File:Leifeng_Pagoda_at_Dusk.jpg) · [曲院风荷](https://commons.wikimedia.org/wiki/File:杭州._曲院风荷（荷花展）_-_panoramio_(8).jpg) · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Atkinson Hyperlegible Next 和 Noto Sans SC 随附界面字符子集，OFL 授权文本在 `public/fonts` 目录。
