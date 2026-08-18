# API 接口文档（v1）

对外集成请使用版本化 API：`/api/v1`。管理后台继续使用兼容的 `/api` 路径，不受影响。

完整机器可读契约：`GET /api/openapi.yaml`。

## 认证

```http
Authorization: Bearer <JWT 会话令牌或 ath_ API Token>
```

API Token 同时受以下限制：创建者角色权限、Token 级别和项目范围。越权响应均为 `403`，并含 `error.code` 和 `requestId`。

| 级别 | 用途 |
| --- | --- |
| `read` | 查询已授权项目的数据 |
| `write` | 创建、更新测试资产；可供受控 Runner 上报 |
| `admin` | 在创建者角色许可范围内执行管理操作 |

## 资源查询

所有集合接口支持 `page`、`pageSize`，最大 `pageSize=100`；返回结构：

```json
{ "items": [], "page": 1, "pageSize": 50, "total": 0 }
```

| 方法 | 路径 | 权限 | 可选筛选 |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | 无 | - |
| GET | `/api/v1/me` | `project:read` | - |
| GET | `/api/v1/projects` | `project:read` | - |
| GET | `/api/v1/cases` | `case:read` | `projectId` |
| GET | `/api/v1/plans` | `plan:read` | `projectId` |
| GET | `/api/v1/defects` | `defect:read` | `projectId`, `status` |
| GET | `/api/v1/reports/summary` | `report:read` | `projectId` |
| GET | `/api/v1/ui-cases` | `ui:read` | - |
| GET | `/api/v1/ui-runs` | `ui:read` | `status` |
| GET | `/api/v1/audit-logs` | `system:manage` | - |

## UI 自动化 Runner 回调

Runner 领取或创建 UI 执行记录后，上报最终状态：

```http
PATCH /api/v1/ui-runs/{runId}/callback
Authorization: Bearer ath_...
Content-Type: application/json

{
  "status": "passed",
  "duration": 9,
  "log": "Chromium: 3 assertions passed",
  "artifactUrl": "https://runner.example/artifacts/run.zip"
}
```

`status` 只能是 `passed`、`failed` 或 `blocked`。Runner Token 必须至少为 `write` 且已授权目标项目。

## 错误模型

```json
{
  "error": {
    "code": "token_scope_denied",
    "message": "该访问令牌的级别不允许此操作",
    "requestId": "..."
  }
}
```

常见代码：`unauthorized`、`forbidden`、`token_scope_denied`、`token_project_denied`、`validation_error`、`not_found`。

## 测试用例导入与导出

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/cases/import` | `case:write` | JSON 批量导入；单次最多 1000 条 |
| POST | `/api/cases/import-excel` | `case:write` | Excel (.xlsx/.xls) Base64 上传导入；单次最多 1000 条 |
| GET | `/api/cases/export?caseType=functional&projectId=p-payment` | `case:read` | 按用例类型和项目导出格式化 Excel (.xlsx) |
| GET | `/api/cases/template` | `case:write` | 下载 Excel 导入模板（含填写说明页） |

Excel 模板表头（中文格式）：

```text
用例编号, 业务模块, 是否冒烟, 用例标题, 优先级, 前置准备, 步骤, 预期结果, 执行结果
```

JSON 导入（`/api/cases/import`）同时兼容英文表头：`title,projectId,module,caseType,priority,tags,precondition,steps`。

`caseType` 可取：`functional`、`api`、`ui`、`performance`、`security`、`compatibility`。多步骤在同一单元格内换行，步骤与预期一一对应；也可使用 `操作 | 预期` 格式。旧版 CSV 模板位于 `templates/test-cases-template.csv`。
