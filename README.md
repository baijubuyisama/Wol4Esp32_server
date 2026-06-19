# ESP32 WoL 服务端

为 [ESP32-C3 WoL 控制器](../src/main.cpp) 提供 Web 控制台:浏览器界面 → 本服务端 → MQTT → ESP32 设备发送魔术包。

```
 浏览器 (React UI) ──WebSocket──▶ 本服务端 (Node.js) ──MQTT──▶ ESP32 固件 ──▶ 目标主机
        ▲                              │
        └────── 状态/心跳转发 ◀────────┘
```

## 目录结构

```
server/
  package.json              服务端依赖 (express / mqtt / ws)
  server.js                 服务端:静态托管 + MQTT 客户端 + WebSocket 转发
  public/                   原生版前端(无需构建,作为回退保留)
  public-react/             React + Vite 前端项目(主用)
    package.json            前端依赖 (react / vite)
    vite.config.js          dev 代理 /ws → 3000
    index.html
    src/
      main.jsx              入口
      App.jsx               根组件(状态分发)
      utils.js              MAC/IP 规范化、时间等工具
      styles/global.css     深色主题
      hooks/
        useDevices.js        设备列表 + localStorage 持久化
        useWebSocket.js      /ws 连接 + 自动重连 + 发送封装
      components/
        StatusPill.jsx       顶栏状态药丸
        AddDeviceForm.jsx    添加设备表单
        DeviceCard.jsx       单设备卡片
        LogPanel.jsx         实时日志面板
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

| 变量            | 默认值                     | 说明                                |
| --------------- | -------------------------- | ----------------------------------- |
| `MQTT_URL`      | `mqtt://localhost:1883`    | MQTT broker 地址,必须与固件一致    |
| `MQTT_USER`     | *(空)*                     | broker 用户名                       |
| `MQTT_PASSWORD` | *(空)*                     | broker 密码                         |
| `MQTT_CLIENT_ID`| `wol-server-<随机>`        | MQTT 客户端 ID                      |
| `PORT`          | `3000`                     | HTTP / WebSocket 监听端口           |

示例:

```bash
MQTT_URL=mqtt://192.168.1.10:1883 MQTT_USER=pi MQTT_PASSWORD=secret npm start
```

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
4. 浏览器打开服务端地址,添加目标设备的 MAC/IP,点击「唤醒」
