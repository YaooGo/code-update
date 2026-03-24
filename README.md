# Code Update 部署工具

一个轻量、安全的 Web 部署工具，通过浏览器上传文件，自动通过 SSH/SFTP 部署到远程服务器。

## 特性

- 🚀 **一键部署** — 上传 zip 文件，自动备份、解压、重命名
- 🔐 **加密存储** — 服务器密码 AES-256-GCM 加密存储
- 📡 **实时日志** — 部署过程实时流式输出到浏览器
- 💾 **多配置** — 可配置多个服务器和部署模板
- 🎨 **美观界面** — 暗色主题，拖拽上传

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

```bash
npm start
# 或开发模式（Node.js 18+）
npm run dev
```

打开浏览器访问 http://localhost:3000

### 3. 首次配置

1. **服务器** 标签页 → 新增服务器（填写 IP、用户名、密码）
2. **部署配置** 标签页 → 新增部署模板（配置路径、备份策略）
3. **部署** 标签页 → 选择配置，上传文件，点击「开始部署」

## 部署工作流示例

以将 `dist.zip` 部署到 `/var/www/flowwebnew` 为例：

| 配置项 | 值 |
|---|---|
| 远程上传目录 | `/var/www/` |
| zip 内文件夹 | `dist` |
| 目标目录名 | `flowwebnew` |
| 备份目录名 | `flowwebnew` |

自动执行步骤：
1. 上传 `dist.zip` → `/var/www/dist.zip`
2. 备份 `flowwebnew` → `flowwebnew_backup_202503201730`
3. 解压 `dist.zip`
4. 移动 `dist` → `flowwebnew`
5. 清理临时文件

## 安全说明

- 密码用 AES-256-GCM 加密，密钥存储于 `.secret_key`（权限 600）
- `.secret_key` 和 `data/` 已加入 `.gitignore`
- 仅在内网使用，不要暴露到公网

## 目录结构

```
code-update/
├── app.js            # 主入口
├── src/
│   ├── crypto.js     # 加密工具
│   ├── sshDeploy.js  # SSH 部署逻辑
│   └── routes/       # API 路由
├── public/           # 前端静态文件
├── data/             # 配置数据（gitignored）
└── uploads/          # 临时上传目录（gitignored）
```
