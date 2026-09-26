# Agent Note: Conformance preflight before delivery

Status: proposed

[English](2026-09-26-conformance-preflight-before-delivery.md) | 中文

## Problem

Pull Request workflow 会在读取首个 conformance 结果前发布 branch。因此，格式错误或无法读取的 StageResult 可能先产生 delivery 副作用，之后系统才知道自己无法评估获批的 Spec 和 Plan。

## Proposal

在实现验证之后、首次调用 delivery capability 之前执行只读 conformance 预检。只有有效的 `PASS` 才允许调用。保留发布后的 conformance 读取和最终验证：预检不包含实测交付变更集，也不单独认证已发布的 revision。修复改变 branch 后必须重新读取 conformance。

## Alternatives considered

**保留发布后的 conformance，并只拒绝 `PR_READY`。** 这保留了 review 顺序，但当 conformance 结果无法读取时仍会创建 branch 或 pull request，因此无法阻止暴露此缺口的副作用。

**将所有 review 移到 delivery 之前。** 这可以避免在任何 review 前发布，但 reviewer 检查的是无人能在 GitHub 查看或评论的 working tree，也改变了 workflow 的 review contract。

## Acceptance criteria

- 预检结果缺失、格式错误或非 PASS 时，workflow 在调用 delivery capability 前结束。
- 预检通过后允许 delivery，但 `PR_READY` 仍要求最终 conformance 读取和最终验证通过。
- 修复会使先前的 conformance 证据失效，修复后的 branch 必须重新读取。

## Risks

预检读取获批文档和计划工作时，delivery 尚未测量最终变更集。后续 conformance 读取仍须作为最终认证依据，并计入已交付路径。
