import { networkInterfaces } from "node:os";
import { createAppServer } from "./app.js";

const app = createAppServer();
const { host, port, defaultAdminUsername } = app.config;

function lanAddresses() {
  const ips = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list || []) {
      if (info.family === "IPv4" && !info.internal) ips.push(info.address);
    }
  }
  return ips;
}

app.server.listen(port, host, () => {
  console.log(`[linli-api] 服务已启动: http://127.0.0.1:${port}`);
  for (const ip of lanAddresses()) {
    console.log(`[linli-api] 安卓/局域网访问地址: http://${ip}:${port}`);
  }
  console.log(
    `[linli-api] 数据库: ${app.config.dbPath} | 初始管理员账号: ${defaultAdminUsername}`,
  );
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    app.close().then(() => process.exit(0));
  });
}
