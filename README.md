# AI-TestHub

AI-TestHub 是一个可直接运行的智能测试管理后台 MVP，覆盖 RBAC、测试用例、测试计划执行、缺陷追踪、报告导出、TOTP 双因素认证与 API Key 驱动的 AI 测试助手。

它以轻量级单服务实现核心流程，适合作为 MeterSphere 等大型开源平台之外的可二次开发起点：内置 SQLite 轻量数据库、无需构建前端；没有 Docker 时也可直接用 Node.js 启动。

## 快速启动

```bash
cp .env.example .env
# 修改 .env 中的 APP_SECRET（生产环境必须设置为高强度随机值）
docker compose up -d --build
```

打开 `http://localhost:8080`。默认管理员为 `admin / admin123`，首次登录后请修改或停用演示账号。

开发模式无需安装依赖：

```bash
npm start
```

详细说明见 [部署与使用手册](docs/02-快速开始.md)、[角色权限说明](docs/03-角色权限说明.md)、[AI 智能助手](docs/04-AI智能助手.md) 和 [验收流程](docs/05-验收流程.md)。

## 已实现范围

- 六种预置角色的服务端 RBAC 鉴权；越权请求返回 `403`。
- 项目、步骤化测试用例、测试计划、手工执行结果和缺陷状态流转。
- 实时质量统计与 HTML 报告导出；导出的 HTML 可直接使用浏览器“打印 → 存储为 PDF”。
- OpenAI 兼容接口的多模型配置，API Key 使用 AES-256-GCM 加密落盘且永不回传浏览器。
- 测试用例生成、缺陷根因分析、测试报告摘要三项 AI 技能。
- 原测试工具箱的 Word/PDF/图片识别、知识库、XMind 与多工作表用例导出已接入；原引擎仅支持 macOS Apple Silicon，Linux/Docker 部署不支持该引擎。
- 标准 TOTP 双因素认证（Google/Microsoft Authenticator 兼容）。
- Docker Compose 数据卷持久化。

## 数据库

系统使用 Node.js 内置的 **SQLite**，无需安装 MySQL、Redis 或 Docker。数据库文件位于 `data/ai-testhub.db`；该文件承载全部业务数据。已有的旧版 `data/testhub.json` 会在升级后首次启动时自动导入 SQLite。

备份时先停止服务，然后复制 `data/ai-testhub.db`。在服务运行期间，建议用 SQLite 的在线备份工具或连同 `ai-testhub.db-wal`、`ai-testhub.db-shm` 一并备份。

## 项目结构

```text
AI-TestHub/
├── server.js              # API、RBAC、持久化、AI 代理和 TOTP
├── public/                # 零依赖管理后台
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── docs/                  # 部署、权限、AI 和验收手册
```

## 安全提示

本仓库演示账号仅用于本地体验。部署到可被访问的网络前，务必：设置强 `APP_SECRET`、使用反向代理 HTTPS、替换默认账号密码、限制管理端网络入口，并定期轮换 AI API Key。
