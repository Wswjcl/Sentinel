# Sentinel 运行时架构

> 版本：v3.6 设计（2026-09）· 状态：opencode 双模式已完善，Claude 已实现，Codex 预留
>
> 本文是任务执行层（运行时）的设计文档，覆盖统一契约、分发策略、各运行时实现要点与演进计划。任务调度、Agent Loop、流程引擎见 DESIGN.md。

## 1. 概述

Sentinel 的核心是一个调度器：到点的任务交给**运行时**执行。一个运行时就是"怎么把一条 prompt 变成一次有记录的 agent 执行"的实现。目前有三条已落地的路径和一条预留路径：

| 运行时 | 载体 | 状态 | 定位 |
|---|---|---|---|
| `cli` | opencode CLI 子进程 | ✅ 生产 | 后台批处理，最简依赖 |
| `serve` | opencode serve HTTP 服务 | ✅ 生产 | 实时界面 + 权限审批 + 可中止 |
| `claude` | Claude Agent SDK + 协议网关 | ✅ 生产 | 用任意 OpenAI 兼容供应商跑 Claude Code |
| `codex` | Codex SDK + 网关 Responses 前端 | 🔒 预留 | 接口已就位，按 §6 激活 |

设计原则：

1. **一个契约**：所有运行时实现同一个 `RuntimeDescriptor`，调度器不感知差异。
2. **能力自述**：每个运行时声明自己支持什么（实时事件、权限弹窗、中止、会话续接），UI 和中止接线按能力走，不做运行时特判。
3. **回退显式化**：哪些运行时失败后可以回退 CLI、哪些必须 fail-closed，是运行时的显式策略字段，而不是散落在分发逻辑里的 if。
4. **密钥不出进程**：凡是经过供应商档案的运行时（claude、未来的 codex），上游 API key 只存在于 Sentinel 主进程和协议网关，子进程只见回环地址。

## 2. 运行时契约

契约类型定义在 `packages/desktop/src/shared/ipc-types.ts`：

```ts
interface RuntimeDescriptor {
  id: RuntimeMode                       // 'cli' | 'serve' | 'claude' | 'codex'
  execute: (options: ExecutorOptions) => Promise<ExecutionResult>
  capabilities: RuntimeCapabilities
  fallbackToCli: boolean
  reserved?: string                     // 预留原因（未激活时）
}

interface RuntimeCapabilities {
  liveEvents: boolean                   // 执行中推送 LiveEventData 到渲染层
  permissionDialog: boolean             // 权限请求走交互弹窗
  abortable: boolean                    // TASK_ABORT 可中止在跑的任务
  sessionContinuity: boolean            // 支持 continue/fork 会话续接
}
```

`ExecutorOptions` / `ExecutionResult`（`packages/core/src/executor.ts`）是所有运行时的公共输入输出：

- 输入：`taskDir`、`config`（任务配置）、`promptOverride`（Agent Loop 修复轮）、`continueSession`（续接）、`abortSignal`（中止）。
- 输出：`TaskRunRecord`（状态/会话 ID/token/成本/权限审计/工具调用审计）+ `stdout/stderr/summary`。

注册表在 `packages/desktop/src/main/index.ts` 组装（`runtimeRegistry: Map<RuntimeMode, RuntimeDescriptor>`），因为各执行器依赖主进程闭包（窗口句柄、权限等待队列、中止控制器注册表）。

## 3. 分发与回退策略

`dynamicExecutor`（index.ts）是唯一分发口，手动运行、调度器、Flow AI 节点都走它：

```
runtimeMode (runtime.json / 设置页)
   → runtimeRegistry.get(mode)
   → descriptor.fallbackToCli ?
        true  : try execute → 失败记调度日志 → executeTask (CLI)
        false : execute（失败即失败，不换道）
```

**为什么 serve 可以回退、claude/codex 不行**：serve 回退发生在"服务器起不来"这种基础设施故障，CLI 用的是同一份任务工作区和全局 opencode 配置，语义等价。而 claude/codex 的供应商路由由任务绑定的供应商档案决定——静默换到 CLI 意味着任务被发给另一个供应商执行，这是安全相关的路由变更，必须 fail-closed，把配置问题暴露成失败的运行记录。

运行时选择持久化在 `runtime.json`；`loadRuntimeMode` 接受全部四个 id——手改配置选了 `codex` 会得到明确的"尚未启用"失败，而不是被静默降级成 CLI。

## 4. 能力矩阵

| 能力 | cli | serve | claude | codex（预留） |
|---|---|---|---|---|
| liveEvents | ❌ | ✅ SSE 事件流 | ✅ SDK 消息流 | ✅ runStreamed 事件 |
| permissionDialog | ❌（`--auto` 自动放行） | ✅ | ✅ canUseTool 桥 | ⚠️ 见 §6.3 审批缺口 |
| abortable | ✅（v3.6 起kill 子进程） | ✅ | ✅ | ✅ |
| sessionContinuity | ✅ `--session`/`--fork` | ✅ `/session/{id}/fork` | ✅ `resume`/`forkSession` | ✅ `resumeThread` |
| 供应商来源 | 全局/工作区 .opencode 配置 | 同左 | 任务绑定的供应商档案 → 网关 | 任务绑定的供应商档案 → 网关（3b 后） |

## 5. opencode 运行时（当前重点）

### 5.1 CLI 模式

`packages/core/src/executor.ts`。每次运行 spawn 一个 `opencode run --dir <taskDir> --format json` 子进程，stdout 的 JSON 事件流由 `OpenCodeEventParser` 在结束时汇总成运行记录。

- **中止（v3.6 新增）**：`ExecutorOptions.abortSignal` 接入 —— 主进程把每次 CLI 运行的 `AbortController` 注册进 `taskAbortControllers`（与 serve/claude 共用，TASK_ABORT 对所有运行时生效），信号触发时 kill 子进程，记录 `Run aborted by user`（与 serve 语义一致，优先级高于错误事件/退出码判定）。
- Windows 二进制解析（`resolveWindowsBinary`）：npm shim `.cmd` → 真实 `.exe`，避免 shell 注入。
- 版本探测决定 `--auto` vs 旧版 `--dangerously-skip-permissions`。

### 5.2 serve 模式

`packages/core/src/opencode-server.ts`。常驻一个 `opencode serve` 进程，运行经 HTTP API：创建/续接/fork 会话（`/session/{id}/fork`）→ 发消息 → SSE 订阅事件转发给渲染层 → 权限请求经 `onPermission` 回调弹窗（120s 超时拒绝）→ 结束后拉取消息聚合 parts 汇总记录。

一个执行器服务任务和 Flow AI 节点（事件按任务名路由）；多个并发运行共享同一 serve 进程。

### 5.3 已知取舍与后续候选

- CLI 模式没有实时界面（能力矩阵如此，设置页有文案说明）；需要看过程用 serve。
- CLI 模式权限是 `--auto` 全放行 + 工作区 .opencode deny 规则兜底；需要逐条审批用 serve。
- 候选（按 `@opencode-ai/sdk` 的类型面接，见会话调研）：
  1. serve 模式 todo/diff 面板（`session.todo` / `session.diff`）
  2. 会话列表/历史浏览（`session.list` / `session.messages`）
  3. pty 终端（远期）
- OpenCodeServer 的手写 HTTP 客户端**不迁移**到 `@opencode-ai/sdk`（ HeyAPI 生成客户端收益有限、版本耦合）；SDK 仅作 API 参考。

## 6. Claude 运行时（已实现）

`packages/desktop/src/main/claude-executor.ts` + `packages/core/src/gateway/`。要点：

1. **协议网关**：每次运行启动一个 `ProtocolGateway`（127.0.0.1 随机端口，Anthropic Messages 入站 → OpenAI Chat Completions 出站，流式翻译/工具调用往返/错误映射），运行结束即停。
2. **SDK 驱动**：`@anthropic-ai/claude-agent-sdk`（ESM-only，经 `new Function('s','return import(s)')` 间接动态 import 规避 electron-vite CJS 打包，产物已验证）。`query()` 带 `settingSources:['project']`、任务超时/用户中止共用 AbortController 注册表、消息流映射 Live 事件与工具审计、`modelUsage` 聚合 token、`total_cost_usd` 计成本。
3. **权限桥接**：`canUseTool` → 现有三键权限卡片（120s 自动拒绝）；"总是允许"应用 SDK 会话内规则建议；任务权限卡 `trusted` → `bypassPermissions`。
4. **隔离**：子进程 env 删除环境里的 `ANTHROPIC_API_KEY`，`ANTHROPIC_BASE_URL` 指向网关，`CLAUDE_CONFIG_DIR` 指向 Sentinel 管理目录（会话续接状态与 onboarding 不碰用户真实 `~/.claude`）；打包态经 `asarUnpack` 解出 claude 原生二进制。
5. **绑定**：任务必须绑定含 baseUrl+apiKey 的供应商档案，否则运行失败并给出明确原因（fail-closed）。

## 7. Codex 运行时（预留设计）

> 预留已落地的部分：`RuntimeMode` 含 `'codex'`、注册表含占位描述符（选中有明确报错）、契约字段与能力声明已就位。以下为激活时的设计，按两个阶段交付。

### 7.1 阶段 3a —— 驱动层

新建 `packages/desktop/src/main/codex-executor.ts`，与 claude-executor 同构：

| Sentinel 概念 | @openai/codex-sdk（v0.157.x）对应物 |
|---|---|
| `query()` | `codex.startThread()` / `resumeThread(id)` → `thread.run()` / `runStreamed()` |
| continueSession {sessionId, fork} | `resumeThread(id)`（fork 语义待 spike 确认） |
| LiveEventData text/reasoning | `agent_message` / `reasoning` 事件 |
| ToolCallRecord | `command_execution`（命令/输出/退出码）、`file_change`、`mcp_tool_call` |
| TokenUsage / cost | `TurnCompletedEvent.usage` |
| 权限卡 trusted | `sandboxMode: 'workspace-write'` + `approvalPolicy: 'never'` |
| 权限卡非 trusted | `sandboxMode: 'read-only'`/`'workspace-write'`（逐次审批受限，见 7.3） |
| env 隔离 | `CodexOptions.env`（整体替换，同 Claude SDK 语义） |
| 3a 认证 | 不传 `baseUrl`，用用户自己的 codex 登录 |

SDK 依赖自带 `@openai/codex` 二进制（同 claude-agent-sdk 自带 claude.exe 的模式），打包同样需要 asarUnpack。

### 7.2 阶段 3b —— 供应商层

网关增加 **Responses 协议前端**：入站 Responses API（items、SSE 事件、工具调用、reasoning items）→ 出站 OpenAI Chat Completions。Codex 经 `CodexOptions.baseUrl/apiKey` 指向网关回环地址，供应商档案体系统一，密钥不出 Sentinel 进程。这是 codex 阶段的主要工作量，且无论驱动层走哪条路都绕不开（codex 只会说 Responses）。

### 7.3 已知风险

- **逐次审批缺口**：codex SDK 导出面没有 canUseTool 式回调，非 trusted 权限卡做不到逐次弹窗。处置选项：等 SDK 补回调 / 权限卡语义降级为沙箱档位 / 退回 `@agentclientprotocol/codex-acp` 适配器（Obsidian Copilot 的路线，有 RequestPermission）。3a spike 时先实测审批行为再定。
- **Windows 沙箱降级**：codex 沙箱在 Windows 上能力受限，文档需向用户说明。
- **resume/fork 语义**：`resumeThread` 是否支持 Sentinel 的 fork 语义（原会话不动）需 spike 验证。

### 7.4 激活清单

1. 实现 `codex-executor.ts`（3a）→ 注册表 `execute` 换掉占位、去掉 `reserved`。
2. `ipc-types` 注释更新 + 设置页加 Codex 按钮（i18n：`detail.runtimeCodex`）。
3. smoke：`scripts/codex-runtime-smoke.mjs`（mock Responses 上游 + baseUrl 指向 mock）。
4. 3b：网关 Responses 前端 + `translate.ts` 对应翻译器 + smoke 扩展。
5. electron-builder `asarUnpack` 增加 `@openai/codex*`。

## 8. 相关文件索引

| 文件 | 职责 |
|---|---|
| `packages/desktop/src/shared/ipc-types.ts` | RuntimeMode / RuntimeDescriptor / RuntimeCapabilities |
| `packages/desktop/src/main/index.ts` | runtimeRegistry 组装、dynamicExecutor 分发、TASK_ABORT |
| `packages/core/src/executor.ts` | CLI 执行器（含 abortSignal kill-on-abort） |
| `packages/core/src/opencode-server.ts` | serve 运行时（会话/权限/事件/中止） |
| `packages/desktop/src/main/claude-executor.ts` | Claude SDK 执行器 |
| `packages/core/src/gateway/*` | 协议网关（翻译器 + HTTP 服务） |
| `packages/core/src/provider-config.ts` | CLI 模式供应商溯源 |
| `scripts/gateway-smoke.mjs` / `scripts/claude-runtime-smoke.mjs` | 协议/链路冒烟 |
