# ResumePilot

Karen 的 AI 简历优化与模拟面试本地 Web 应用。

## 功能

- 上传、粘贴并解析简历内容
- 基于简历和目标岗位进行 AI 追问
- 支持国产大模型配置：智谱、通义千问、DeepSeek、文心、豆包、混元
- 生成可投递简历预览
- 提供 Word 样式模板并导出 DOCX / PDF
- 展示岗位推荐参考，但导出的简历不包含岗位列表

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run api
npm run dev -- --host 127.0.0.1
```

打开 `http://127.0.0.1:5173/`。

## 环境变量

真实 API Key 请只放在本机 `.env.local` 中，不要提交到 GitHub。
