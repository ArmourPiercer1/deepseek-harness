# 测试任务：待办事项（Todo）功能

这是一个小型**前后端耦合**的开发任务，用于验证 agent team 模式的协作流程：架构师先定契约，后端实现 API，前端按契约联调。

## 需求

实现一个简单的待办事项功能：

- 后端提供 REST API：列出、创建、更新、删除待办事项。
- 前端提供待办列表页面，支持新增、勾选完成、删除。

## 建议分工与顺序

1. **架构设计师（architect）**：先产出数据模型（`Todo` 字段）与接口契约（路由、HTTP 方法、请求/响应 JSON、错误码），经 `send_team_message` 报告给 leader。
2. **后端开发者（backend-dev）**：按契约实现 `/api/todos` 路由与存储，用 `pwsh` 跑测试验证（该动作会触发 leader 审批）。
3. **前端开发者（frontend-dev）**：实现待办列表 UI，按契约调用后端 API 完成联调。

## 验收标准

- 架构师交付了明确的 `Todo` 数据模型与接口契约。
- 后端 `GET /api/todos`、`POST /api/todos`、`PATCH /api/todos/:id`、`DELETE /api/todos/:id` 全部可用，并有测试覆盖。
- 前端能展示、新增、完成、删除待办，且与后端真实联调通过。
- 全程通过 `team_control` 审批后端运行命令、通过 `team_progress` 跟踪三个子任务。
