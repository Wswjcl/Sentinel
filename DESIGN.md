# WWC - AI Task Scheduler Design Document

## 项目概述

WWC 是一个基于 LLM 的定时任务调度系统。用户可以设置任务（每个任务是一个独立目录，包含 tools + project-level skills），系统在定时条件触发后，自动调用 OpenCode CLI 执行任务。

v1.0.0 重构为 **三包 monorepo**：`@wwc/core`（引擎）、`@wwc/cli`（命令行）、`@wwc/desktop`（Electron 桌面应用），移除了旧版 Web Dashboard。

### 核心理念

> 每个任务 = 一个独立的"项目目录" = OpenCode 的工作空间

任务目录内可以包含：
- `task.yaml` — 任务定义（调度规则、prompt、模型、Agent 等）
- `.opencode/skills/` — 该任务专属的 project-level skills
- `.opencode/AGENTS.md` — 该任务专属的 agent 规则
- `.opencode/opencode.json` — 权限和外部目录配置
- `.status.json` — 持久化任务状态（v1.0.0 新增）
- 其他文件/工具 — 任务需要的任何资源

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                 @wwc/desktop (Electron)                 │
│  ┌──────────────────┐  ┌─────────────────────────────┐  │
│  │  Main Process    │  │  Renderer (React+Tailwind)  │  │
│  │  - TaskStore     │  │  - TaskList / TaskDetail    │  │
│  │  - Scheduler     │  │  - SchedulerPanel           │  │
│  │  - IPC Handlers  │  │  - SettingsPanel            │  │
│  │  - Event Forward │  │  - Hooks (useTasks, etc.)   │  │
│  └────────┬─────────┘  └──────────┬──────────────────┘  │
│           │ contextBridge          │                      │
│           └──── ExposedAPI ────────┘                      │
├─────────────────────────────────────────────────────────┤
│                   @wwc/cli (Commander.js)                │
│  ┌───────────┐ ┌──────────┐ ┌────────────────┐         │
│  │ task add  │ │task list │ │ scheduler start│         │
│  └───────────┘ └──────────┘ └────────────────┘         │
├─────────────────────────────────────────────────────────┤
│                   @wwc/core (Engine)                     │
│  ┌────────────┐ ┌────────────┐ ┌─────────────┐         │
│  │ TaskStore  │ │ Scheduler  │ │  Executor   │         │
│  │ (CRUD+状态)│ │ (Cron)     │ │ (opencode)  │         │
│  └────────────┘ └────────────┘ └─────────────┘         │
│  ┌────────────┐ ┌────────────────────────────┐         │
│  │  wwcEvents │ │  OpenCode Config Generator │         │
│  │ (EventBus) │ │  (permissions/skills)      │         │
│  └────────────┘ └────────────────────────────┘         │
├─────────────────────────────────────────────────────────┤
│                   Task Directories                       │
│  tasks/                                                  │
│  ├── daily-summary/                                      │
│  │   ├── task.yaml                                       │
│  │   ├── .status.json                                    │
│  │   ├── .opencode/                                      │
│  │   │   ├── opencode.json                               │
│  │   │   ├── skills/news-digest/SKILL.md                 │
│  │   │   └── AGENTS.md                                   │
│  │   └── output/                                         │
│  └── ...                                                 │
└─────────────────────────────────────────────────────────┘
```

## 任务生命周期

```
create → pending → scheduled → running → success/failed → archived
  │                                      │
  └──────────────────────────────────────┘ (重调度/retry)
```

## 核心数据模型

### task.yaml 定义

```yaml
name: daily-news-summary
description: 每天早上9点整理AI新闻摘要
version: 1

schedule:
  type: cron
  expr: "0 9 * * *"
  timezone: Asia/Shanghai

execution:
  prompt: |
    请浏览今天的 AI/科技新闻，整理一份中文摘要。
  model: anthropic/claude-sonnet-4
  agent: default
  timeout: 600
  retry:
    max: 3
    delay: 60

notify:
  on_success: webhook
  on_failure: webhook
  webhook_url: "https://hooks.example.com/..."
```

### 任务状态机

```
states:
  - pending     # 已创建，等待首次调度
  - scheduled   # 已进入调度循环
  - running     # 正在执行
  - success     # 执行成功
  - failed      # 执行失败 (可重试)
  - paused      # 已暂停
  - archived    # 已归档
```

### 持久化状态（v1.0.0 新增）

任务状态通过 `.status.json` 文件持久化到磁盘，格式：

```json
{
  "status": "running",
  "updatedAt": "2026-06-26T09:00:01.000Z"
}
```

**启动恢复**：`TaskStore.init()` 调用 `recoverStates()`，将所有 orphaned `running` 状态重置为 `failed`（因为调度器未运行时不可能有正在执行的任务）。

## 事件系统（v1.0.0 新增）

`wwcEvents` 是类型安全的全局事件总线，基于 Node.js `EventEmitter` + 泛型：

```typescript
interface WWCEventMap {
  'task:status-changed': { name: string; status: TaskStatus }
  'task:run-started': { name: string; record: TaskRunRecord }
  'task:run-completed': { name: string; record: TaskRunRecord }
  'scheduler:log': { level: string; msg: string }
  'scheduler:started': undefined
  'scheduler:stopped': undefined
}
```

Electron 主进程订阅这些事件，通过 `webContents.send()` 转发到渲染进程。

## 调度引擎

### Cron 支持
- 标准 5 字段 cron 表达式 (`min hour dom month dow`)
- 时区感知
- 秒级精度（每分钟轮询一次调度表）

### 调度策略
1. 每分钟扫描所有 active 任务
2. 匹配 cron 表达式，找出"应该此刻运行"的任务
3. 去重：使用 `last_run` 时间戳防止重复触发
4. 并发控制：限制同时运行的任务数（默认 3）
5. 每次重试尝试都记录到历史中

## 执行器 (OpenCode 调用)

### 执行流程

```
1. 锁定任务 (status → running, 写入 .status.json)
2. 验证任务目录存在
3. 构建 opencode 命令:
   opencode run --dir <task-dir> --model <model> --dangerously-skip-permissions "<prompt>"
4. spawn() 执行（无 shell: true，防止命令注入）
5. 捕获 stdout + stderr
6. 等待进程完成或超时
7. 记录执行结果 (写入 .history.json)
8. 更新持久化状态 (.status.json)
9. 触发 wwcEvents 通知
```

### 安全防护

| 防护 | 实现 |
|------|------|
| 路径遍历 | `isValidTaskName()` 正则校验 + `safeTaskPath()` resolve+startsWith |
| 命令注入 | `spawn()` 不使用 `shell: true` |
| 输出文件读取 | IPC handler 中 `resolve() + startsWith()` 校验 |
| 崩溃恢复 | 启动时自动将 orphaned `running` → `failed` |

## Electron 桌面应用架构

### 进程模型

```
Main Process (Node.js)
  ├── TaskStore + Scheduler (直接 @wwc/core)
  ├── IPC Handlers (ipcMain.handle)
  ├── Event Forwarding (wwcEvents → webContents.send)
  └── Window Management (frameless + titleBarOverlay)

Preload (contextBridge)
  └── ExposedAPI (类型安全的 IPC 调用 + 事件监听)

Renderer (Chromium)
  ├── React 19 + Tailwind v4
  ├── Components: TaskList, TaskDetail, SchedulerPanel, SettingsPanel
  ├── Hooks: useTasks, useScheduler
  └── lib/api: IPC wrapper
```

### IPC 通道设计

通道名定义在 `shared/ipc-types.ts`，作为单一信源：

```typescript
export const IPC = {
  TASKS_LIST: 'tasks:list',
  TASKS_CREATE: 'tasks:create',
  TASKS_RUN: 'tasks:run',
  SCHEDULER_START: 'scheduler:start',
  EVENT_TASK_UPDATE: 'event:task-update',
  EVENT_SCHEDULER_LOG: 'event:scheduler-log',
  // ...
} as const
```

- **请求/响应**：`ipcMain.handle()` / `ipcRenderer.invoke()`
- **事件推送**：`webContents.send()` / `ipcRenderer.on()`
- 事件监听返回 cleanup 函数，防止内存泄漏

### 渲染进程组件

| 组件 | 功能 |
|------|------|
| `TaskList` | 可搜索的任务卡片网格 + "New Task" 按钮 |
| `TaskCard` | 状态指示器、调度信息、相对时间、运行计数 |
| `TaskDetail` | 5 标签页详情视图 |
| `CreateTaskDialog` | 模态创建表单 |
| `SchedulerPanel` | 启停控制 + 实时日志流 |
| `SettingsPanel` | 应用信息 + 快捷键参考 |

## CLI 命令

```bash
wwc init                    # 初始化项目
wwc create <name>           # 交互式创建新任务
wwc list                    # 列出所有任务
wwc run <name>              # 立即执行一次任务
wwc delete <name>           # 删除任务
wwc scheduler start         # 启动调度守护进程
wwc scheduler status        # 查看调度器状态
```

## 项目目录结构

```
wwc/
├── DESIGN.md
├── README.md
├── package.json                 # npm workspaces 根
├── packages/
│   ├── core/                    # @wwc/core
│   │   └── src/
│   │       ├── types.ts         # 类型定义
│   │       ├── events.ts        # 类型安全事件总线
│   │       ├── cron.ts          # cron 解析
│   │       ├── task-store.ts    # 任务 CRUD + 持久化状态
│   │       ├── executor.ts      # opencode 执行器
│   │       ├── scheduler.ts     # 调度引擎
│   │       └── opencode-config.ts
│   ├── cli/                     # @wwc/cli
│   │   └── src/
│   │       ├── index.ts
│   │       └── commands/
│   └── desktop/                 # @wwc/desktop (v1.0.0)
│       ├── src/
│       │   ├── main/            # Electron 主进程
│       │   ├── preload/         # Context Bridge
│       │   ├── renderer/src/    # React 前端
│       │   │   ├── components/
│       │   │   │   ├── layout/  # MainLayout, Sidebar, TitleBar
│       │   │   │   ├── tasks/   # TaskList, TaskCard, TaskDetail, CreateTaskDialog
│       │   │   │   ├── scheduler/ # SchedulerPanel
│       │   │   │   └── settings/ # SettingsPanel
│       │   │   ├── hooks/       # useTasks, useScheduler
│       │   │   ├── lib/         # api.ts (IPC wrapper)
│       │   │   └── App.tsx
│       │   └── shared/          # ipc-types.ts
│       ├── electron.vite.config.ts
│       └── electron-builder.yml
└── tasks/examples/
    └── daily-news-summary/
```

## 技术选型

| 组件 | 技术 | 说明 |
|------|------|------|
| 语言 | TypeScript | 全栈类型安全 |
| 运行时 | Node.js 18+ | |
| CLI 框架 | Commander.js | 命令行解析 |
| Cron 解析 | cron-parser | 标准 cron 表达式 |
| 配置格式 | YAML | task.yaml |
| 进程管理 | child_process.spawn | 调用 opencode CLI (无 shell) |
| 桌面框架 | Electron 34 | 原生窗口 + Node.js 访问 |
| 前端 | React 19 + Tailwind v4 | 组件化 UI |
| 构建工具 | electron-vite 3 | 三配置 (main/preload/renderer) |
| 图标 | lucide-react | 轻量 SVG 图标库 |
| 包管理 | npm workspaces | monorepo |
