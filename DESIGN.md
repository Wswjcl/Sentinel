# Sentinel - Loop Engineering Platform Design Document

## 项目概述

Sentinel 是一个 **Loop Engineering Platform** —— 基于 AI Agent 的循环工程平台。核心理念来自 2026 年爆火的 Loop Engineering 概念：

> **Stop prompting the agent. Design the loop that does it for you.**

不再手动给 Agent 写 Prompt，而是设计一个系统，让 Agent 自主运行：**定时触发 → 执行 → 验证 → 修复迭代 → 经验沉淀 → 下次更聪明**。

用户可以设置任务（每个任务是一个独立目录，包含 tools + project-level skills），系统在定时条件触发后，自动调用 OpenCode CLI 执行任务，并通过 Agent Loop 验证和修复输出。

v1.0.0 重构为 **三包 monorepo**：`@sentinel/core`（引擎）、`@sentinel/cli`（命令行）、`@sentinel/desktop`（Electron 桌面应用），移除了旧版 Web Dashboard。

v2.0.0 引入 **Loop Engineering**：Agent Loop 闭环、双模式验证、迭代修复。

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
│                 @sentinel/desktop (Electron)                 │
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
│                   @sentinel/cli (Commander.js)                │
│  ┌───────────┐ ┌──────────┐ ┌────────────────┐         │
│  │ task add  │ │task list │ │ scheduler start│         │
│  └───────────┘ └──────────┘ └────────────────┘         │
├─────────────────────────────────────────────────────────┤
│                   @sentinel/core (Engine)                     │
│  ┌────────────┐ ┌────────────┐ ┌─────────────┐         │
│  │ TaskStore  │ │ Scheduler  │ │  Executor   │         │
│  │ (CRUD+状态)│ │ (Cron)     │ │ (opencode)  │         │
│  └────────────┘ └────────────┘ └─────────────┘         │
│  ┌────────────┐ ┌────────────────────────────┐         │
│  │  sentinelEvents │ │  OpenCode Config Generator │         │
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

**启动恢复**：`TaskStore.init()` 先加载目录注册表，再调用 `recoverStates()`，将所有 orphaned `running` 状态重置为 `failed`（因为调度器未运行时不可能有正在执行的任务）。

### 目录注册表（v3.2.0："一目录一任务"）

任务的真实工作区是用户创建时指定的目录；数据目录只保存注册表 `tasks.json`（`{ version, tasks: { <名>: <绝对目录> } }`）。

| 机制 | 说明 |
|------|------|
| 注册 | `createTask(name, dir)` 校验任务名唯一 + 目录唯一（Windows 下大小写不敏感），拒绝以数据 tasks 目录本身作为工作区 |
| 认领 | `init()` 扫描 `tasksDir/<名>` 下含 task.yaml 的旧式任务，原址认领进注册表（升级零迁移） |
| 回退 | 未注册名称的 `getTaskDir` 回退 `tasksDir/<名>`（测试/直接写盘的兼容路径） |
| 删除 | 工作区在数据目录内 → 整目录删除（旧行为）；用户目录 → 只删 task.yaml/.history.json/.status.json/.opencode/opencode.json，其余文件保留 |
| 执行 | executor `--dir`、serve 会话目录、文件树/技能/输出浏览全部经注册表指向真实目录；桌面端与 CLI 的创建路径统一走 `createTask`（修复旧版"配置在数据目录、骨架在项目目录"的脱节） |

## 事件系统（v1.0.0 新增）

`sentinelEvents` 是类型安全的全局事件总线，基于 Node.js `EventEmitter` + 泛型：

```typescript
interface SentinelEventMap {
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
9. 触发 sentinelEvents 通知
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
  ├── TaskStore + Scheduler (直接 @sentinel/core)
  ├── IPC Handlers (ipcMain.handle)
  ├── Event Forwarding (sentinelEvents → webContents.send)
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
sentinel init                    # 初始化项目
sentinel create <name>           # 交互式创建新任务
sentinel list                    # 列出所有任务
sentinel run <name>              # 立即执行一次任务
sentinel delete <name>           # 删除任务
sentinel scheduler start         # 启动调度守护进程
sentinel scheduler status        # 查看调度器状态
```

## 项目目录结构

```
sentinel/
├── DESIGN.md
├── README.md
├── package.json                 # npm workspaces 根
├── packages/
│   ├── core/                    # @sentinel/core
│   │   └── src/
│   │       ├── types.ts         # 类型定义
│   │       ├── events.ts        # 类型安全事件总线
│   │       ├── cron.ts          # cron 解析
│   │       ├── task-store.ts    # 任务 CRUD + 持久化状态
│   │       ├── executor.ts      # opencode 执行器
│   │       ├── scheduler.ts     # 调度引擎
│   │       └── opencode-config.ts
│   ├── cli/                     # @sentinel/cli
│   │   └── src/
│   │       ├── index.ts
│   │       └── commands/
│   └── desktop/                 # @sentinel/desktop (v1.0.0)
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

## Loop Engineering（v2.0.0 新增）

### 概念映射

Loop Engineering 的六大构件与 Sentinel 的对应关系：

| Loop Engineering 构件 | Sentinel 实现 | 状态 |
|---|---|---|
| **Skills**（Agent 能做什么） | `.opencode/skills/` 目录 | ✅ 已有 |
| **State**（Agent 记住什么） | `.status.json` + `.history.json` | ✅ 已有 |
| **Schedule**（何时触发） | Cron + Interval + Once 调度器 | ✅ 已有 |
| **Budget**（Token/成本限制） | timeout + retry 上限 | ✅ 已有 |
| **Verification**（如何验证结果） | `verification.ts` 双模式验证器 | ✅ v2.0 新增 |
| **Agent Loop**（观察→验证→修复→迭代） | `agent-loop.ts` 闭环引擎 | ✅ v2.0 新增 |
| **Memory**（跨循环学习） | 待实现（v2.1 计划） | 🔜 后续迭代 |

### Agent Loop 闭环流程

```
触发 (Schedule)
  │
  ▼
执行 OpenCode (iteration 0, 原始 prompt)
  │
  ▼
验证 (Verification)
  │
  ├─ 通过 ──→ 记录结果 → 成功结束
  │
  └─ 失败 ──→ 根据 onFailure 策略:
                ├─ stop    → 停止迭代，标记失败
                ├─ notify  → 发送通知 + 继续迭代
                └─ iterate → 构造修复 prompt → 再次执行 (iteration 1)
                              │
                              ▼
                           执行 OpenCode (修复 prompt)
                              │
                              ▼
                           验证 → ... (最多 maxIterations 轮)
```

### 双模式验证

#### Command 模式（零 LLM 成本，速度快）

在任务目录下执行 shell 命令，exit code 0 = 验证通过。

```yaml
agentLoop:
  enabled: true
  maxIterations: 3
  verification:
    type: command
    command: "test -f output/result.md && grep -q '^##' output/result.md"
    onFailure: iterate
```

适用场景：检查文件是否存在、运行测试、验证输出格式、检查关键字。

#### LLM 模式（语义验证，更智能）

调用 OpenCode 用 LLM 对输出进行语义验证。

```yaml
agentLoop:
  enabled: true
  maxIterations: 3
  verification:
    type: llm
    criteria: |
      - 摘要是否覆盖了主要新闻
      - 每条新闻是否有标题和关键信息
      - 格式是否为 Markdown
    skill: verify-output    # 可选：指定验证 skill
    onFailure: iterate
```

适用场景：内容质量检查、语义完整性验证、格式语义检查。

### task.yaml 完整配置（Loop Engineering）

```yaml
name: daily-news-summary
description: 每天早上9点整理AI/科技新闻摘要
version: 2

schedule:
  type: cron
  expr: "0 9 * * *"
  timezone: Asia/Shanghai

execution:
  prompt: |
    请浏览今天的 AI/科技领域重要新闻，整理一份中文摘要。
  model: ""
  agent: default
  timeout: 600
  retry:
    max: 2
    delay: 60
  fixPromptTemplate: |
    上一次执行的验证未通过。
    验证反馈：{verification}
    上次输出摘要：{output}
    请根据反馈修复问题并重新生成。

# Loop Engineering 配置
agentLoop:
  enabled: true
  maxIterations: 3
  verification:
    type: command
    command: "test -f output/result.md"
    onFailure: iterate

notify:
  on_success: none
  on_failure: webhook
  webhook_url: ""
```

### 新增类型定义

```typescript
// Agent Loop 配置
interface AgentLoopConfig {
  enabled: boolean
  maxIterations?: number       // 默认 3
  verification: LoopVerification
}

// 验证配置
interface LoopVerification {
  type: 'command' | 'llm'
  command?: string             // command 模式的验证命令
  criteria?: string            // llm 模式的验证标准
  skill?: string               // llm 模式的验证 skill
  onFailure: 'iterate' | 'notify' | 'stop'
}

// 扩展 TaskExecution
interface TaskExecution {
  // ...existing fields...
  fixPromptTemplate?: string   // 修复 prompt 模板
}

// 扩展 TaskConfig
interface TaskConfig {
  // ...existing fields...
  agentLoop?: AgentLoopConfig
}

// 扩展 TaskRunRecord
interface TaskRunRecord {
  // ...existing fields...
  iteration?: number           // 第几轮迭代
  verificationPassed?: boolean // 验证是否通过
  verificationOutput?: string  // 验证结果信息
}
```

### 新增事件

```typescript
interface SentinelEventMap {
  // ...existing events...
  'loop:iteration-started': { name: string; iteration: number }
  'loop:iteration-completed': { name: string; iteration: number; passed: boolean }
  'loop:verification-failed': { name: string; iteration: number; verification: VerificationResult }
  'loop:completed': { name: string; success: boolean; iterations: number }
}
```

### 向后兼容

- `agentLoop` 是可选字段，不配置时行为与 v1.x 完全一致
- `fixPromptTemplate` 是可选字段，不配置时使用内置默认模板
- `promptOverride` 是 executor 的可选参数，不传时使用原始 prompt
- 新增事件不影响现有事件订阅
- `TaskRunRecord` 新增字段都是可选的

### 后续迭代计划

| 版本 | 功能 | 说明 |
|------|------|------|
| v2.1 | Cross-Loop Memory | 跨循环记忆：每次执行的经验自动提取并注入下次 Prompt |
| v2.2 | Loop Patterns | 内置 7 种标准 Loop Pattern（PR Babysitter、Daily Triage 等） |
| v2.3 | Loop Audit | Loop Ready 评分系统，量化任务的 Loop 工程成熟度 |
| v2.4 | Loop Cost | Token/成本追踪与预算控制 |

---

## Flow Engineering（v2.x 新增）

将多个任务节点编排成 **DAG 工作流**：无依赖关系的节点自动并行执行（受最大并行度约束），支持条件分支、失败传播、运行预算与断点恢复。

### 数据模型

```typescript
type FlowNodeType = 'ai' | 'script' | 'manual'

interface FlowConfig {
  name: string
  version: number
  nodes: Record<string, FlowNode>        // 节点表
  maxParallel?: number                   // 并行度上限
  maxTotalSeconds?: number               // 整个 Flow 的墙钟预算
}

// 条件边：字符串 = 普通依赖（上游失败则跳过下游）
//          对象 = 显式条件（on: success | failure | finished）
type FlowEdge = string | { node: string; on?: 'success' | 'failure' | 'finished' }
```

### 执行语义

| 机制 | 说明 |
|------|------|
| 拓扑执行 | Kahn 算法做环检测 + 分层调度，入度为 0 的节点立即进入就绪队列 |
| 条件边 | `on: success` 只有上游成功才走；`on: failure` 是失败分支（UI 红色虚线）；`on: finished` 无论成败都走 |
| 跳过语义 | `upstream-failure`（普通边上游失败）与 `branch-not-taken`（条件分支未命中）区分——后者不算流程失败 |
| 失败传播 | `onFailure: stop`（默认）阻断下游；`continue` 放行 |
| 终态判定 | `blocked ? 'failed' : anyFailed ? 'partial' : 'success'`；预算耗尽 = failed |
| 断点恢复 | `resumeFromRunId` 复用上次成功节点（保持 finishedAt 不变），只重跑失败/跳过部分 |
| 克隆 | `cloneFlow` 复制整个 Flow 目录、清空运行历史、自动改名 |
| 人工门禁 | manual 节点进入 `waiting` 挂起整条分支，等 `resolveManualNode` 决议（v3.1.0 前为直接跳过） |
| 导入/导出 | 流程定义以 YAML 文件导入导出；导入时校验 + 重名自动加后缀，运行历史与任务工作区不随文件携带 |
| 技能库 | 桌面端聚合所有任务/流程工作区 `.opencode/skills` 的技能：编辑/新建/删除/跨工作区复制（整目录含附加文件）/导入导出 .md；技能与工作区名校验防路径穿越 |

### 节点类型

- **ai** — 两种形态（v3.2.0）：**引用模式**（`task: xxx`）在已有任务的工作区执行，沿用其技能与 OpenCode 配置；**内嵌模式**（无 `task`，`promptTemplate` 必填）在流程目录执行，流程级 `.opencode/skills` 可用。两者都支持 `{node.output}`（上游输出注入）与 `{inputs.key}`（运行时输入）占位符
- **script** — 目录内 shell 命令，带超时与 cwd
- **manual** — 人工门禁；未开启 `aiTakeover` 时进入 `waiting` 真正阻塞等待人工决议：通过（备注作为 `{node.output}` 注入下游，缺省 'approved'）或拒绝（节点失败，备注为失败原因）。`gatePrompt` 是展示给审批人的检查要点；`maxTotalSeconds` 预算耗尽时等待中的门禁被取消（skipped: budget-exhausted）；桌面端提供审批卡片 + 系统通知，同一流程同时只允许一个运行（含等待审批期间）

---

## Agent Runtime（v3.0.0 新增）

R1-R3 三步升级，把 opencode 从"批处理黑盒"变成可观测、有记忆、可干预的 Agent 运行时。

### R1 结构化事件审计

`opencode run --format json` 每行输出一个 JSON 事件（step_start / text / tool_use / step_finish / error）。`opencode-events.ts` 流式解析为结构化结果，写入 `TaskRunRecord`：

```typescript
interface TaskRunRecord {
  sessionId?: string        // 会话 id（R2 连续性的锚点）
  tokens?: { input; output; total }
  cost?: number             // 美元成本（各 step 求和）
  steps?: number            // LLM 往返次数
  toolCalls?: ToolCallRecord[]  // 工具调用链（工具名/标题/状态/输入/输出，保留最近 50 条）
}
```

关键决策：
- **fail-closed**：出现 `error` 事件即判定失败，即使退出码为 0
- **输出优先级**：助手文本 → 工具调用摘要 → 原始输出尾部（有些运行合法地无最终文本）
- **Windows 二进制解析**：npm 安装的 opencode 是 `.cmd` shim，Node spawn 拒绝无 shell 执行 → 从 `where` 输出解析原生 `.exe`（优先直接命中，否则解析 shim 内容里的引号路径）
- **版本自适应权限 flag**：≥1.18 用 `--auto`，更老版本用 `--dangerously-skip-permissions`（同一语义：自动批准未被显式拒绝的权限，deny 规则仍生效）
- 验证/修复/Flow 注入全部使用干净摘要而非原始 JSON blob（修复 LLM 验证正则误匹配 JSON 元数据的 bug）

### R2 会话连续性

```yaml
execution:
  session: fresh     # fresh（默认）：每次全新会话
                     # continue：--session 恢复上次会话，上下文完整继承
                     # fork：--session --fork 分叉，继承历史但原会话不动
```

- `resolveContinueSession()` 从运行历史倒序找最近的 sessionId
- **Agent Loop 自动链式 fork**：第 N+1 轮修复迭代 fork 第 N 轮的会话——Agent 修复时记得自己尝试过什么，同时每轮保留独立审计会话
- 标准重试路径同样跟踪每次尝试实际使用的会话

### R3 Serve 实时运行时

可选执行模式：一个共享的 `opencode serve` 进程通过 HTTP API 执行任务（`OpenCodeServer`）。

```
┌────────────┐  POST /session?directory=<taskDir>   ┌─────────────────┐
│            │ ────────────────────────────────────▶│                 │
│ Sentinel   │  POST /session/:id/message (阻塞)     │  opencode serve │
│ OpenCode-  │ ◀───────────────────────────────────▶│  (每目录 SSE)    │
│ Server     │  GET /event?directory=... (SSE)      │                 │
│            │  POST /session/:id/permissions/:id   │                 │
│            │  POST /session/:id/abort             │                 │
└────────────┘                                      └─────────────────┘
```

实测确认的关键行为（文档未写明）：
- **SSE 事件按目录过滤**——必须 `GET /event?directory=...` 订阅对应任务目录
- 单个 serve 进程可服务所有任务目录（`POST /session?directory=` 建目录绑定的会话）
- 消息响应只含最终 assistant 消息；工具调用在中间消息里，需拉取全会话消息按时间聚合

安全与超时：
- **权限 fail-closed**：无处理器的权限请求立即拒绝；桌面审批对话框 120 秒无响应同样拒绝
- 超时守卫触发 `POST /abort`；用户点停止 → AbortSignal → abort + 记录失败（error: aborted）
- 调度触发的无人值守运行**始终走 CLI 路径**，只有手动运行可走 serve 模式

### 执行路径统一

`runTaskExecution` / `runAgentLoop` 接受 `executeOverride`：serve 模式注入闭包后，重试、历史持久化、Agent Loop、通知与 CLI 模式**完全同语义**。serve 不可用时自动回退 CLI。
