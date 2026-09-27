# Agent Note: 基于日志事件的持久化工作流进度

Status: implemented

English | [中文](2026-09-27-durable-workflow-progress.md)

## Problem

控制服务器的实时状态最初只是静态的 `running` 响应，没有阶段信息；重启状态也不包含阶段详情。操作人员无法在不读取私有执行输出的情况下定位正在运行或已中断的工作流。

## Decision

`WorkflowJournal` 会在工作流获准运行时记录宿主会话 ID。`projectWorkflow` 根据持久化事件推导活动阶段、角色、执行器、尝试序号、执行器运行 ID、最近事件时间、失败代码和约束类别。组合层会在每次实时轮询时重新投影这些事件，并在有界状态中包含已完成阶段的摘要。重启评估也携带相同投影。控制服务器只复制已声明的状态字段，并丢弃任意附加字段。

## Alternatives considered

**仅由实时 runner 保存可变进度**会在进程替换时丢失信息，也可能与持久化事件流不一致。

**渲染 provider transcript 或命令输出**会暴露无界且可能敏感的文本；定位工作流进度并不需要这些内容。

**添加编排框架**会取代现有 journal 和工作流语义，而不是扩展其持久化投影。

## Consequences

- 实时状态和重启状态使用相同的持久化事件事实。
- `executorRunId` 由宿主会话 ID 和会话事件序号组成；`attemptId` 由工作流、阶段和该阶段的尝试序号组成。
- 不含 `hostRunId` 的旧 workflow-start 事件仍可读取；推导执行器运行 ID 时会使用有界回退值。
- 状态仍是有界轮询响应，不会暴露 transcript、任意事件负载或证据内容。

## Testing

Journal 测试会从复制的事件列表重建进度，并验证约束类别可见而 provider 文本不可见。控制服务器测试会验证实时刷新、重启投影以及对未声明字段的拒绝。
