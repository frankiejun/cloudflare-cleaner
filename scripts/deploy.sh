#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}/.."

ENV_NAME="development"
SET_SECRETS=false
SKIP_INSTALL=false
QUIET=false

CF_API_TOKEN_INPUT=""
CF_ACCOUNT_ID_INPUT=""
CF_EMAIL_INPUT=""

usage() {
  cat <<'USAGE'
用法: scripts/deploy.sh [选项]

选项:
  -e, --env <environment>      部署环境: development 或 production (默认: development)
      --set-secrets             非交互方式设置 Secrets (CF_API_TOKEN, CF_ACCOUNT_ID, CF_EMAIL)
      --cf-api-token <token>    提供 CF_API_TOKEN（也可通过环境变量 CF_API_TOKEN 提供）
      --cf-account-id <id>      提供 CF_ACCOUNT_ID（也可通过环境变量 CF_ACCOUNT_ID 提供）
      --cf-email <email>        提供 CF_EMAIL（全局 Token 需要，也可通过环境变量 CF_EMAIL 提供）
      --skip-install            跳过 npm install
  -q, --quiet                   安静模式（精简日志输出）
  -h, --help                    显示帮助

示例:
  # 部署到开发环境
  scripts/deploy.sh

  # 部署到生产环境
  scripts/deploy.sh --env production

  # 设置 Secrets 并部署到生产环境（从环境变量读取值）
  CF_API_TOKEN=... CF_ACCOUNT_ID=... scripts/deploy.sh --env production --set-secrets

  # 设置 Secrets 并部署到开发环境（从参数传入值，使用 Scoped Token）
  scripts/deploy.sh --set-secrets --cf-api-token "xxxxx" --cf-account-id "abc123"

  # 使用全局 Token 部署
  scripts/deploy.sh --set-secrets --cf-api-token "global-key" --cf-account-id "abc123" --cf-email "user@example.com"
USAGE
}

log() {
  if [[ "$QUIET" == "false" ]]; then
    echo -e "$@"
  fi
}

err() {
  echo "[错误] $*" >&2
}

# 解析参数
while [[ $# -gt 0 ]]; do
  case "$1" in
    -e|--env)
      ENV_NAME="${2:-}"; shift 2 ;;
    --set-secrets)
      SET_SECRETS=true; shift ;;
    --cf-api-token)
      CF_API_TOKEN_INPUT="${2:-}"; shift 2 ;;
    --cf-account-id)
      CF_ACCOUNT_ID_INPUT="${2:-}"; shift 2 ;;
    --cf-email)
      CF_EMAIL_INPUT="${2:-}"; shift 2 ;;
    --skip-install)
      SKIP_INSTALL=true; shift ;;
    -q|--quiet)
      QUIET=true; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      err "未知参数: $1"; usage; exit 2 ;;
  esac
done

if [[ "$ENV_NAME" != "development" && "$ENV_NAME" != "production" ]]; then
  err "--env 只支持 development 或 production，当前为: $ENV_NAME"; exit 2
fi

cd "$REPO_ROOT"

if [[ ! -f "wrangler.toml" ]]; then
  err "未找到 wrangler.toml，请在项目根目录运行脚本。当前目录: $(pwd)"; exit 1
fi

log "[1/5] 检查 Node 环境与依赖..."
if ! command -v node >/dev/null 2>&1; then
  err "未安装 Node.js，请先安装 Node.js >= 18"; exit 1
fi

if [[ "$SKIP_INSTALL" == "false" ]]; then
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
else
  log "跳过依赖安装"
fi

log "[2/5] 检查 wrangler 可用性..."
if ! npx --yes wrangler --version >/dev/null 2>&1; then
  err "无法运行 wrangler，请确认 devDependencies 中包含 wrangler 或全局已安装。"; exit 1
fi

log "[3/5] 检查 Cloudflare 登录状态..."
if ! npx --yes wrangler whoami >/dev/null 2>&1; then
  err "尚未登录 Cloudflare。请先运行: npx wrangler login"; exit 1
fi

if [[ "$SET_SECRETS" == "true" ]]; then
  log "[4/5] 设置 Secrets 到环境: $ENV_NAME ..."

  CF_API_TOKEN_VAL="${CF_API_TOKEN_INPUT:-${CF_API_TOKEN:-}}"
  CF_ACCOUNT_ID_VAL="${CF_ACCOUNT_ID_INPUT:-${CF_ACCOUNT_ID:-}}"
  CF_EMAIL_VAL="${CF_EMAIL_INPUT:-${CF_EMAIL:-}}"

  if [[ -z "$CF_API_TOKEN_VAL" || -z "$CF_ACCOUNT_ID_VAL" ]]; then
    err "使用 --set-secrets 时必须提供 CF_API_TOKEN 与 CF_ACCOUNT_ID（通过参数或同名环境变量）。"; exit 1
  fi

  # 设置 CF_API_TOKEN
  printf "%s" "$CF_API_TOKEN_VAL" | npx --yes wrangler secret put CF_API_TOKEN --env "$ENV_NAME" || {
    err "设置 CF_API_TOKEN 失败"; exit 1; }

  # 设置 CF_ACCOUNT_ID
  printf "%s" "$CF_ACCOUNT_ID_VAL" | npx --yes wrangler secret put CF_ACCOUNT_ID --env "$ENV_NAME" || {
    err "设置 CF_ACCOUNT_ID 失败"; exit 1; }

  # 设置 CF_EMAIL（如果提供了的话）
  if [[ -n "$CF_EMAIL_VAL" ]]; then
    printf "%s" "$CF_EMAIL_VAL" | npx --yes wrangler secret put CF_EMAIL --env "$ENV_NAME" || {
      err "设置 CF_EMAIL 失败"; exit 1; }
    log "已设置 CF_EMAIL（全局 Token 模式）"
  fi

  log "Secrets 设置完成。"
else
  log "[4/5] 跳过设置 Secrets"
fi

log "[5/5] 开始部署到环境: $ENV_NAME ..."
npx --yes wrangler deploy --env "$ENV_NAME"

log "部署完成 ✅"


