# dsh-hmr — dsh-Hestia Memory Runtime

**全名：dsh-Hestia Memory Runtime**（包名 `dsh-hmr`，工具前缀 `hmr_`，可简称 HMR 认知记忆）。

把 [HMR](https://github.com/snowfoxHQ/HMR) 认知记忆运行时接入 **DeepSeek Harness (dsh)** 的 monorepo。

HMR 提供的不只是"存笔记 + 搜笔记"，而是显式推理链、反思循环、主动遗忘曲线和自我演化。
`dsh-hmr` 把这些能力包装成 dsh 插件，让 harness 里的 agent 拥有跨会话的认知上下文。

> 名称说明：官方 `@deepseek-ai/dsh-hmr` 是**热更新（hot module replacement）**，与
> **dsh-Hestia Memory Runtime** 同名不同物，二者无代码关联。

## 目录结构

monorepo 按「可发布的 dsh 插件」「dsh skill」「共享库」三类分目录：

```
dsh-hmr/
├── docs/
│   └── dsh-listing.md     # 提交给 dsh 插件目录的条目文案（显示名：dsh-Hestia Memory Runtime）
├── packages/
│   └── hmr-client/        # 共享 TS 库，封装 HMR 的 HTTP 接口（独立 npm 包）
├── plugins/
│   └── dsh-hmr/           # dsh 插件本体，注册 hmr_* 工具（独立 npm 包）
├── skills/                # dsh skill 目录（当前为空，见 skills/README.md）
├── patches/               # 插件依赖但上游未合并的服务端修复，构建时打到副本上
└── vendor/
    └── hmr/               # HMR 上游仓库（git submodule，保持 origin 原样）
        ├── hmr/           # Python 认知运行时
        └── service/       # FastAPI HTTP 服务（127.0.0.1:8077）
```

新增内容时的归属：dsh 插件放 `plugins/<name>/`，dsh skill 放 `skills/<name>/`，被多个包复用的
库放 `packages/<name>/`；三者都是 npm workspace，都会随 `npm run build/test` 一起跑。

`vendor/hmr` **保持上游纯净**：子仓永远停在 `origin/main` 的某个提交上，不改文件、不打本地提交。
插件确实需要的上游修复放在 `patches/*.patch`，由 `scripts/vendor-python.mjs` 在复制到
`plugins/dsh-hmr/python/` 之后应用到**副本**上（见 `patches/README.md`）。
这样 `git -C vendor/hmr status` 恒为干净，发布物里又包含修复。

## 架构

```
dsh agent
   │  hmr_* 工具
   ▼
plugins/dsh-hmr         (Node.js 插件)
   │  HTTP + x-hmr-token
   ▼
vendor/hmr/service      (Python · FastAPI · 127.0.0.1:8077)
   │
   ▼
vendor/hmr/hmr          (认知运行时：SQLite + 向量索引 + 推理链)
```

插件默认以 **managed 模式**拉起 Python 子进程；把 `dsh-hmr.process` 设为 `external`
则退化为连接已有服务（适合已经常驻跑着 HMR 的场景）。

## 快速开始

```bash
# 1. 拉取 HMR 子模块
git submodule update --init --recursive

# 2. 安装 Python 依赖（插件通过 PYTHONPATH 直接加载 vendor 源码，无需 pip install -e）
pip install pydantic numpy fastapi uvicorn
pip install sentence-transformers   # 可选，缺失时退化为 TF-IDF

# 3. 安装 Node 依赖并构建
npm install
npm run build

# 4. 自检 Python 环境与内置运行时
node plugins/dsh-hmr/dist/cli.js doctor

# 5. 在 dsh 中启用插件
dsh plugin --profile web add ./plugins/dsh-hmr
```

## 环境变量

插件会把下列变量透传给 HMR 子进程；embedding 后端完全由你在这里决定：

| 变量 | 默认 | 说明 |
|------|------|------|
| `HMR_STORAGE_PATH` | `~/.dsh-hmr/data` | 记忆数据目录；盘符不存在时插件会忽略并回退到默认值 |
| `HMR_HOST` | `127.0.0.1` | 监听地址，不要改成 `0.0.0.0` |
| `HMR_PORT` | `8077` | 服务端口 |
| `HMR_TOKEN` | 空 | 设置后客户端必须带同名 `x-hmr-token` |
| `HMR_ST_MODEL` | `all-MiniLM-L6-v2` | 本地 embedding 模型 |
| `HMR_OLLAMA_MODEL` | 空 | 走 Ollama embedding 时指定模型 |
| `OPENAI_API_KEY` | 空 | 优先级最高的 embedding 来源 |

优先级：`OPENAI_API_KEY` > `HMR_OLLAMA_MODEL` > `HMR_ST_MODEL` > TF-IDF 兜底。

## 工具（暴露给 agent）

| 工具 | 作用 |
|------|------|
| `hmr_ingest` | 写入记忆，可交给 Policy 自动判定类型 |
| `hmr_recall` | 主动召回，支持 Policy 选策略 |
| `hmr_think` | 起一条思考链并记录推理步骤 |
| `hmr_reflect` | 对思考链做反思，产出洞察与建议记忆 |
| `hmr_evolve` | 运行自我演化周期（支持 dry-run 预览） |

## 安全

- 服务只绑 `127.0.0.1`，不要对外开放。
- 不要把抓取来的不可信网页内容直接写进长期记忆（memory poisoning）。
- `HMR_TOKEN` 建议在多人共用的机器上设置。

## 开发

```bash
git clone --recursive https://github.com/snowfoxHQ/dsh-hmr.git   # vendor/hmr 是子模块
npm install
npm run build      # 两个包全量构建（插件会先把 vendor/hmr 复制进 python/ 并打 patch）
npm run typecheck
npm test           # 两个包的集成测试，会真实拉起 Python 服务
```

已 clone 但没带 `--recursive` 时补一步：`git submodule update --init --recursive`。

全链路回归（用真实 agent 跑一遍 `hmr_*` 工具）：

```bash
dsh plugin --profile headless add ./plugins/dsh-hmr
dsh --profile headless "用 hmr_ingest 记录一条记忆，再用 hmr_recall 查回来"
```

`vendor/hmr` 是只读上游子模块，**不要在子仓里做任何提交**。确实需要的服务端修复写成
`patches/*.patch`，由 `vendor:python` 在复制副本时应用（详见 `patches/README.md`）。

### 发布

```bash
npm run preflight     # npm pack 预检：元数据、tarball 清单、解包后 import 冒烟
npm run release:dry   # 干净工作树 + 构建 + 预检 + npm publish --dry-run
npm run release       # 真正发布（默认 latest；可加 -- --tag next --otp 123456）
```

`release` 按 `@dsh-hmr/hmr-client` → `dsh-hmr` 的顺序发布，两个包共用同一个版本号，版本不一致
会直接拒绝。发布前会检查该版本是否已存在于 npm，发布后会回查 `npm view` 确认。

如果本机 npm 指向镜像（`npmmirror` / `taobao` 等），脚本会拒绝发布并提示改用官方源：

```bash
npm run release -- --registry https://registry.npmjs.org
```

首次发布前还需要在 npm 上创建 `@dsh-hmr` scope，并让 registry 指向官方源（镜像只读）。完整的
一次性准备、key/2FA 说明、验证命令与错误排查见 **[RELEASING.md](./RELEASING.md)**。

## License

MIT，与上游 HMR 一致。
