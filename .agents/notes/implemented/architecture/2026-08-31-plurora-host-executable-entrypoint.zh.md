# Agent Note: Plurora 主机可执行生命周期

Status: implemented

[English](2026-08-31-plurora-host-executable-entrypoint.md) | 中文

## Problem

Plurora 部署主机曾要求调用方组装生产进程、提供方、目录、信号和凭据 seam。NeuroVia 只拥有经过验证的 checkout 与 loopback control client，因此不能通过受维护的接口启动主机。

## Decision

[`plurora-host`](../../../../apps/plurora-harness-host/src/bin.ts) 是包拥有的可执行程序。它只接受项目根目录和可选 session id，只从继承的 `PLURORA_HARNESS_TOKEN` 读取控制凭据，并将未改写的继承环境传给原生模型目录发现。参数与 token 检查在创建 subprocess service、持久 session、provider transport 或 listener 之前完成。

该可执行程序把 `SIGINT` 和 `SIGTERM` 转换为一个 abort signal。其生命周期 runner 在本地受管 subprocess context 之前释放组合主机，并等待二者完成，包括启动失败之后。输出只包含 loopback endpoint 或有界错误；绝不打印环境值、原始 cause 或 control token。已批准的 [entrypoint specification](../../../../docs/superpowers/specs/2026-08-31-plurora-host-executable-entrypoint.md) 定义其操作契约。

## Alternatives considered

- **导入 Harness packages 的 NeuroVia launcher** — 这会让产品拥有 runtime seams，并绕过 checkout/control-client 边界。
- **仅 shell 的 wrapper** — 这会让解析、signal 所有权和 cleanup 依赖平台且无法测试。

## Consequences

- 已 checkout 的 Trick Harness 暴露一个受支持的 process entrypoint，而 `startPluroraHost()` 保持可注入以供测试。
- 实际启动仍要求刻意提供原生 provider authentication；自动测试只使用 fake，不对 GitHub、database、release、deployment 或 certification 作出声明。
- NeuroVia 必须 repin 到经过审查的 Harness commit 后才能使用此可执行程序。
