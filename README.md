# Dog 秘书

一个常驻 Windows 托盘的桌面 AI 秘书：**记事、盯时间、替你看着其他 AI Agent，把要紧的事用桌面悬浮通知告诉你。**

界面刻意做得很轻：一个 432px 宽的小控制台 + 右上角会自己消失的悬浮通知，不占桌面、不抢注意力。

![今日](docs/screenshots/home.png)

| 监工台 | 桌面悬浮通知 |
| --- | --- |
| ![监工台](docs/screenshots/agents.png) | ![悬浮通知](docs/screenshots/toast.png) |

## 能做什么

- **日常事务**：待办、截止时间、优先级、标签、随手笔记；中文自然语言快速记录（“明天下午3点交周报”）。
- **到点提醒**：桌面悬浮通知，支持提前提醒、免打扰时段、静音 1 小时、系统通知兜底。
- **秘书对话**：接入大模型后用工具调用真正操作事项、派活、查询进度，而不是只聊天。
- **智能体监工**：纳管内部助理、命令行 Agent、外部 HTTP Agent；看进度、看汇报、补指令、取消任务。
- **主动汇总**：智能体完成/失败/需要你拍板时立即通知；运行中按间隔汇总；每天早报和晚间收尾。
- **常驻后台**：关闭窗口收进托盘，`Ctrl+Alt+D` 随时叫出快速记录。

## 快速开始

环境：Windows 10/11，Node.js 20+（开发运行）。

```powershell
npm install
npm start
```

在受限终端 / 当前 DSH 环境里，`npm start` 会自动加 `--no-sandbox`，并把数据放到项目下的 `data/`；也可以显式执行 `npm run start:compat`。

**不想装 Node？** 直接双击 `release/Dog Secretary Setup 1.0.5.exe` 安装；或者解压 `release/DogSecretary-1.0.5-win-x64.zip`，运行里面的 `Dog Secretary.exe`。

首次启动会进入引导页：

1. 填怎么称呼你、秘书名字；
2. 选模型（没有 Key 就选“先看看演示”，会载入示例事项和两个内部助理）；
3. 设定每天早报时间。

> Electron 二进制下载慢时，可以走镜像：
>
> ```powershell
> $env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
> $env:ELECTRON_CUSTOM_DIR='{{ version }}'
> npm install
> ```

## 接入模型

「设置 → 模型 → 添加模型」：

| 类型 | 说明 |
| --- | --- |
| DeepSeek / OpenAI / Kimi / 通义 / Ollama | OpenAI 兼容接口，填 Base URL、模型名、Key |
| Anthropic Claude | 原生 Messages API + tool use |
| 自定义 | 任意 OpenAI 兼容中转站 / 自建服务 |

- Key 用 Windows DPAPI（Electron `safeStorage`）加密后写入本机 `data.json`，渲染层拿不到明文。
- 保存后点「测试连接」会发一条最小请求，返回延迟和回复。
- 对话和监工汇总需要模型支持 **tool calling**；DeepSeek、GPT、Claude 都支持。

## 使用

### 快速记录

主界面输入框或 `Ctrl+Alt+D`：

```
明天下午3点交周报
周五晚上7点和老王吃饭
提醒我半小时后喝水
10月25日 上午10点 牙医
买牛奶
```

会解析出时间和标题，到点悬浮提醒。解析不了时间就当作普通待办，不会硬猜。

### 对话示例

- “今天怎么安排？”
- “提醒我明天下午3点给客户回电话”
- “把「整理竞品」派给研究助理”
- “看看智能体进度，有卡住的吗？”
- “总结一下今天的进展”

模型会通过工具读/写本地数据；界面会在回复下显示“查看了今日 / 记下事项”等痕迹。

### 智能体

「监工 → 添加」支持三种：

1. **内部助理**：直接用当前模型执行任务，产出成果。适合资料整理、写作、分析。
2. **命令行 Agent**：启动本机 CLI，捕获 stdout/stderr，支持三种传参方式（参数 / stdin / 环境变量）。
3. **外部接口 Agent**：把任务 POST 到你的 `dispatchUrl`，由外部 Agent 通过本地接口回报进度。

派活后：

- 进度条、状态、最近汇报实时更新；
- 超过 `checkInMinutes × 2`（至少 45 分钟）没汇报，标记“失联 / 等待确认”；
- 需要你拍板、完成、失败时立即悬浮通知；
- 按设置间隔生成监工汇总（默认 60 分钟），也可手动点刷新汇总；
- 完成时自动把关联事项标记完成。

#### 命令行 Agent 示例

用自带的演示脚本验证链路：

- 命令：`node`（或 Node 的绝对路径）
- 参数：`"E:\Code\AI\tools\dog\scripts\demo-agent.mjs" {prompt}`
- 传参方式：参数

真实 CLI 示例（需自行安装并确认在 PATH 中）：

- Claude Code：命令 `claude`，参数 `-p {prompt}`
- Codex CLI：命令 `codex`，参数 `exec {prompt}`

> Windows 上 npm 全局安装的 CLI 往往是 `.cmd` 包装脚本，Node 的 `spawn` 不能直接执行 `.cmd`。请填 `.exe` 全路径，或用 `cmd.exe /d /s /c ...` 作为命令；否则会报“命令启动失败”。

CLI 运行时 Dog 会注入：

```
DOG_RUN_ID / DOG_AGENT_ID / DOG_PROMPT / DOG_REPORT_URL / DOG_TOKEN
```

Agent 可以：

1. 调用 `node scripts/agent-report.mjs --status running --progress 50 --message "..."`；
2. 或直接输出一行 JSON：

```text
DOG_REPORT {"status":"running","progress":50,"message":"资料找齐了"}
DOG_REPORT {"status":"waiting","message":"需要你确认口吻","needsAttention":true}
DOG_REPORT {"status":"done","summary":"成稿已放 output.md"}
```

#### 外部 Agent 上报

「设置 → 智能体接口」里有地址和 Token：

```bash
curl -X POST http://127.0.0.1:47821/v1/report \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"runId":"...","status":"running","progress":50,"message":"已完成一半"}'
```

也支持 `GET /v1/runs/:id` 查询。接口只绑定 `127.0.0.1`，用随机 Token 鉴权。

## 通知

默认是自绘的桌面悬浮窗（右上角、3 条堆叠、悬停暂停、点击进收件箱），格式只保留：**图标 + 标题 + 两行内文 + 时间**。

设置里可以：

- 改成同时发 Windows 系统通知；
- 调整停留时间；
- 设置免打扰时段（只入收件箱，不弹）；
- 静音 1 小时；
- 预览效果。

## 快捷键 / 托盘

- `Ctrl+Alt+D`：呼出 / 收回控制台，并聚焦快速记录。
- 关闭按钮：收起到托盘（可在设置中改成直接退出）。
- 托盘右键：打开、快速记一笔、立即监工、生成今日简报、静音、退出。
- 数据保存在 `%APPDATA%\DogSecretary\`，每天自动备份到 `backups/`（保留 7 天）。
- 如果宿主环境拒绝写 AppData，会自动降级到程序目录下的 `DogSecretary-data`，再不行用临时目录；设置页会标注当前数据目录。可用 `DOG_DATA_DIR` 强制指定。

## 开发

```powershell
npm test            # 31 个 Node 单元测试（时间解析、存储、事项、Agent、HTTP 回调、模型适配、监工）
npm start           # 开发运行
npm run smoke       # 截图冒烟测试（需要图形会话）
npm run smoke:onboarding  # 单独截引导页
npm run pack        # 生成免安装目录 release/win-unpacked
npm run dist        # 生成 NSIS 安装包（release/Dog Secretary Setup 1.0.5.exe）
```

冒烟测试会用独立数据目录启动 Electron，依次截取今日、事项、监工、收件箱、对话、设置、弹层、悬浮通知，并验证快速记录、对话工具调用和通知点击。结果在 `screenshots/result.json`。

打包下载 Electron / NSIS 慢时同样可以设置 `ELECTRON_MIRROR`，或使用 `ELECTRON_BUILDER_BINARIES_MIRROR`。

### 目录

```
src/main/       主进程：存储、模型、工具、Agent、监工、调度、通知、IPC
src/renderer/   控制台 UI + 悬浮通知 UI（原生 ES Module，无前端框架）
src/preload*.js 安全桥
scripts/        Agent 上报助手、演示 CLI
assets/         图标（make_icon.py 可重新生成）
test/           Node 测试
```

### 设计取舍

- **无前端框架、无打包器**：渲染层就是原生 ES Module + CSS，启动快、依赖少，也方便直接改。
- **JSON 存储**：单用户、本地优先，原子写 + 每日备份；数据量到几千条仍然轻松。
- **本地回环 API**：外部 Agent 不需要云端账号，只要拿到一次性 Token 就能上报。
- **悬浮通知自绘**：比系统 toast 更可控（停留、堆叠、悬停暂停、点击行为），系统通知作为可选项。

## 已知限制

- 仅面向 Windows（DPAPI、托盘、通知行为都按 Windows 设计）。
- 不做云同步、多账号、多人协作。
- 对话不是流式输出；工具调用轮次有上限（6 轮）。
- 模型能力决定体验：tool calling 不稳的模型可能只聊天不操作。
- 命令行 Agent 直接 `spawn` 可执行文件，不经过 shell；`.cmd` 包装脚本需自行换 `.exe` 或 `cmd.exe`。
- 打包产物未签名，Windows SmartScreen 可能提示；正式分发请自行签名。

## License

MIT



