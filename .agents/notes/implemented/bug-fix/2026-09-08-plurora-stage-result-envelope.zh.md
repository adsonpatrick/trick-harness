# Agent Note: Plurora 阶段结果 envelope 恢复

Status: implemented

[English](2026-09-08-plurora-stage-result-envelope.md) | 中文

## Problem

Plurora 主机可以解析阶段最终的 `HARNESS-RESULT:` JSON 对象，却仍会拒绝 stage-result 合约；此时操作人员无法从持久状态中区分它与缺失或不可读的 envelope。普通阶段的提示词仅列出顶层字段，没有展示完整 JSON 对象，因此执行器即使试图遵从也可能遗漏必填结构。

## Decision

`workflow-handlers.ts` 将已解析但不符合 stage-result 合约的结果报告为 `stage-result-invalid`，并保持该诊断固定。它不会把模型输出、解析器消息、被拒绝的值或合约路径写入日志。其他不可读 envelope 的失败仍与此合约拒绝保持区分。

普通阶段提示词以包含 `verdict`、`summary`、`findings` 和 `evidence` 的完整有效 JSON 示例结束。它要求该单独的最终行不带代码围栏或后续文本，列出允许的 verdict 和 evidence 词汇，并说明非空 finding 的必填结构。

## Verification

`apps/plurora-harness-host/tests/workflow-handlers.spec.ts` 证明安全拒绝代码不会包含被拒绝的模型文本，并固定正典 envelope。`apps/plurora-harness-host/tests/stage-result-prompt.snapshot.ts` 通过真实主机 handler 生成提示词快照，不需要模型凭据。

## Alternatives considered

- **记录解析器错误或最终模型消息** - 否决，因为两者都可能包含来自仓库的密钥，并会将无界模型内容写入持久状态。
- **放宽 stage-result 合约** - 否决，因为缺失 evidence 或 findings 结构会削弱工作流的证据边界，而不是解释被拒绝的报告。
- **没有诊断地重试阶段** - 否决，因为重试可能重复写入，而且操作人员仍无法区分报告形状问题与执行器失败。

## Consequences

- 操作人员可以从有界的工作流状态识别 stage-result schema 不匹配，同时原始阶段输出仍不进入日志。
- 执行器获得普通无 finding 情形的可复现 envelope；存在 finding 时也有明确要求。
- canary 重试必须在固定经过审查的 Harness 版本后启动新工作流；它不能追溯地把已阻塞的工作流变成证据。
