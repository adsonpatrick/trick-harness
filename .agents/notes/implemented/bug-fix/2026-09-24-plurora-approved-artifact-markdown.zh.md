# Agent Note: Plurora 已批准产物的 Markdown 提取

Status: implemented

[English](2026-09-24-plurora-approved-artifact-markdown.md) | 中文

## Problem

确定性 conformance 解析器曾将唯一 Markdown 写法视为义务约定：Spec 必须使用显式粗体标识符，Plan 必须使用三级英文 `Task` 标题。因此，人类可读的已批准产物可能用另一种常见 Markdown 形式清晰声明验收标准或任务，但工作流仍会报告其未声明义务。

## Decision

`- **AC1:** requirement` 这类显式 Spec 声明在文档任何位置均有效。在已命名的验收章节内，解析器还接受顶层有序列表、无序列表和复选框列表项，并按文档顺序分配稳定的 `SPEC-CRITERION-N` 标识符。验收标题在大小写、重音符号和结尾冒号规范化后可以用英语、葡萄牙语或西班牙语书写。

Plan 任务可由二级或三级 `Task N` 和 `Tarefa N` 标题声明，分隔符可以是冒号、句点、连字符、短破折号或长破折号。更深的标题仍视为任务详情。同一任务识别规则也控制 Plan 写入集提取，因此备选任务标题不会使义务评分与交付范围分离。

解析器仍保持确定性。可识别验收章节之外的列表、仅提及标准的正文和未命名的 Plan 标题都不会建立义务。

## Verification

`packages/core/engineering-workflow/tests/conformance.spec.ts` 覆盖显式标识符、有序和无序验收章节、英语和葡萄牙语标题、任务层级、生成标识符、章节边界以及空产物拒绝。Plurora conformance 端到端测试证明所得 manifest 在最终验证中仍可强制执行。

## Alternatives considered

- **要求模型从任意正文中推断义务** - 否决，因为实现将根据运行时选择的非确定性集合进行判定。
- **将每个文档列表视为义务** - 否决，因为示例、上下文、风险和参考资料都常使用列表，这会静默扩大已批准约定。
- **要求唯一规范 Markdown 写法** - 否决，因为保留清晰章节语义的展示差异不应使已批准产物变得不可读。

## Consequences

- 常见 Spec 和 Plan 格式可保持机器可读，作者无需记住唯一严格 Markdown 模板。
- 可识别的标题和列表边界是有限且可测试的；真正非结构化的正文仍会以安全方式拒绝。
- 对于文档顺序未变的情况，生成的标准标识符保持稳定，因此可以精确检查 conformance 回答。
