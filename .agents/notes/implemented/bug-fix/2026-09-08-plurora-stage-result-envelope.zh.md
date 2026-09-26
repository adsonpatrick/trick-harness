# Agent Note: Plurora 阶段结果 envelope 恢复

Status: implemented

[English](2026-09-08-plurora-stage-result-envelope.md) | 中文

## Problem

Plurora 主机可以解析阶段最终的 `HARNESS-RESULT:` JSON 对象，但仍可能拒绝 stage-result 合约而不指出被拒绝的字段。普通阶段提示词列出了 finding 必填字段，却没有说明 `class` 和 `raisedBy` 接受的封闭取值。conformance 提示词也没有说明完整的 `Finding` 字段，因此即使 finding 本身有效，输出仍可能被严格解析器拒绝。

## Decision

`workflow-handlers.ts` 会将已解析但不符合 stage-result 合约的结果标记为 `stage-result-invalid`，并附上解析器生成的 `ContractError.path`。它不会记录模型输出、解析器消息或被拒绝的值。其他不可读取的 envelope 错误仍与此合约拒绝保持区分。普通阶段和 conformance 阶段共用同一段提示说明，描述 `StageResult`、`Finding`、`StageConstraint` 和 evidence 字段；解析器继续严格拒绝无效输入。

普通阶段提示以一个完整 JSON 示例结尾，示例中含有字段齐全的说明性 finding。共享说明从解析器使用的常量生成允许的 verdict、evidence、finding class、constraint class 和 role 取值。提示明确要求没有 finding 时删除示例 finding。

conformance 提示使用相同的 stage-result 说明，并提供一个含有完整 finding 和嵌套 `conformance` reading 的 JSON 示例。顶层和 conformance 的 verdict 与 summary 必须相同；确定性的覆盖率检查仍对嵌套结果作最终判断。

## Verification

`apps/plurora-harness-host/tests/workflow-handlers.spec.ts` 验证安全拒绝诊断指出字段路径且不包含被拒绝的模型文本，并验证两个提示都包含完整的 finding 字段。`apps/plurora-harness-host/tests/conformance-end-to-end.spec.ts` 验证格式错误的 conformance finding 不会产生正向认证。`apps/plurora-harness-host/tests/stage-result-prompt.snapshot.ts` 对真实主机 handler 组装的普通提示和 conformance 提示进行快照验证，无需模型凭据。

## Alternatives considered

- **记录解析器错误或最终模型消息** - 否决，因为两者都可能包含来自仓库的秘密，并将无界模型内容写入持久状态；有界的字段路径已足够。
- **放宽 stage-result 合约** - 否决，因为缺失 evidence 或 findings 结构会削弱工作流的证据约束，而不是解释被拒绝的报告。
- **在记录阶段事实之前解析 conformance** - 否决，因为这会把依赖 manifest 的校验移入通用调度路径，并重复确定性 conformance 解析器的职责。
- **没有诊断就重试阶段** - 否决，因为重试可能重复写入，且操作人员仍无法区分报告格式问题和执行器故障。

## Consequences

- 操作人员能够识别违反 stage-result 校验的字段，同时原始阶段输出和被拒绝的值不会进入日志。
- 执行器获得可复现且包含完整 Finding 的示例；实际没有 finding 时必须移除示例项。
- conformance 产生一个 envelope，通用阶段解析器和依赖 manifest 的解析器都能校验。
- canary 重试必须在审查并 pin Harness 新版本后启动新工作流；不能追溯地把已阻塞的工作流变成证据。
