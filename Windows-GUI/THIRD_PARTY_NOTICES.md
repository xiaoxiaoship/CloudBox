# Third-Party Notices / 第三方组件声明

CloudBox 使用以下第三方组件提供 Office 在线预览。组件版权归各自作者所有；CloudBox 未修改其源码。

## Office preview libraries

| 组件 | 版本 | 许可证 | 用途 |
|---|---:|---|---|
| [`docx-preview`](https://www.npmjs.com/package/docx-preview) | 0.4.1 | Apache-2.0 | Word `.docx` 浏览器端渲染 |
| [`exceljs`](https://www.npmjs.com/package/exceljs) | 4.4.0 | MIT | Excel `.xlsx` 解析 |
| [`pptx-preview`](https://www.npmjs.com/package/pptx-preview) | 1.0.7 | ISC（npm 包） | PowerPoint `.pptx` 浏览器端渲染 |

### `pptx-preview` special notice

`pptx-preview` 的 npm 包元数据声明为 ISC，但其 README 同时说明：

- npm 包可免费使用，包括商业使用；
- 源码仅限个人学习，不得将源码发布到互联网平台，不得修改源码后转为自有项目发布。

CloudBox 仅将该 npm 包作为**未修改的运行时依赖**使用，不复制、修改或另行发布其源码。该组件的许可条款以作者发布的 npm 包和 README 为准：

- https://www.npmjs.com/package/pptx-preview
- https://github.com/501351981/pptx-preview

### `pptx-preview` transitive dependencies

| 组件 | 许可证 |
|---|---|
| `jszip` | MIT |
| `lodash` | MIT |
| `tslib` | 0BSD |
| `uuid` | MIT |
| `echarts` | Apache-2.0 |

## Full license texts

完整许可证文本随各 npm 包分发，也可在对应 npm/GitHub 页面查看。发布安装包时应保留本节及所使用的第三方许可证文件。

---

The components above remain copyright of their respective authors. CloudBox does not modify their source code. `pptx-preview` is used only as an unmodified npm runtime dependency; its npm package is free to use, including commercially, while its source has additional restrictions described by its author.
