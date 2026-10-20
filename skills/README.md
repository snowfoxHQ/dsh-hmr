# skills/

dsh skill 的收纳目录。一个 skill 一个子目录：

```
skills/
└── <skill-name>/
    ├── SKILL.md        # 入口：何时使用、怎么做、需要哪些工具
    └── ...             # 该 skill 自带的脚本 / 模板 / 参考资料
```

## 目录约定

| 目录 | 放什么 | 发布形式 |
| --- | --- | --- |
| `packages/` | 被多个包复用的库（当前是 `hmr-client`） | npm 包 |
| `plugins/` | dsh 插件（当前是 `dsh-hmr`） | npm 包 |
| `skills/` | dsh skill，纯提示词 + 资源，不含可执行入口 | 目录分发 |

三者都是 npm workspace（`packages/*`、`plugins/*`、`skills/*`），`npm run build/test` 会一并跑到
`package.json` 里带脚本的目录。

## 现状

本仓库目前**没有** skill：HMR 的能力以插件工具（`hmr_recall` / `hmr_ingest` / `hmr_think` /
`hmr_reflect` / `hmr_evolve`）的形式暴露，工具本身已带描述与参数 schema，不需要再包一层 skill。

后续如果要沉淀「怎么用这些工具做记忆整理」之类的操作流程，就在这里加 `skills/<name>/SKILL.md`，
不要在 `plugins/dsh-hmr` 里塞提示词。
