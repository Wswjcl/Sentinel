# Sentinel — Loop Engineering Platform for AI Agents

基于 Loop Engineering 理念的 AI Agent 循环工程平台。不是手动给 Agent 写 Prompt，而是设计让 Agent 自主运行的系统：**定时触发 → 执行 → 验证 → 修复迭代 → 经验沉淀 → 下次更聪明**。

每个任务 = 一个独立目录（含 tools + skills + verification），定时触发后自动调用 OpenCode CLI 执行，并通过 Agent Loop 验证和修复输出。

v1.0.0 带来 **Electron 桌面应用**，替代了之前的 Web Dashboard，提供原生窗口体验、实时事件推送和直接的核心引擎调用。

v2.0.0 引入 **Loop Engineering**：Agent Loop 闭环、双模式验证（command + LLM）、迭代修复；随后加入 **Flow Engineering**：DAG 任务流编排（并行节点、条件边、预算、断点恢复、克隆、可视化画布）。

v3.0.0 完成 **Agent Runtime 升级**（R1-R3）：
- **R1 结构化审计** — 解析 opencode JSON 事件流，每次运行记录 sessionId / tokens / 成本 / 工具调用链；修复 Windows 下 npm shim 无法 spawn 的问题
- **R2 会话连续性** — 任务可配置 `fresh / continue / fork` 会话模式，Agent Loop 修复迭代自动 fork 上一轮会话（Agent 记得自己做过什么）
- **R3 Serve 实时运行时** — 可选 `opencode serve` 执行模式：实时输出流、权限审批对话框（允许一次/总是/拒绝）、运行中中止

## 快速开始

```bash
# 安装依赖 + 编译
npm install
npm run build

# CLI 使用
node packages/cli/dist/index.js init
node packages/cli/dist/index.js create my-task --schedule "0 9 * * *" --prompt "整理今日新闻"
node packages/cli/dist/index.js list
node packages/cli/dist/index.js run my-task
node packages/cli/dist/index.js scheduler start

# 启动桌面应用（开发模式）
npm run dev
```

## 桌面应用

v1.0.0 新增 `@sentinel/desktop` — 基于 Electron + React + Tailwind 的原生桌面客户端。

### 功能

| 功能 | 说明 |
|------|------|
| 任务列表 | 深色主题卡片式布局，状态指示器、调度信息、运行计数 |
| 任务详情 | 6 标签页：概览 / 文件树 / 输出文件 / 执行历史 / **实时** / OpenCode 配置 |
| 创建任务 | 模态对话框，支持名称/描述/项目目录/调度/Prompt/模型/权限/**会话模式** |
| Flow 画布 | SVG DAG 可视化：节点拖拽布局、条件边样式（失败红虚线）、节点编辑、断点恢复、克隆、**ai 节点内嵌定义** |
| 人工门禁 | manual 节点运行时挂起等待审批：卡片式通过/拒绝（备注注入下游）+ 系统通知（v3.1.0） |
| 流程导入/导出 | 流程定义导出为 YAML 文件 / 从文件导入（校验 + 重名自动改名）（v3.1.0） |
| 技能库 | 聚合所有任务/流程工作区的技能：编辑 SKILL.md、新建、删除、跨工作区复制（含附加文件）、导入导出 .md（v3.2.0） |
| 实时页签 | Serve 模式下：实时文本/推理/工具调用流、权限审批卡片、停止按钮（v3.0.0） |
| 运行审计 | 每次运行显示步数/tokens/成本、可展开的工具调用链（v3.0.0） |
| 调度器面板 | 一键启停，实时日志流（自动滚动 + 级别着色） |
| 设置面板 | 应用信息、数据目录、**运行模式切换（CLI / Serve 实时）**、快捷键参考 |
| 实时更新 | 任务状态变更、调度器日志通过 Electron IPC 实时推送 |

### 架构

```
┌─────────────────────────────────────────┐
│  Electron Main Process                  │
│  - TaskStore / Scheduler (直接调用 core) │
│  - IPC Handlers                         │
│  - sentinelEvents → webContents.send()       │
├─────────────────────────────────────────┤
│  Preload (contextBridge)                │
│  - ExposedAPI (类型安全 IPC 封装)        │
├─────────────────────────────────────────┤
│  Renderer (React + Tailwind)            │
│  - TaskList / TaskDetail / Scheduler    │
│  - useTasks / useScheduler hooks        │
│  - lib/api (IPC wrapper)                │
└─────────────────────────────────────────┘
```

### 开发 & 构建

```bash
# 开发模式（热重载）
npm run dev

# 构建
npm run build:desktop

# 打包安装程序
cd packages/desktop && npx electron-builder
```

## CLI 命令一览

| 命令 | 说明 |
|------|------|
| `init [dir]` | 初始化项目，创建 tasks/ 目录和全局配置 |
| `create <name>` | 创建新任务（--interactive 交互式创建） |
| `list` | 列出所有任务及状态、下次运行时间 |
| `run <name>` | 立即手动执行一次任务 |
| `delete <name>` | 删除任务（加 --force 跳过确认） |
| `scheduler start` | 启动调度守护进程 |
| `scheduler status` | 查看调度器状态 |
| `flow create/list/run/status/clone` | Flow 工作流管理（--input 传参、--resume 断点恢复） |

> **注意**: v1.0.0 移除了 `serve` 命令和 Web Dashboard，改用桌面应用。

## 任务配置 (task.yaml)

```yaml
name: daily-report
description: 每日报告
version: 1

schedule:
  type: cron              # cron | interval | once
  expr: "0 9 * * *"       # 每天 9:00
  timezone: Asia/Shanghai

execution:
  prompt: "分析今天的 git log，生成开发日报"
  model: ""               # 空 = 使用默认
  agent: default
  session: fresh          # fresh | continue | fork（v3.0.0 会话连续性）
  timeout: 600            # 超时秒数
  retry:
    max: 2                # 最大重试次数
    delay: 60             # 重试间隔秒数

agentLoop:                # 可选：执行 → 验证 → 修复迭代
  enabled: true
  maxIterations: 3
  maxTotalSeconds: 1800   # 整个循环的墙钟预算
  verification:
    type: command         # command（shell 校验）| llm（语义校验）
    command: "test -f output/daily.md"
    onFailure: iterate    # iterate | notify | stop

notify:                   # 可选
  on_success: webhook
  on_failure: webhook
  webhook_url: "https://..."
```

## Flow 工作流 (flow.yaml)

多个任务编排成 DAG：无依赖关系的节点自动并行，支持条件边、运行预算、断点恢复。

```yaml
name: daily-pipeline
version: 1

nodes:
  fetch:
    type: ai
    task: news-fetcher        # 引用模式：在已有任务的工作区执行
  summarize:                  # 内嵌模式：不引用任务，提示词即定义，
    type: ai                  # 在流程目录执行（v3.2.0）
    promptTemplate: "用三句话总结：{fetch.output}"
    needs: [fetch]
  analyze:
    type: ai
    task: news-analyzer
    needs: [summarize]
    promptTemplate: "基于上游输出：{summarize.output}，输出分析报告"
  notify:
    type: script
    needs:
      - node: analyze
        on: success           # 条件边：成功才走，失败走红色分支
    run: "cat analyze/report.md | curl -d @- https://hook..."
  fallback:
    type: script
    needs:
      - node: analyze
        on: failure
    run: "echo analyze failed"

maxTotalSeconds: 3600         # 整个 Flow 的墙钟预算
```

ai 节点两种形态（v3.2.0）：

- **引用模式**（`task: xxx`）：在已建任务的工作区执行，沿用该任务的技能与 OpenCode 配置——适合复用现成任务
- **内嵌模式**（无 `task`）：节点自带 `promptTemplate`（必填），在流程目录执行，流程级 `.opencode/skills/` 技能可用——适合流程专属的轻量步骤，不必先建任务

## 任务目录结构（一目录一任务，v3.2.0）

任务是**自包含的目录**：你选择的目录就是任务的家，task.yaml、运行历史、状态、`.opencode/`（技能/AGENTS.md/权限）全部住在里面，agent 执行时也以该目录为工作目录。Sentinel 数据目录只保存一份注册表（`tasks.json`：任务名 → 目录路径）。

```
你的目录/（创建任务时指定，可以是已有项目）/
├── task.yaml                    # 任务定义（调度 + prompt + 模型配置）
├── .status.json                 # 持久化状态
├── .history.json                # 执行历史记录
├── .opencode/
│   ├── opencode.json            # OpenCode 权限配置
│   ├── AGENTS.md                # 该任务专属的 agent 规则
│   └── skills/                  # 项目级 skills（OpenCode 自动加载）
│       └── my-skill/
│           └── SKILL.md
├── scripts/                     # 任务脚本
└── output/                      # 执行产物目录
    └── daily-2026-05-27.md
```

规则：

- 创建任务必须指定目录；同一个目录只能属于一个任务（防止两个任务互相覆盖）
- 删除任务时：数据目录里的旧式任务整个删除；你的目录里的任务只移除 Sentinel 元数据（task.yaml/.history.json/.status.json/.opencode/opencode.json），**你的其余文件一律保留**
- 升级兼容：旧版建在 `data/tasks/<名>/` 的任务自动认领进注册表，原地继续工作

## 项目结构

```
sentinel/
├── DESIGN.md                    # 详细设计文档
├── README.md                    # 本文件
├── package.json                 # npm workspaces 根
├── packages/
│   ├── core/                    # @sentinel/core 核心引擎
│   │   └── src/
│   │       ├── types.ts         # 类型定义
│   │       ├── events.ts        # 类型安全事件总线 (v1.0.0 新增)
│   │       ├── cron.ts          # Cron 解析
│   │       ├── task-store.ts    # 任务 CRUD + 持久化状态
│   │       ├── executor.ts      # OpenCode CLI 执行器（事件流解析/版本自适应）
│   │       ├── opencode-events.ts # JSON 事件流 → 结构化审计 (v3.0.0)
│   │       ├── opencode-server.ts # opencode serve 运行时 (v3.0.0)
│   │       ├── agent-loop.ts    # Agent Loop 引擎 (v2.0.0)
│   │       ├── verification.ts  # 双模式验证 (v2.0.0)
│   │       ├── runner.ts        # 共享执行路径（调度/手动/CLI 同语义）
│   │       ├── flow.ts          # Flow DAG 引擎 (v2.x)
│   │       ├── flow-store.ts    # Flow 持久化 + 克隆
│   │       ├── scheduler.ts     # 调度引擎（任务 + Flow）
│   │       └── opencode-config.ts # OpenCode 配置生成器
│   ├── cli/                     # @sentinel/cli 命令行
│   │   └── src/
│   │       ├── index.ts         # 入口
│   │       └── commands/        # 所有命令实现
│   └── desktop/                 # @sentinel/desktop 桌面应用 (v1.0.0 新增)
│       ├── src/
│       │   ├── main/            # Electron 主进程
│       │   ├── preload/         # Context Bridge
│       │   ├── renderer/        # React + Tailwind 前端
│       │   └── shared/          # IPC 类型定义
│       ├── electron.vite.config.ts
│       └── electron-builder.yml
└── tasks/examples/
    └── daily-news-summary/      # 示例任务
```

## v1.0.0 变更摘要

| 变更 | 说明 |
|------|------|
| 🆕 `@sentinel/desktop` | Electron + React + Tailwind 桌面应用 |
| 🗑️ `serve` 命令 | 移除 Web Dashboard，改用桌面应用 |
| 🆕 类型安全事件总线 | `sentinelEvents` (EventEmitter + 泛型) |
| 🆕 持久化状态 | `.status.json` 文件，崩溃恢复 `running → failed` |
| 🔒 路径遍历防护 | `isValidTaskName()` + `safeTaskPath()` |
| 🔒 命令注入防护 | `spawn()` 移除 `shell: true` |
| 🔒 输出文件读取防护 | IPC handler 中 `resolve() + startsWith()` 校验 |
| 🆕 IPC 类型共享 | `shared/ipc-types.ts` 单一信源 |

## v3.0.0 变更摘要

| 变更 | 说明 |
|------|------|
| 🆕 结构化运行审计 | 每次运行记录 sessionId / tokens / 成本 / 步数 / 工具调用链 |
| 🆕 会话连续性 | `session: fresh/continue/fork`，跨运行继承上下文；修复迭代自动 fork |
| 🆕 Serve 实时运行时 | 设置切换运行模式；实时页签（输出流/权限审批/停止按钮） |
| 🔒 权限 fail-closed | 无人值守时权限请求自动拒绝；serve 模式 120s 无响应同样拒绝 |
| 🐛 Windows 修复 | 解析 npm `.cmd` shim 找到原生 exe（此前 spawn ENOENT，任务无法启动） |
| 🐛 LLM 验证误判修复 | 验证正则不再匹配原始 JSON 元数据，只匹配助手回答文本 |
| 🆕 opencode 1.18 适配 | 版本自适应 `--auto` / 旧 flag |
| 🆕 技能加载修复 | 移除不存在的 `--skill` 参数，技能由工作区 `.opencode/` 自动加载 |

## 依赖说明

| 包 | 依赖 | 用途 |
|---|---|---|
| `@sentinel/core` | cron-parser, yaml | cron 调度 + YAML 读写 + 事件系统 |
| `@sentinel/cli` | commander, chalk, yaml | CLI 工具 |
| `@sentinel/desktop` | electron, react, tailwindcss, lucide-react | 桌面客户端 |

## 配合 OpenCode

Sentinel 依赖你本地已安装的 [OpenCode](https://opencode.ai)。确保 `opencode` 在 PATH 中可用：

```bash
opencode --version   # 确认已安装
```

每个任务的 prompt 和 skills 会透传给 OpenCode，由 LLM 在任务目录的上下文中执行。

## 任务流程图

```
                          ┌─────────────────┐
                          │  sentinel create     │
                          │  创建任务        │
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │   task.yaml     │
                          │   + .opencode/  │  ← skills, AGENTS.md
                          │   (任务目录)     │
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │   状态: pending  │
                          └────────┬────────┘
                                   │
                                   │ sentinel scheduler start
                                   ▼
                    ┌──────────────────────────┐
                    │     调度器 每分钟扫描      │
                    │   ┌──────────────────┐   │
                    │   │ cron 匹配?        │   │
                    │   │ shouldRunNow()   │   │
                    │   └───┬──────────┬───┘   │
                    │     No│         │Yes     │
                    │       │         ▼        │
                    │   跳过 ◄    ┌────────────────┐
                    │            │ 状态: running   │
                    │            └───────┬────────┘
                    │                    │
                    └────────────────────┼───────┘
                                         │
                                ┌────────▼────────┐
                                │   opencode run   │
                                │   --dir <taskdir> │
                                │   --auto (1.18+) │
                                │   --format json  │
                                │   "<prompt>"     │
                                └────────┬────────┘
                                         │
                              ┌──────────┴──────────┐
                              │                     │
                         exit 0                  exit ≠0
                              │                     │
                    ┌─────────▼────────┐  ┌────────▼────────┐
                    │  状态: success   │  │  状态: failed    │
                    │  记录输出文件     │  │  retry? ──Yes──▶│
                    └─────────┬────────┘  └────────┬────────┘
                              │                    │ retry耗尽
                              │           ┌────────▼────────┐
                              │           │  状态: failed    │
                              │           │  写入 .status.json│
                              │           └────────┬────────┘
                              │                    │
                         ┌────▼────────────────────▼────┐
                         │      下一次 cron 时间到       │
                         │      再次触发 (循环)          │
                         └──────────────────────────────┘
```
