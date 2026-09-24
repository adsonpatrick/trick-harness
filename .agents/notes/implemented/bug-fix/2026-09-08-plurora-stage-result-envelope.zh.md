# Agent Note: Plurora 阶段结果 envelope 恢复

Status: implemented

[English](2026-09-08-plurora-stage-result-envelope.md) | 中文

## Problem

Plurora 主机可以解析阶段最终的 `HARNESS-RESULT:` JSON 对象，却仍会拒绝 stage-result 合约而不指出被拒绝的字段。普通阶段提示词列出了 finding 的必填字段，却遗漏了 `class` 和 `raisedBy` 所接受的封闭取值，因此执行器可能生成有效 JSON，但仍被严格解析器拒绝。

## Decision

`workflow-handlers.ts` 将已解析但不符合 stage-result 合约的结果报告为 `stage-result-invalid`，并附带解析器生成的 `ContractError.path`。它不会把模型输出、解析器消息或被拒绝的值写入日志。其他不可读 envelope 的失败仍与此合约拒绝保持区分。

普通阶段提示词以包含 `verdict`、`summary`、`findings` 和 `evidence` 的完整有效 JSON 示例结尾。它要求该单独的最终行不带代码围栏或后续文本，并从解析器校验所用的相同常量中生成允许的 verdict、evidence、finding class 和 role 取值。

## Verification

`apps/plurora-harness-host/tests/workflow-handlers.spec.ts` 证明安全拒绝诊断会指出字段路径、排除被拒绝的模型文本，并向执行器提供 finding 的全部封闭取值。`apps/plurora-harness-host/tests/stage-result-prompt.snapshot.ts` 对真实主机 handler 组装的提示词进行快照验证，无需模型凭据。

## Alternatives considered

- **记录解析器错误或最终模型消息** - 否决，因为两者都可能包含来自仓库的密钥，并会将无界模型内容写入持久状态；解析器拥有的字段路径已经足够且有界。
- **放宽 stage-result 合约** - 否决，因为缺失 evidence 或 findings 结构会削弱工作流的证据边界，而不是解释被拒绝的报告。
- **没有诊断地重试阶段** - 否决，因为重试可能重复写入，而且操作人员仍无法区分报告格式问题与执行器失败。

## Consequences

- 操作人员可以识别违反 stage-result 校验的字段，同时原始阶段输出和被拒绝的值仍不会进入日志。
- 执行器获得普通无 finding 情形的可复现 envelope；存在 finding 时也会获得完整的允许取值。
- canary 重试必须在固定经过审查的 Harness 版本后启动新工作流；它不能追溯地把已阻塞的工作流变成证据。
