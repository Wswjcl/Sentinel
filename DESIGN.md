# WWC - AI Task Scheduler Design Document

## 项目概述

WWC 是一个基于 LLM 的定时任务调度系统。用户可以设置任务（每个任务是一个独立目录，包含 tools + project-level skills），系统在定时条件触发后，自动调用 OpenCode ACP/CLI 执行任务。

### 核心理念

> 每个任务 = 一个独立的"项目目录" = OpenCode 的工作空间

任务目录内可以包含：
- `task.yaml` — 任务定义（调度规则、prompt、模型、Agent 等）
- `.opencode/skills/` — 该任务专属的 project-level skills
- `.opencode/AGENTS.md` — 该任务专属的 agent 规则
- 其他文件/工具 — 任务需要的任何资源

## 系统架构

```
┌─────────────────────────────────────────────────┐
│                    WWC CLI                        │
│  ┌───────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ task add  │ │task list │ │ scheduler start│  │
│  └───────────┘ └──────────┘ └────────────────┘  │
├─────────────────────────────────────────────────┤
│                  Core Engine                      │
│  ┌────────────┐ ┌────────────┐ ┌─────────────┐  │
│  │ Task Store │ │ Scheduler  │ │  Executor   │  │
│  │ (CRUD)     │ │ (Cron)     │ │ (opencode)  │  │
│  └────────────┘ └────────────┘ └─────────────┘  │
│  ┌────────────┐ ┌────────────────────────────┐  │
│  │  Logger    │ │  Notifier (webhook/email)  │  │
│  └────────────┘ └────────────────────────────┘  │
├─────────────────────────────────────────────────┤
│               Task Directories                    │
│  tasks/                                           │
│  ├── daily-summary/                               │
│  │   ├── task.yaml                                │
│  │   ├── .opencode/                               │
│  │   │   ├── skills/news-digest/SKILL.md          │
│  │   │   └── AGENTS.md                            │
│  │   └── data/                                    │
│  ├── code-review/                                 │
│  │   ├── task.yaml                                │
│  │   └── .opencode/skills/                        │
│  └── ...                                          │
└─────────────────────────────────────────────────┘
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
# task.yaml
name: daily-news-summary
description: 每天早上9点整理AI新闻摘要
version: 1

# 调度配置
schedule:
  type: cron          # cron | interval | once
  expr: "0 9 * * *"   # cron 表达式
  timezone: Asia/Shanghai

# 执行配置
execution:
  prompt: |
    请浏览今天的 AI/科技新闻，整理一份中文摘要。
    提取 5-10 条最重要的新闻，每条用 2-3 句话概括。
    输出格式为 markdown，保存到 output/daily-$(date).md
  model: anthropic/claude-sonnet-4    # 可选，默认继承全局配置
  agent: default                      # 可选，使用的 agent
  skills:                             # 自动加载的 skills
    - news-digest
    - markdown-writer
  timeout: 600                        # 超时时间(秒)
  retry:
    max: 3
    delay: 60

# 通知 (可选)
notify:
  on_success: webhook  # 成功时通知
  on_failure: webhook  # 失败时通知
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

## 执行器 (OpenCode 调用)

### 执行流程

```
1. 锁定任务 (status → running)
2. 验证任务目录存在，skill 文件完整
3. 构建 opencode 命令:
   opencode run \
     --dir <task-dir> \
     --model <model> \
     --agent <agent> \
     --dangerously-skip-permissions \
     "<prompt>"
4. 捕获 stdout/stderr 输出
5. 等待进程完成或超时
6. 记录执行结果 (logs, output files)
7. 更新任务状态、触发通知
```

### 执行日志

每个任务目录下有 `output/` 子目录存放执行产物：
```
tasks/daily-summary/output/
├── 2026-05-27.md          # 执行产出的文件
├── run-2026-05-27.log     # 执行日志
└── .history.json          # 执行历史记录
```

## CLI 命令

```bash
# 任务管理
wwc init                    # 初始化项目 (创建 tasks/ 目录 + 全局配置)
wwc create <name>           # 交互式创建新任务
wwc list                    # 列出所有任务
wwc show <name>             # 查看任务详情
wwc edit <name>             # 编辑 task.yaml
wwc delete <name>           # 删除任务
wwc pause <name>            # 暂停任务
wwc resume <name>           # 恢复任务

# 手动执行
wwc run <name>              # 立即执行一次任务
wwc run --dry <name>        # 预览命令(不实际执行)

# 调度器
wwc scheduler start         # 启动调度守护进程
wwc scheduler stop          # 停止调度器
wwc scheduler status        # 查看调度器状态
wwc scheduler logs          # 查看调度器日志

# 查看历史
wwc history [name]          # 查看任务执行历史
wwc output <name>           # 查看任务输出目录
```

## 目录结构

```
wwc/
├── DESIGN.md                    # 本设计文档
├── package.json                 # 根 package (monorepo)
├── tsconfig.json
├── packages/
│   ├── core/                    # @wwc/core
│   │   ├── src/
│   │   │   ├── task-store.ts    # 任务 CRUD
│   │   │   ├── scheduler.ts     # 调度引擎
│   │   │   ├── executor.ts      # opencode 执行器
│   │   │   ├── cron.ts          # cron 解析
│   │   │   ├── logger.ts        # 日志
│   │   │   └── types.ts         # 类型定义
│   │   └── package.json
│   └── cli/                     # @wwc/cli
│       ├── src/
│       │   ├── index.ts         # 入口
│       │   └── commands/
│       │       ├── create.ts
│       │       ├── list.ts
│       │       ├── run.ts
│       │       ├── scheduler.ts
│       │       └── ...
│       └── package.json
├── tasks/                       # 任务存储目录 (默认)
│   └── examples/                # 示例任务
│       └── daily-summary/
│           ├── task.yaml
│           └── .opencode/
│               ├── skills/
│               │   └── news-digest/
│               │       └── SKILL.md
│               └── AGENTS.md
└── wwc.config.yaml              # 全局配置
```

## 技术选型

| 组件 | 技术 | 说明 |
|------|------|------|
| 语言 | TypeScript | 与 opencode 生态一致 |
| 运行时 | Node.js 18+ | |
| CLI 框架 | Commander.js | 命令行解析 |
| Cron 解析 | cron-parser | 标准 cron 表达式 |
| 配置格式 | YAML | task.yaml 和全局配置 |
| 进程管理 | child_process | 调用 opencode CLI |
| 日志 | pino | 结构化日志 |
| 包管理 | pnpm workspaces | monorepo |


## 示例任务场景

### 场景 1: 每日新闻摘要
```
schedule: "0 9 * * *"  # 每天 9:00 AM
prompt: 整理今日 AI/科技新闻摘要
skills: [news-digest, markdown-writer]
```

### 场景 2: 代码仓库周报
```
schedule: "0 10 * * 1"  # 每周一 10:00 AM
prompt: 分析本周的 git log，生成开发周报
skills: [git-analyzer, report-generator]
```

### 场景 3: 定时数据备份检查
```
schedule: "0 */6 * * *"  # 每 6 小时
prompt: 检查数据库备份状态并报告
skills: [db-check, alert]
```

### 场景 4: PR Review 助手
```
schedule: "0 10,15 * * 1-5"  # 工作日 10:00 和 15:00
prompt: 检查待 review 的 PR，自动生成 review 意见
skills: [pr-review, code-analyzer]
```
