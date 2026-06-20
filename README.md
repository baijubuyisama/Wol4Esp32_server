# ESP32 WoL 服务端

为 [ESP32-C3 WoL 控制器](https://github.com/baijubuyisama/RemoteWoL4Esp32) 提供 Web 控制台:浏览器界面 → 本服务端 → MQTT → ESP32 设备发送魔术包。

> **相关仓库**
> * **本仓库（服务端）**: [baijubuyisama/Wol4Esp32_server](https://github.com/baijubuyisama/Wol4Esp32_server) — Node.js Web 控制台（React + WebSocket + MQTT 转发 + TOTP 鉴权）。
> * **固件 / 客户端**: [baijubuyisama/RemoteWoL4Esp32](https://github.com/baijubuyisama/RemoteWoL4Esp32) — ESP32-C3 固件，订阅 MQTT 主题、发魔术包、Ping 在线检测。本仓库内的 `../src/main.cpp` 即该固件源码。

```
 浏览器 (React UI) ──WebSocket──▶ 本服务端 (Node.js) ──MQTT──▶ ESP32 固件 ──▶ 目标主机
        ▲                              │
        └────── 状态/心跳转发 ◀────────┘
```

## 目录结构

```
server/
  package.json              服务端依赖 (express / mqtt / ws)
  server.js                 服务端:静态托管 + MQTT 客户端 + WebSocket 转发 + TOTP 鉴权
  public/                   原生版前端(无需构建,作为回退保留)
  public-react/             React + Vite 前端项目(主用)
    package.json            前端依赖 (react / vite)
    vite.config.js          dev 代理 /ws → 3000
    index.html
    src/
      main.jsx              入口
      App.jsx               根组件(未登录显示登录页,已登录显示控制台)
      utils.js              MAC/IP 规范化、时间等工具
      styles/global.css     浅色/深色双主题(Material Design 配色)
      hooks/
        useDevices.js        设备列表 + localStorage 持久化
        useWebSocket.js      /ws 连接 + 自动重连 + token 鉴权 + 发送封装
        useAuth.js           TOTP 登录 / 会话 token(sessionStorage)
        useTheme.js          浅色/深色/跟随系统主题(localStorage)
      components/
        Login.jsx            TOTP 6 位码登录页
        StatusPill.jsx       顶栏状态药丸
        AddDeviceForm.jsx    添加设备表单
        DeviceCard.jsx       单设备卡片
        LogPanel.jsx         实时日志面板
        ThemeToggle.jsx      主题切换下拉
    dist/                   build 产物(server.js 直接托管,.gitignore)
```

## 两种运行模式

### 生产模式(推荐日常使用)
构建一次,由 server.js 托管静态产物,单端口 3000:

```bash
cd server
npm install                                    # 服务端依赖
cd public-react && npm install && npm run build && cd ..   # 构建前端
MQTT_URL=mqtt://<broker>:1883 npm start        # 启动 http://localhost:3000
```

### 开发模式(开发前端时)
Vite dev server 跑在 5173,`/ws` 代理到后端 3000,两端可独立热更新:

```bash
# 终端 1:后端
cd server && MQTT_URL=mqtt://<broker>:1883 npm start

# 终端 2:前端(热更新)
cd server/public-react && npm run dev
# 打开 http://localhost:5173
```

> 若 `public-react/dist/` 不存在,server.js 会自动回退到原生版 `public/`,不构建也能跑。

## 配置(环境变量)

| 变量            | 默认值                     | 说明                                                              |
| --------------- | -------------------------- | ----------------------------------------------------------------- |
| `MQTT_URL`      | `mqtt://localhost:1883`    | MQTT broker 地址,必须与固件一致。本机同机部署用 `127.0.0.1` 而非 `localhost`(后者在部分系统解析到 `::1`,而 mosquitto 默认仅监听 IPv4,会 `ECONNREFUSED`) |
| `MQTT_USER`     | *(空)*                     | broker 用户名                                                     |
| `MQTT_PASSWORD` | *(空)*                     | broker 密码                                                       |
| `MQTT_CLIENT_ID`| `wol-server-<随机>`        | MQTT 客户端 ID                                                    |
| `PORT`          | `3000`                     | HTTP / WebSocket 监听端口                                         |
| `TOTP_SECRET`   | *(空)*                     | TOTP 共享密钥(base32,A-Z2-7)。**必填**,缺失则无法登录           |
| `SESSION_TTL`   | `43200`                    | 会话有效期(秒),默认 12 小时。前端 token 存 sessionStorage,关浏览器即失效 |

示例(systemd 部署用 `EnvironmentFile`,见下方生产部署):

```bash
# /etc/wol-server.env (mode 600, 不入库)
PORT=3000
MQTT_URL=mqtt://127.0.0.1:1883
MQTT_USER=wol
MQTT_PASSWORD=<broker 密码>
MQTT_CLIENT_ID=wol-server
TOTP_SECRET=<base32 密钥>
SESSION_TTL=43200
```

本地快速试跑:

```bash
MQTT_URL=mqtt://192.168.1.10:1883 MQTT_USER=pi MQTT_PASSWORD=secret \
TOTP_SECRET=JBSWY3DPEHPK3PXP npm start
```

## 鉴权(TOTP 登录)

服务端在原 MQTT 转发之上叠加了一层纯 TOTP 鉴权(零额外依赖,手写 RFC 6238 / HMAC-SHA1):

- **纯 TOTP,无用户名**:单一 `TOTP_SECRET`,30s / 6 位,允许 ±1 窗口容忍时钟漂移。
- **会话令牌**:登录成功后服务端发一个随机 session token,存内存 `Map`(进程重启即全部失效,需重新登录)。`SESSION_TTL` 控制有效期。
- **前端存 sessionStorage**(非 localStorage):**关闭浏览器即失效**,下次访问需重新输入验证码,符合"每次关浏览器重验证"。
- **受保护面**:`/api/*` 走 `Authorization: Bearer <token>` 头;`/ws` 握手带 `?token=<token>` 查询参数,未带或无效直接 401。
- **API**:`POST /api/login` `{ code }` → `{ ok, token, ttl }`;`POST /api/logout`;`GET /api/session`(探测是否仍有效)。

### 首次配对(带外)

> ⚠️ **secret 是登录凭据,服务端绝不通过任何接口分发。** 早期版本曾有一个未鉴权的 `/api/otpauth` 端点会把 secret 直接吐给任意访问者——已删除。任何人拿到 secret 即可自助登录,故 secret 必须带外交接。

生成一个 base32 密钥并得到 otpauth URL(本地执行,**不要把输出贴到任何公网地方**):

```bash
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('base64').toUpperCase().replace(/=+$/,'').replace(/\+/g,'').slice(0,26);console.log('SECRET='+s);console.log('otpauth://totp/WoL:admin?secret='+s+'&issuer=WoL&period=30&digits=6')"
```

把 `SECRET=...` 写进 `/etc/wol-server.env`,把 otpauth URL(或手抄 secret)用带外方式(当面、私密信道)交给使用者,在手机验证器中手动录入。重启服务后即可用其生成的 6 位码登录。

## MQTT 主题(与固件契约一致)

| 主题                | 方向        | Payload                                   |
| ------------------- | ----------- | ----------------------------------------- |
| `home/wol/trigger`  | 服务端→设备 | `MAC` 或 `MAC;IP`(后者会触发 Ping 在线检测) |
| `home/wol/status`   | 设备→服务端 | 发送结果 / 在线检测结果文本               |
| `home/wol/heartbeat`| 设备→服务端 | `alive`,约每 10s 一次                     |

## 前端功能

- **多设备管理**:添加(昵称 / MAC / 可选 IP)、删除,保存在浏览器 `localStorage`
  - MAC 支持 `aabbccddeeff`、`AA-BB-CC-DD-EE-FF` 等写法,自动规范化为 `XX:XX:XX:XX:XX:XX`
- **状态可视化**:唤醒中 / 检测中 / 已上线 / 超时,通过匹配 status 消息中的 IP 自动更新
- **设备在线指示**:依据心跳,超过 30s 未收到即判离线
- **实时日志**:状态、心跳、唤醒确认系统消息流

## 与固件对接步骤

1. 在 broker 上确认三个主题可用
2. 把固件 `src/main.cpp` 顶部 `mqtt_server` 等填为真实 broker 地址并烧录
3. 把本服务端的 `MQTT_URL` 指向同一 broker 并启动
4. 浏览器打开服务端地址,输入 TOTP 验证码登录后,添加目标设备的 MAC/IP,点击「唤醒」

## 生产部署(systemd + mosquitto 同机)

以 broker 与服务端同机部署为例(对外只暴露 3000,broker 仅本机回环)。

1. **mosquitto**(本机回环 + 口令认证),`/etc/mosquitto/conf.d/wol.conf`:

   ```conf
   listener 1883 127.0.0.1
   allow_anonymous false
   password_file /etc/mosquitto/passwd
   ```

   建用户:`mosquitto_passwd -b /etc/mosquitto/passwd wol '<密码>'` → `systemctl restart mosquitto`。

2. **代码与前端构建**:

   ```bash
   git clone <本仓库> /opt/wol-server
   cd /opt/wol-server && npm install
   cd public-react && npm install && npm run build && cd ..
   ```

3. **环境文件** `/etc/wol-server.env`(mode 600, root 只读, 不入库):见上方「配置(环境变量)」的示例块。`TOTP_SECRET` 按上方「首次配对」生成。

4. **systemd 单元** `/etc/systemd/system/wol-server.service`:

   ```ini
   [Unit]
   Description=ESP32 WoL Server
   After=network.target mosquitto.service

   [Service]
   Type=simple
   User=root
   WorkingDirectory=/opt/wol-server
   EnvironmentFile=/etc/wol-server.env
   ExecStart=/usr/bin/node /opt/wol-server/server.js
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

   `systemctl daemon-reload && systemctl enable --now wol-server`。

5. **防火墙**:对外放行 3000(`firewall-cmd --permanent --add-port=3000/tcp && firewall-cmd --reload`);云厂商安全组同步放行。broker 端口 1883 **不对公网开放**(仅 `127.0.0.1`)。

6. **更新代码**:`cd /opt/wol-server && git pull`(若前端有改动追加 `cd public-react && npm run build`),`systemctl restart wol-server`。

