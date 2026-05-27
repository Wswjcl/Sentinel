# WWC — AI Task Scheduler

基于 OpenCode + LLM 的定时任务调度系统。每个任务 = 一个独立目录（含 tools + skills），定时触发后自动调用 OpenCode CLI 执行。

## 快速开始

```bash
# 安装依赖 + 编译
npm install
npm run build

# 初始化项目（创建 tasks/ 目录和配置）
node packages/cli/dist/index.js init

# 创建第一个任务
node packages/cli/dist/index.js create my-task --schedule "0 9 * * *" --prompt "整理今日新闻"

# 列出所有任务
node packages/cli/dist/index.js list

# 手动执行一次
node packages/cli/dist/index.js run my-task

# 启动调度器（守护进程）
node packages/cli/dist/index.js scheduler start     # 按 Ctrl+C 停止

# 启动 Web Dashboard
node packages/cli/dist/index.js serve --port 3456   # 按 Ctrl+C 停止
```

## 关闭服务

### 调度器 (scheduler start)
在终端按 **`Ctrl + C`** 即可停止。

### Web Dashboard (serve)
在终端按 **`Ctrl + C`** 即可停止。

### 强制关闭（如果 Ctrl+C 无效）
```bash
# Windows PowerShell — 结束所有 wwc 相关 node 进程
Get-Process -Name node | Where-Object { $_.CommandLine -like "*wwc*" } | Stop-Process -Force

# 或者杀掉占用指定端口的进程
netstat -ano | findstr :3456      # 找到 PID
taskkill /PID <PID> /F
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `init [dir]` | 初始化项目，创建 tasks/ 目录和全局配置 |
| `create <name>` | 创建新任务（--interactive 交互式创建） |
| `list` | 列出所有任务及状态、下次运行时间 |
| `run <name>` | 立即手动执行一次任务 |
| `delete <name>` | 删除任务（加 --force 跳过确认） |
| `scheduler start` | 启动调度守护进程 |
| `scheduler status` | 查看调度器状态 |
| `serve` | 启动 Web Dashboard |

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
├── .opencode/
│   ├── AGENTS.md                # 该任务专属的 agent 规则
│   └── skills/                  # 项目级 skills（OpenCode 自动加载）
│       └── my-skill/
│           └── SKILL.md
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
│   │       ├── cron.ts          # Cron 解析
│   │       ├── task-store.ts    # 任务 CRUD (YAML)
│   │       ├── executor.ts      # OpenCode 执行器
│   │       └── scheduler.ts     # 调度引擎
│   └── cli/                     # @wwc/cli 命令行 + Web
│       └── src/
│           ├── index.ts         # 入口
│           ├── commands/        # 所有命令实现
│           │   ├── init.ts
│           │   ├── create.ts
│           │   ├── list.ts
│           │   ├── run.ts
│           │   ├── delete.ts
│           │   ├── scheduler.ts
│           │   └── serve.ts     # Web Dashboard
│           └── web/
│               └── dashboard.html
└── tasks/examples/
    └── daily-news-summary/      # 示例任务
        ├── task.yaml
        └── .opencode/
            ├── AGENTS.md
            └── skills/news-digest/SKILL.md
```

## 依赖说明

| 包 | 依赖 | 用途 |
|---|---|---|
| `@wwc/core` | cron-parser, yaml | cron 调度 + YAML 读写 |
| `@wwc/cli` | commander, chalk, express, cors | CLI + Web Dashboard |

npm workspaces 自动管理项目级依赖隔离，根目录 `npm install` 一步到位。

## Web Dashboard（可视化界面）

WWC 内置 Web 管理面板，提供任务的可视化管理。

### 启动

```bash
node packages/cli/dist/index.js serve --port 3456 --tasks-dir tasks/examples
```

打开浏览器访问 `http://localhost:3456`。

### 界面功能

| 功能 | 说明 |
|------|------|
| 任务列表 | 深色主题卡片式布局，显示状态圆点、cron 表达式、下次运行时间 |
| 一键执行 | 每个任务卡片上点 **Run** 立即手动触发 |
| 展开详情 | 点击任务卡片展开：完整配置、prompt 预览、执行历史表格 |
| 创建任务 | 右上角 **+ New Task** 弹窗创建，填写名称/描述/cron/prompt/模型 |
| 调度器控制 | 顶部 **Start/Stop** 一键启停调度守护进程 |
| 实时日志 | 底部日志面板，调度器运行日志通过 SSE 实时推送 |
| 自动刷新 | 任务状态变更（触发/完成/失败）时页面自动更新，无需手动刷新 |

### REST API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 + 调度器状态 |
| `GET` | `/api/events` | SSE 实时事件流 |
| `GET` | `/api/tasks` | 列出所有任务及状态 |
| `GET` | `/api/tasks/:name` | 查看单个任务详情 |
| `POST` | `/api/tasks` | 创建新任务 (JSON body) |
| `DELETE` | `/api/tasks/:name` | 删除任务 |
| `POST` | `/api/tasks/:name/run` | 立即执行任务 |
| `GET` | `/api/tasks/:name/history` | 执行历史 |
| `GET` | `/api/tasks/:name/output` | 最新执行输出 |
| `GET` | `/api/tasks/:name/opencode` | 查看任务的 opencode.json 权限配置 |
| `GET` | `/api/scheduler` | 调度器运行状态 |
| `POST` | `/api/scheduler/start` | 启动调度器 |
| `POST` | `/api/scheduler/stop` | 停止调度器 |

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
                              │           │  触发失败通知     │
                              │           └────────┬────────┘
                              │                    │
                         ┌────▼────────────────────▼────┐
                         │      下一次 cron 时间到       │
                         │      再次触发 (循环)          │
                         └──────────────────────────────┘
```

### 核心判断逻辑

```
shouldRunNow(cron表达式, 上次运行时间)
  ├── 解析 cron 表达式 → 获取 prev (上一个触发点)
  ├── lastRun == null  →  首次运行，prev 已过 → 触发
  ├── now >= prev && lastRun < prev → 触发
  └── 否则 → 跳过
```

### Web Dashboard 页面结构

```
┌─────────────────────────────────────────────────────────┐
│  ◉ WWC AI Scheduler    Scheduler: ● Running  [Stop] [+New] │
├─────────────────────────────────────────────────────────┤
│  Tasks (3 tasks)                                        │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ● daily-news-summary  ⏰ 0 9 * * *  ▶ 05/28 09:00 │ Run│Del│
│  │   每天整理AI/科技新闻          5 runs            │    │
│  ├─────────────────────────────────────────────────┤    │
│  │  [展开详情] Schedule | Prompt | History Table   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ○ weekly-report       ⏰ 0 10 * * 1  ▶ 06/01 10:00 │ Run│Del│
│  └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│  [INFO] 09:00:01 Triggering task: daily-news-summary    │
│  [INFO] 09:03:45 Task completed successfully           │
└─────────────────────────────────────────────────────────┘
```
