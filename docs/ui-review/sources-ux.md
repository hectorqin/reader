# 书源端到端与 UI/UX 验证

## 测试入口

宿主只依赖自包含的 `examples/plugins/demo-chapters` 示例和通用页面 DTO。生产 Web、Fastify、SQLite 与独立 Node 进程共同验证注册、npm 插件激活、创建多个来源、来源搜索和章节阅读；测试使用临时数据目录。

先安装 `server` 和 `web` 依赖，安装 Web 的 Playwright Chromium，然后执行：

```sh
npm run ui:sources --prefix web
node web/tools/ui-review/plugin-extensions.mjs
node web/tools/ui-review/source-search.mjs
```

可以设置 `CHROME_PATH` 指向已有 Chrome。截图输出到 `docs/ui-review/`，默认不提交。后二者使用通用 fixture API，验证生产界面的交互。

## 覆盖范围

- 管理与搜索分开，来源类型和扩展入口由能力声明驱动。
- 添加、编辑与凭据表单使用弹窗；组件测试覆盖关闭、保存失败、焦点返回与搜索状态保留。
- 顶部 Tab 提供 ARIA 状态，支持方向键、Home 和 End。
- 实例扩展页验证 Tab 草稿、表单保存、日志按纯文本渲染及移动/桌面布局。
- 搜索反馈区分无匹配、全部失败和部分失败；结果不会因其它来源失败而丢失。
- 换源失败保留原正文，成功从明确选择的章节开始。
- 桌面书库、来源列表和实例配置使用一致的内容宽度；窄屏不得水平溢出。

页面协议和权限见[扩展设计](../plugin-extensions.md)。测试结果以当前命令输出与 CI 为准，不使用历史通过数量代替本次验证。视口测试不等于 Android 或 iOS 真机验证。
