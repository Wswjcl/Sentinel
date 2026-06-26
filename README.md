# WWC — AI Task Scheduler

基于 OpenCode + LLM 的定时任务调度系统。每个任务 = 一个独立目录（含 tools + skills），定时触发后自动调用 OpenCode CLI 执行。

v1.0.0 带来 **Electron 桌面应用**，替代了之前的 Web Dashboard，提供原生窗口体验、实时事件推送和直接的核心引擎调用。

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

v1.0.0 新增 `@wwc/desktop` — 基于 Electron + React + Tailwind 的原生桌面客户端。

### 功能

| 功能 | 说明 |
|------|------|
| 任务列表 | 深色主题卡片式布局，状态指示器、调度信息、运行计数 |
| 任务详情 | 5 标签页：概览 / 文件树 / 输出文件 / 执行历史 / OpenCode 配置 |
| 创建任务 | 模态对话框，支持名称/描述/项目目录/调度/Prompt/模型 |
| 调度器面板 | 一键启停，实时日志流（自动滚动 + 级别着色） |
| 设置面板 | 应用信息、数据目录、快捷键参考 |
| 实时更新 | 任务状态变更、调度器日志通过 Electron IPC 实时推送 |

### 架构

```
┌─────────────────────────────────────────┐
│  Electron Main Process                  │
│  - TaskStore / Scheduler (直接调用 core) │
│  - IPC Handlers                         │
│  - wwcEvents → webContents.send()       │
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
  timeout: 600            # 超时秒数
  retry:
    max: 2                # 最大重试次数
    delay: 60             # 重试间隔秒

notify:                   # 可选
  on_success: webhook
  on_failure: webhook
  webhook_url: "https://..."
```

## 任务目录结构

```
tasks/my-task/
├── task.yaml                    # 任务定义（调度 + prompt + 模型配置）
├── .status.json                 # 持久化状态（v1.0.0 新增）
├── .opencode/
│   ├── opencode.json            # OpenCode 权限配置
│   ├── AGENTS.md                # 该任务专属的 agent 规则
│   └── skills/                  # 项目级 skills（OpenCode 自动加载）
│       └── my-skill/
│           └── SKILL.md
├── scripts/                     # 任务脚本
└── output/                      # 执行产物目录
    ├── daily-2026-05-27.md
    └── .history.json            # 执行历史记录
```

## 项目结构

```
wwc/
├── DESIGN.md                    # 详细设计文档
├── README.md                    # 本文件
├── package.json                 # npm workspaces 根
├── packages/
│   ├── core/                    # @wwc/core 核心引擎
│   │   └── src/
│   │       ├── types.ts         # 类型定义
│   │       ├── events.ts        # 类型安全事件总线 (v1.0.0 新增)
│   │       ├── cron.ts          # Cron 解析
│   │       ├── task-store.ts    # 任务 CRUD + 持久化状态
│   │       ├── executor.ts      # OpenCode 执行器
│   │       ├── scheduler.ts     # 调度引擎
│   │       └── opencode-config.ts # OpenCode 配置生成器
│   ├── cli/                     # @wwc/cli 命令行
│   │   └── src/
│   │       ├── index.ts         # 入口
│   │       └── commands/        # 所有命令实现
│   └── desktop/                 # @wwc/desktop 桌面应用 (v1.0.0 新增)
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
| 🆕 `@wwc/desktop` | Electron + React + Tailwind 桌面应用 |
| 🗑️ `serve` 命令 | 移除 Web Dashboard，改用桌面应用 |
| 🆕 类型安全事件总线 | `wwcEvents` (EventEmitter + 泛型) |
| 🆕 持久化状态 | `.status.json` 文件，崩溃恢复 `running → failed` |
| 🔒 路径遍历防护 | `isValidTaskName()` + `safeTaskPath()` |
| 🔒 命令注入防护 | `spawn()` 移除 `shell: true` |
| 🔒 输出文件读取防护 | IPC handler 中 `resolve() + startsWith()` 校验 |
| 🆕 IPC 类型共享 | `shared/ipc-types.ts` 单一信源 |

## 依赖说明

| 包 | 依赖 | 用途 |
|---|---|---|
| `@wwc/core` | cron-parser, yaml | cron 调度 + YAML 读写 + 事件系统 |
| `@wwc/cli` | commander, chalk, yaml | CLI 工具 |
| `@wwc/desktop` | electron, react, tailwindcss, lucide-react | 桌面客户端 |

## 配合 OpenCode

WWC 依赖你本地已安装的 [OpenCode](https://opencode.ai)。确保 `opencode` 在 PATH 中可用：

```bash
opencode --version   # 确认已安装
```

每个任务的 prompt 和 skills 会透传给 OpenCode，由 LLM 在任务目录的上下文中执行。

## 任务流程图

```
                          ┌─────────────────┐
                          │  wwc create     │
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
                                   │ wwc scheduler start
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
                                │   --dangerously- │
                                │   skip-permissions│
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
