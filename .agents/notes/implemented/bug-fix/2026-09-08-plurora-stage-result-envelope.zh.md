# Agent Note: Plurora 阶段结果 envelope 恢复

Status: implemented

[English](2026-09-08-plurora-stage-result-envelope.md) | 中文

## Problem

Plurora 主机可以解析阶段最终的 `HARNESS-RESULT:` JSON 对象，却仍会拒绝 stage-result 合约而不指出被拒绝的字段。普通阶段提示词列出了 finding 的必填字段，却遗漏了 `class` 和 `raisedBy` 所接受的封闭取值，因此执行器可能生成有效 JSON，但仍被严格解析器拒绝。conformance 提示词只要求返回嵌套的评审结果，但工作流会先把同一 envelope 作为普通阶段结果读取，因此符合提示词的回复会因顶层缺少 `verdict` 而失败。

## Decision

`workflow-handlers.ts` 将已解析但不符合 stage-result 合约的结果报告为 `stage-result-invalid`，并附带解析器生成的 `ContractError.path`。它不会把模型输出、解析器消息或被拒绝的值写入日志。其他不可读 envelope 的失败仍与此合约拒绝保持区分。

普通阶段提示词以包含 `verdict`、`summary`、`findings` 和 `evidence` 的完整有效 JSON 示例结尾。它要求该单独的最终行不带代码围栏或后续文本，并从解析器校验所用的相同常量中生成允许的 verdict、evidence、finding class 和 role 取值。

conformance 提示词提供一个完整 JSON 示例，同时包含普通的顶层结果和嵌套的 `conformance` 评审结果。它要求两层的 verdict 和 summary 保持一致；确定性覆盖验证仍对嵌套评审结果拥有最终决定权。

## Verification

`apps/plurora-harness-host/tests/workflow-handlers.spec.ts` 证明安全拒绝诊断会指出字段路径、排除被拒绝的模型文本、向执行器提供 finding 的全部封闭取值，并为 conformance 提供两种必需的读取方式。`apps/plurora-harness-host/tests/stage-result-prompt.snapshot.ts` 对真实主机 handler 组装的普通提示词和 conformance 提示词进行快照验证，无需模型凭据。

## Alternatives considered

- **记录解析器错误或最终模型消息** - 否决，因为两者都可能包含来自仓库的密钥，并会将无界模型内容写入持久状态；解析器拥有的字段路径已经足够且有界。
- **放宽 stage-result 合约** - 否决，因为缺失 evidence 或 findings 结构会削弱工作流的证据边界，而不是解释被拒绝的报告。
- **在记录阶段事实之前解析 conformance** - 否决，因为这会把依赖 manifest 的验证移入通用调度路径，并重复确定性 conformance 解析器的职责。
- **没有诊断地重试阶段** - 否决，因为重试可能重复写入，而且操作人员仍无法区分报告格式问题与执行器失败。

## Consequences

- 操作人员可以识别违反 stage-result 校验的字段，同时原始阶段输出和被拒绝的值仍不会进入日志。
- 执行器获得普通无 finding 情形的可复现 envelope；存在 finding 时也会获得完整的允许取值。
- conformance 生成一个 envelope，使通用阶段解析器和依赖 manifest 的解析器都能验证它。
- canary 重试必须在固定经过审查的 Harness 版本后启动新工作流；它不能追溯地把已阻塞的工作流变成证据。
