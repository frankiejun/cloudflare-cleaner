# Cloudflare 清理工具

这是一个使用 JavaScript 开发、部署在 Cloudflare Workers 上的自动化工具，用于定期清理 Cloudflare Pages 的历史部署版本，帮助您管理和优化您的部署历史。

## 功能特性

- 🕒 **定时自动清理**: 每天凌晨 2 点自动运行清理任务
- 📦 **Pages 清理**: 仅清理 Cloudflare Pages 的历史部署
- ⚙️ **可配置保留数量**: 通过环境变量控制保留的历史部署数量
- 🛡️ **安全清理**: 只清理成功的部署，保护当前生产环境
- 📊 **详细日志**: 提供清理操作的详细日志和统计信息
- 🌐 **HTTP API**: 支持手动触发和状态查询
- 🔄 **错误恢复**: 单个清理失败不会影响整体任务执行

## 快速开始

### 1. 克隆项目

```bash
git clone <repository-url>
cd cloudflare-cleaner
```

### 2. 安装依赖

```bash
npm install
```


### 3. 配置环境变量

在 Cloudflare Dashboard 中为您的 Worker 配置以下环境变量：

| 变量名 | 描述 | 必需 | 示例值 |
|--------|------|------|--------|
| `CF_API_TOKEN` | Cloudflare API Token 或全局 Token | ✅ | `your-api-token-here` |
| `CF_ACCOUNT_ID` | Cloudflare 账户 ID | ✅ | `abc123def456` |
| `CF_EMAIL` | Cloudflare 账户邮箱 (仅全局 Token 需要) | ✅  | `user@example.com` |
| `KEEP_VERSIONS` | 保留的版本数量 | ❌ | `5` (默认值) |

#### 获取 API Token

**使用全局 API Token**

1. 访问 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. 找到 "Global API Key" 并点击 "View"
3. 同时需要设置 `CF_EMAIL` 环境变量为您的 Cloudflare 账户邮箱

> **注意**: 全局 Token 拥有完整权限，使用时请格外小心。

#### 获取 Account ID

1. 登录 Cloudflare Dashboard
2. 在右侧边栏找到 "Account ID"

## 从 GitHub 部署到 Cloudflare Workers（简版）

1. 在 GitHub 创建仓库并推送代码
2. 在 Cloudflare Dashboard 新建 Worker，绑定以下环境变量：`CF_API_TOKEN`、`CF_ACCOUNT_ID`、`CF_EMAIL`(全局 Token 时需要)、`KEEP_VERSIONS`
3. 在 Worker 的 Settings → Triggers 配置 Cron（建议 `0 2 * * *`）
4. 在 GitHub 配置 CI（如 GitHub Actions），执行 `wrangler deploy`
5. 首次部署后访问 `/<status|health|permissions>` 验证配置

## 配置说明

### wrangler.toml 配置

项目包含针对不同环境的配置：

```toml
# 开发环境 - 保留更多版本便于测试
[env.development]
name = "cloudflare-cleaner-dev"
[env.development.vars]
KEEP_VERSIONS = "10"

# 生产环境 - 保留较少版本节省存储
[env.production]
name = "cloudflare-cleaner-prod"
[env.production.vars]
KEEP_VERSIONS = "3"
```

### 定时任务配置

默认配置为每天凌晨 2 点（UTC）运行：

```toml
[triggers]
crons = ["0 2 * * *"]
```

您可以根据需要修改 cron 表达式，例如：
- `"0 2 * * *"` - 每天凌晨 2 点
- `"0 */6 * * *"` - 每 6 小时运行一次
- `"0 2 * * 1"` - 每周一凌晨 2 点

## API 端点

部署后，您的 Worker 将提供以下 HTTP 端点：

### GET `/`
获取服务基本信息和配置状态

### GET `/health`
健康检查端点，返回服务状态和环境变量配置情况

### GET `/status`
获取详细的服务状态信息，包括下次运行时间和配置详情

### POST `/cleanup`
手动触发清理任务

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/cleanup
```



## 工作原理

### Pages 清理逻辑

1. 获取账户下所有 Pages 项目
2. 对每个项目获取部署历史
3. 筛选出状态为 "success" 的部署
4. 按创建时间排序，保留最新的 N 个部署
5. 删除其余的历史部署

### Workers 说明

- Cloudflare 目前未提供删除 Workers 历史版本的 API，本工具已移除相关操作

### 安全措施

- ✅ 只删除成功的部署/版本
- ✅ 保留最新的指定数量版本
- ✅ 单个操作失败不影响整体清理
- ✅ 详细的错误日志和操作记录
- ✅ 环境变量验证

## 监控和日志

### 查看运行日志

在 Cloudflare Dashboard 中：

1. 进入 Workers & Pages
2. 选择您的 Worker
3. 点击 "Logs" 标签页

### 日志内容

- 清理任务开始和完成时间
- 每个项目/脚本的处理结果
- 删除的部署/版本详情
- 错误信息和警告
- 执行时间统计



## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 支持

如果您遇到问题或有改进建议，请：

1. 查看现有的 Issues
2. 创建新的 Issue 描述问题
3. 提供详细的错误日志和配置信息
