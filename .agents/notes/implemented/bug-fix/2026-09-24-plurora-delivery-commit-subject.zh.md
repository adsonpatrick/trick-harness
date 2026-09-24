# Agent Note: Plurora 交付使用符合策略的提交主题

Status: implemented

[English](2026-09-24-plurora-delivery-commit-subject.md) | 中文

## 问题

工作流目标是自然语言输入，不是 Git 提交主题。将其用作主题会让标点、大小写、长度或任意措辞在实现和验证通过后违反目标仓库的提交消息策略。

## 决策

[Plurora 交付描述](../../../../apps/plurora-harness-host/src/workflow-handlers.ts)始终使用 `chore(harness): deliver approved workflow change` 作为提交主题。目标 id 和交付阶段保留在提交正文中，而经过长度限制的自然语言需求仍作为 PR 标题。

固定主题具有确定性、与仓库无关，并符合 Conventional Commits 语法。工作流文本不能选择提交类型、作用域或描述。

## 考虑过的替代方案

**将目标规范化为 Conventional Commits 语法。** 从文本中推断类型和作用域存在歧义，改写任意文本仍会带来与仓库相关的长度和字符策略风险。

**从已批准的 Plan 中解析请求的提交消息。** 这会扩大 Plan 约定，并让文档文本在没有专用受验证字段的情况下控制 Git 元数据。

**继续使用目标作为提交主题。** 限制文本长度只能控制大小，不能满足语法策略。

## 影响

交付提交使用通用主题；PR 标题和提交尾注保留工作流的特定标识。比 Conventional Commits 更严格的仓库策略仍可能拒绝交付，并需要显式的部署级策略。

[处理器回归测试](../../../../apps/plurora-harness-host/tests/workflow-handlers.spec.ts)将固定提交主题与描述性 PR 标题分离。[无需密钥的交付快照](../../../../apps/plurora-harness-host/tests/delivery-branch.snapshot.ts)从真实的临时 Git 提交和推送中记录主题。
