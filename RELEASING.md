# 发布清单 — dsh-Hestia Memory Runtime

两个 npm 包，**顺序固定**：先 `@dsh-hmr/hmr-client`，再 `dsh-hmr`（插件的 devDependency 指向
client，client 不在 registry 上时插件安装会解析失败）。

版本号由两个 `package.json` 各自声明，**必须一致**，`scripts/preflight.mjs` 会直接拒绝不一致的
组合。

```bash
npm run release:dry -- --registry https://registry.npmjs.org   # 全流程演练，不上传
npm run release     -- --registry https://registry.npmjs.org   # 真正发布
```

---

## 0. 一次性准备

### 0.1 npm 账号与 2FA

已登录账号用 `npm whoami` 确认。发布者账号需要开启 2FA（建议 `Authentication and writes`）：
`https://www.npmjs.com/settings/<user>/profile` → Two-Factor Authentication。

开启后每次 `publish` 要么交互输入 OTP，要么传 `--otp 123456`。

### 0.2 创建 `@dsh-hmr` scope

npm 的 **scope 就是 org 名**，`@dsh-hmr/hmr-client` 能否发布完全取决于账号下有没有 `dsh-hmr`
这个 org。CLI 的 `npm org` 只有 `set` / `rm` / `ls` 三个子命令（`npm org --help` 可验证），
**没有 create**，创建只能走网页。

**先确认名字没被占**——org 名与用户名共用同一命名空间，被占用就永远拿不到这个 scope：

```bash
# 两条都必须返回 404；出现正常页面说明名字已经是别人的
curl -s -o /dev/null -w "%{http_code} org\n"  https://www.npmjs.com/org/dsh-hmr
curl -s -o /dev/null -w "%{http_code} user\n" https://www.npmjs.com/~dsh-hmr
```

网页操作：

1. 用**将来执行发布的那个账号**登录 `https://www.npmjs.com/login`
2. 打开 `https://www.npmjs.com/org/create`（或右上头像菜单 → Organizations → Create organization）
3. **Name 填 `dsh-hmr`**，不要带 `@`。这个名字创建后不能改，等于 scope 永久定名
4. Plan 选 **Free**：公开包免费且不限量；私有包才需要 npm Teams 订阅，本项目用不到
5. 勾选服务条款 → Create
6. 创建者自动是 org 的 **owner**（默认 `developers` 团队同时带上你）

创建后验证身份，`whoami` 必须和建 org 的账号一致：

```bash
npm whoami --registry https://registry.npmjs.org
npm org ls dsh-hmr --registry https://registry.npmjs.org    # 应列出自己，角色 owner
```

网页侧 `https://www.npmjs.com/org/dsh-hmr` 从 `Scope not found` 变成可访问，就说明 scope 生效了。
此时 scope 下还没有包，所以下面这条返回 404 是**正常**的；报 `E403` 才是权限问题：

```bash
npm view @dsh-hmr/hmr-client version --registry https://registry.npmjs.org
```

> scope 名字只影响 npm；GitHub 仓库叫 `snowfoxHQ/dsh-hmr`，两者互不约束。

### 0.3 新建 scope 后要不要重新生成 key？

**不需要。** 分情况看：

| 凭据 | 新建 `@dsh-hmr` 之后 | 说明 |
| --- | --- | --- |
| `npm login` 得到的 session token（`~/.npmrc` 里 `//registry.npmjs.org/:_authToken`） | 不用动 | 按账号授权，自动覆盖新 scope |
| classic token（Automation / Publish） | 不用动 | classic token 对账号下**所有**包与 scope 生效 |
| **granular access token** | **需要改** | 这类 token 显式列出 `Packages and scopes` 权限，旧 token 不含 `@dsh-hmr` 会 403；到 `https://www.npmjs.com/settings/<user>/tokens` 编辑该 token 勾上 `@dsh-hmr`（Read and write），或新建一个 |
| 2FA TOTP secret / 恢复码 | 不变 | scope 与 2FA 无关 |
| GitHub deploy key / PAT | 无关 | npm 发布不经过 GitHub |

结论：用 `npm login` 或 classic token 的，创建完 scope 直接发布即可；只有你在 CI 里用 granular
token 才需要回后台补授权。

顺带记一下 npm 正在收紧「绕过 2FA 的 granular token」：2026-08 起这类 token 不能再用执行
账户 / 包 / 组织的管理操作（含 org membership 与 package 授权），2027-01 前后不能再直接
`publish`，只能 staging 后由人工 2FA 放行。本仓库走的是人工 `npm login` + `--otp`，不受影响；
以后接 CI 应该用 trusted publishing（OIDC），别长期 token。

### 0.4 registry 必须指向官方源

镜像（`registry.npmmirror.com`、`cnpm`、各云厂商）**只读**，往上报一定 403。检查：

```bash
npm config get registry
```

两种解法（推荐第二种，只影响本仓库）：

```bash
# 单次：把官方源显式传给发布脚本
npm run release -- --registry https://registry.npmjs.org

# 长期：在本仓库写死官方源
npm config set registry https://registry.npmjs.org --location=project
```

`scripts/publish.mjs` 会检测到镜像域名并直接退出，同时打印上面两条命令。

---

## 1. 发布前检查

```bash
git status --porcelain        # 必须为空，release 会拒绝脏工作树
npm run release:dry -- --registry https://registry.npmjs.org
```

`release:dry` 依次做：registry 检查 → 工作树干净 → `npm whoami` 登录检查 → `npm run build`
→ `npm run preflight` → 版本是否已在 registry 上 → `npm publish --dry-run`（两个包各一次）。

`preflight` 单独跑也行，它校验：必填元数据、两包版本一致、tarball 清单（必含 `dist/*`、
`cordis.patch.yml`、`python/service/server.py`、`python/LICENSE`、包内 `LICENSE`）、禁含
`src/` `test/` `node_modules/` `__pycache__` `.tsbuildinfo`、`python/` 是否已打
`patches/*.patch`、以及**解包 tarball 后真实 `import` 入口**。

还要确认 `CHANGELOG.md` 已写当前版本条目，否则 npm 页面和仓库历史对不上。

---

## 2. 发布

```bash
npm login --registry https://registry.npmjs.org
npm whoami

npm run release -- --registry https://registry.npmjs.org
# 开了 2FA 且不想交互：
npm run release -- --registry https://registry.npmjs.org --otp 123456
# 预发布版本走 next tag，避免 `npm i dsh-hmr` 拉到：
npm run release -- --tag next
```

`release` 与 dry-run 走同一套检查，只是把 `--dry-run` 去掉；每个包发布成功后立刻 `npm view`
回查 version，任何一个包失败都会中止后续包并返回非 0。

---

## 3. 发布后验证

```bash
npm view @dsh-hmr/hmr-client version --registry https://registry.npmjs.org
npm view dsh-hmr version repository.url --registry https://registry.npmjs.org

# 干净目录里装一次（不要用本仓库的 node_modules）
mkdir /tmp/dsh-hmr-smoke && cd /tmp/dsh-hmr-smoke
npm init -y
npm i dsh-hmr --registry https://registry.npmjs.org
npx dsh-hmr doctor
```

`repository.url` 应指向 `github.com/snowfoxHQ/dsh-hmr`；`doctor` 会报告 Python 环境、内置
`python/` 运行时与端口占用情况。

---

## 4. 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `E403 Forbidden — PUT .../@dsh-hmr%2fhmr-client` | scope 不存在，或当前账号不是该 org 成员 | 按 0.2 创建 org；确认 `npm whoami` 是创建者 |
| `E403 ... 402 Payment Required` | scope 下想发私有包 | 保持 `--access public`（脚本默认按包名自动加），或升级付费 plan |
| `EOTP` | 账号开了 2FA | 加 `--otp <6位>`，或交互式重跑 |
| `EPUBLISHCONFLICT` / `E409` | 该版本已存在 | 改版本号，**不要**复用已发布版本 |
| `404 Not Found - PUT` | registry 是镜像 / 打错了地址 | 确认 `--registry https://registry.npmjs.org` |
| `preflight: python/service/server.py is missing the patches/0001 ...` | `plugins/dsh-hmr/python/` 是旧副本 | `npm run vendor:python` 后重试 |
| `npm pack` 输出解析失败 | `prepack` 的 stdout 混进了 JSON | 已由 `parseTrailingJson` 兜住；再出现就贴完整输出排查 |
| `EJSONPARSE` on package.json | 手工改坏 | `node -e "require('./plugins/dsh-hmr/package.json')"` 定位 |

---

## 5. 撤销与弃用

- npm 只允许在**发布后 72 小时内**且无其他包依赖时 `npm unpublish <pkg>@<version>`；超过窗口
  需联系 npm support。
- 已被人依赖的版本不要删，改用 `npm deprecate dsh-hmr@0.1.0 "原因 + 替代版本"`，用户 `npm i`
  时会看到警告。
- 撤销后记得同步 `CHANGELOG.md`。

---

## 6. 以后加包

`scripts/publish.mjs` 顶部的 `PACKAGES` 数组就是发布顺序；新增插件/库时：

```js
const PACKAGES = ['packages/hmr-client', 'plugins/dsh-hmr', 'skills/<name>'];
```

同时在 `scripts/preflight.mjs` 的 `PACKAGES` 里补一条（`dir`、`required`、`entry`）。两处路径
都相对仓库根，`plugins/` 下必须是可发布的 npm 包，`skills/` 下若只是 `SKILL.md` 目录则不参与发布。
