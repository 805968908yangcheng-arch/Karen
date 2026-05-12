import cors from 'cors'
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import dotenv from 'dotenv'
import express from 'express'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { chromium } from 'playwright'

dotenv.config({ path: '.env.local' })

const app = express()
const port = Number(process.env.API_PORT || 8787)

app.use(cors({ origin: ['http://127.0.0.1:5173', 'http://localhost:5173'] }))
app.use(express.json({ limit: '20mb' }))

const providers = [
  {
    id: 'zhipu',
    name: '智谱 GLM',
    vendor: '智谱 AI',
    model: 'glm-4-flash',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.ZHIPU_API_KEY,
    status: process.env.ZHIPU_API_KEY ? '已启用' : '未配置',
  },
  {
    id: 'qwen',
    name: '通义千问',
    vendor: '阿里云百炼',
    model: 'qwen-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.QWEN_API_KEY,
    status: process.env.QWEN_API_KEY ? '已启用' : '未配置',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    vendor: 'DeepSeek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
    status: process.env.DEEPSEEK_API_KEY ? '已启用' : '未配置',
  },
  {
    id: 'baidu',
    name: '文心一言',
    vendor: '百度智能云千帆',
    model: 'ernie-4.5',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    apiKey: process.env.BAIDU_API_KEY,
    status: process.env.BAIDU_API_KEY ? '已启用' : '未配置',
  },
  {
    id: 'doubao',
    name: '豆包',
    vendor: '火山引擎',
    model: 'doubao-seed',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: process.env.DOUBAO_API_KEY,
    status: process.env.DOUBAO_API_KEY ? '已启用' : '未配置',
  },
  {
    id: 'hunyuan',
    name: '混元',
    vendor: '腾讯云',
    model: 'hunyuan-turbos-latest',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    apiKey: process.env.HUNYUAN_API_KEY,
    status: process.env.HUNYUAN_API_KEY ? '已启用' : '未配置',
  },
]

const defaultProviderId = process.env.DEFAULT_PROVIDER || 'zhipu'

function publicProvider(provider) {
  return {
    id: provider.id,
    name: provider.name,
    vendor: provider.vendor,
    model: provider.model,
    baseUrl: provider.baseUrl,
    status: provider.status,
    maskedKey: provider.apiKey ? maskKey(provider.apiKey) : '未配置',
  }
}

function maskKey(value) {
  if (!value) return '未配置'
  return `${value.slice(0, 6)}••••••••${value.slice(-4)}`
}

function normalizeText(value = '') {
  return String(value).replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim()
}

function extractKeywords(text) {
  const dictionary = [
    'AI', '大模型', 'Agent', 'B 端', 'SaaS', '简历解析', '智能推荐', '数据分析',
    '用户研究', '增长实验', '跨团队', '项目管理', '产品规划', '策略配置',
    '灰度上线', '指标体系', '推荐准确率', '采用率', '复核率',
  ]
  const source = normalizeText(text)
  return dictionary.filter((keyword) => source.toLowerCase().includes(keyword.toLowerCase())).slice(0, 10)
}

function cleanExtractedValue(value = '') {
  return normalizeText(value).replace(/[，,。；;].*$/, '').slice(0, 32) || ''
}

function extractName(text) {
  const normalized = normalizeText(text)
  const explicit = normalized.match(/(?:姓名|名字)[:：]\s*([\u4e00-\u9fa5]{2,4})/)?.[1]
  if (explicit) return explicit
  const firstLine = normalized.split('\n').map((line) => line.trim()).find(Boolean)
  if (firstLine && /^[\u4e00-\u9fa5]{2,4}$/.test(firstLine)) return firstLine
  return '待补充'
}

function extractYears(text) {
  const normalized = normalizeText(text)
  const explicit = normalized.match(/(?:工作年限|工作经验|经验)[:：]\s*(\d+(?:\.\d+)?)\s*年/)?.[1]
  const contextual = normalized.match(/(\d+(?:\.\d+)?)\s*年(?:以上)?(?:工作|产品|项目|运营|研发|数据|经验|经历)/)?.[1]
  return explicit || contextual ? `${explicit || contextual} 年` : '待补充'
}

function extractCurrentTitle(text) {
  const normalized = normalizeText(text)
  const explicit = normalized.match(/(?:当前职位|职位|岗位|职务|现任)[:：]\s*([^\n，,。；;]{2,24})/)?.[1]
  if (explicit) return cleanExtractedValue(explicit)
  const title = normalized.match(/(?:高级|资深|中级|初级)?[\u4e00-\u9fa5A-Za-z ]{0,8}(产品经理|数据分析师|项目经理|运营经理|工程师)/)?.[0]
  return title ? cleanExtractedValue(title) : '待补充'
}

function extractTargetRole(text) {
  const normalized = normalizeText(text)
  const target = normalized.match(/(?:求职意向|意向岗位|目标岗位|目标方向|应聘岗位)[:：]\s*([^\n，,。；;]{2,24})/)?.[1]
  return target ? cleanExtractedValue(target) : '待确认'
}

function extractResumeItems(text, patterns) {
  const normalized = normalizeText(text)
  return patterns
    .filter(({ test }) => test.test(normalized))
    .map(({ label }) => label)
    .slice(0, 4)
}

function parseResume(text, role = 'AI 产品经理') {
  const normalized = normalizeText(text)
  const years = extractYears(normalized)
  const position = extractCurrentTitle(normalized)
  const targetRole = extractTargetRole(normalized)
  const keywords = extractKeywords(normalized)
  const hasMetrics = /%|分钟|小时|天|家|万|增长|下降|提升|覆盖|采用率|准确率/.test(normalized)
  const workExperiences = extractResumeItems(normalized, [
    { test: /招聘|SaaS|筛选|推荐/, label: '招聘 SaaS / 智能筛选相关经历' },
    { test: /增长|转化|留存|实验/, label: '增长实验与数据复盘经历' },
    { test: /B 端|企业端|工作流|后台/, label: 'B 端产品工作流设计经历' },
    { test: /项目管理|跨团队|协同|推进/, label: '跨团队项目推进经历' },
  ])
  const projects = extractResumeItems(normalized, [
    { test: /简历解析|智能筛选|初筛/, label: '简历解析 / 智能初筛项目' },
    { test: /岗位推荐|推荐策略|匹配/, label: '岗位推荐与匹配策略项目' },
    { test: /Agent|大模型|AI/, label: 'AI 应用落地项目' },
    { test: /指标体系|数据看板|复盘/, label: '指标体系与数据复盘项目' },
  ])
  const recognizedSignals = [
    position !== '待补充',
    years !== '待补充',
    targetRole !== '待确认',
    keywords.length > 0,
    workExperiences.length > 0 || projects.length > 0,
  ].filter(Boolean).length
  const missingFields = []
  if (position === '待补充') missingFields.push('当前职位')
  if (years === '待补充') missingFields.push('工作年限')
  if (targetRole === '待确认') missingFields.push('求职目标')
  if (!keywords.length) missingFields.push('技能关键词')
  if (!workExperiences.length && !projects.length) missingFields.push('项目经历')
  if (!hasMetrics) missingFields.push('量化指标')
  return {
    basics: {
      name: extractName(normalized),
      targetRole,
      currentTitle: position,
      years,
      location: normalized.match(/(?:城市|所在地|期望城市)[:：]\s*([^\n，,。；;]{2,24})/)?.[1] || '待补充',
    },
    summary: normalized || '待补充简历内容',
    sections: {
      workExperiences,
      projects,
      skills: keywords,
    },
    metrics: {
      completeness: Math.min(92, Math.max(normalized ? 8 : 0, recognizedSignals * 16 + (normalized.length > 120 ? 12 : 0))),
      match: keywords.length ? Math.min(88, 42 + keywords.length * 6 + (role ? 8 : 0)) : 0,
      quantified: hasMetrics ? 78 : 0,
    },
    missingFields,
  }
}

function analyzeJob(jd, role = 'AI 产品经理') {
  const text = normalizeText(jd)
  const keywords = extractKeywords(`${text} ${role}`)
  return {
    role,
    requirements: keywords.length ? keywords : ['AI 工作流设计', 'B 端复杂系统', '数据指标拆解', '跨团队推进'],
    seniority: text.match(/(\d+)\s*年/)?.[0] || '5 年以上',
    sourcePlatforms: ['Boss直聘', '猎聘', '拉勾', '智联招聘'],
  }
}

function buildMatches(role, requirements) {
  const base = [
    ['Boss直聘', role, '某头部招聘科技公司', '北京', '30-45K'],
    ['猎聘', '智能招聘产品专家', '企业服务独角兽', '上海', '35-50K'],
    ['拉勾', 'B 端 AI 产品经理', '协同办公平台', '杭州', '28-42K'],
    ['智联招聘', '产品经理 - AI Agent', '大型人力资源集团', '深圳', '25-40K'],
    ['Boss直聘', '增长产品经理', 'SaaS 创业公司', '广州', '24-38K'],
    ['猎聘', '招聘平台产品经理', '互联网平台', '北京', '28-45K'],
    ['拉勾', '数据产品经理', '营销技术公司', '上海', '26-40K'],
    ['智联招聘', 'HR SaaS 产品经理', '企业软件公司', '成都', '22-35K'],
    ['Boss直聘', 'AI 应用产品经理', '教育科技公司', '杭州', '25-38K'],
    ['猎聘', '用户增长产品经理', '内容社区平台', '北京', '30-45K'],
  ]
  return base.map(([source, title, company, city, salary], index) => ({
    source,
    title,
    company,
    city,
    salary,
    score: Math.max(76, 94 - index * 2),
    reason: `匹配 ${requirements.slice(0, 3).join('、') || '岗位核心要求'}，建议强化量化成果。`,
  }))
}

function fallbackAssistant(messages = []) {
  const last = messages.at(-1)?.content || ''
  if (/灰度|采用率|覆盖|客户/.test(last)) {
    return '很好，这段可以写成：主导 AI 初筛工作流灰度上线，覆盖 126 家企业客户，3 周后功能采用率达到 68%，推动 HR 初筛耗时从 42 分钟降至 18 分钟。请再补充你在策略配置和跨团队推进中的个人职责。'
  }
  return '你这段经历已经有业务结果了。下一步请补充：你的具体职责、使用了哪些策略或模型能力、上线范围、核心指标变化，以及你如何推动算法、研发、销售协作落地。'
}

function buildOpeningQuestions({ resumeText = '', jd = '', role = 'AI 产品经理' }) {
  const parsed = parseResume(resumeText, role)
  const job = analyzeJob(jd, role)
  const missing = parsed.missingFields.join('、') || '个人贡献边界'
  const skills = parsed.sections.skills.slice(0, 4).join('、') || job.requirements.slice(0, 4).join('、')
  const identity = parsed.basics.currentTitle === '待补充' && parsed.basics.years === '待补充'
    ? '我还没有从简历里识别到你的当前职位和工作年限'
    : `我从简历里识别到：当前职位 ${parsed.basics.currentTitle}，工作年限 ${parsed.basics.years}`
  const projectAnchor = parsed.sections.projects?.[0] || parsed.sections.workExperiences?.[0] || '最有代表性的项目'
  return [
    {
      role: 'assistant',
      content: `我已读取你的简历。${identity}，你选择的求职方向是 ${role}。简历里已经出现了${skills || '少量可用信息'}，但还缺少${missing}。我们先从最能提升简历含金量的一点开始：请讲讲你做“${projectAnchor}”时，个人负责的关键决策是什么？`,
    },
    {
      role: 'assistant',
      content: `请尽量用 STAR 方式回答：业务背景是什么、你具体做了什么、用了哪些策略或技术、结果如何量化。回答后我会继续追问，并把可写入简历的亮点沉淀出来。`,
    },
  ]
}

async function callModel({ providerId, messages }) {
  const provider = providers.find((item) => item.id === providerId) || providers.find((item) => item.id === defaultProviderId)
  if (!provider?.apiKey) {
    return { provider: publicProvider(provider || providers[0]), content: fallbackAssistant(messages), mode: 'local-fallback' }
  }

  const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: 0.4,
      stream: false,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`模型调用失败：${response.status} ${text.slice(0, 180)}`)
  }

  const data = await response.json()
  return {
    provider: publicProvider(provider),
    content: data.choices?.[0]?.message?.content || fallbackAssistant(messages),
    mode: 'remote',
  }
}

function buildOptimizedResume({ resumeText, jd, role, messages = [] }) {
  const parsed = parseResume(resumeText, role)
  const job = analyzeJob(jd, role)
  const conversationFacts = messages.map((item) => item.content || item.text || '').join(' ')
  const hasAdoption = /68%|采用率/.test(conversationFacts)
  return {
    candidate: parsed.basics.name,
    title: `${role} / ${parsed.basics.years}招聘 SaaS 与 B 端产品经验`,
    summary: `具备 ${parsed.basics.years} B 端产品与招聘 SaaS 经验，熟悉 ${job.requirements.slice(0, 4).join('、')}，能够将 AI 能力转化为可落地的业务工作流。`,
    strengths: [
      '主导 AI 初筛工作流从 0 到 1 上线，推动 HR 初筛耗时从 42 分钟下降至 18 分钟。',
      hasAdoption ? '灰度覆盖 126 家企业客户，3 周后功能采用率达到 68%。' : '建议补充灰度范围、采用率、准确率和人工复核率。',
      '协同算法、研发、销售完成需求拆解、策略评审、灰度上线与数据复盘。',
    ],
    projects: [
      {
        name: 'AI 初筛工作流',
        bullets: [
          '负责简历解析、岗位推荐、人工复核闭环的产品方案设计。',
          '建立筛选效率、推荐准确率、采用率等指标体系。',
          '基于岗位要求与用户反馈迭代策略配置，提升招聘团队使用效率。',
        ],
      },
    ],
    keywords: job.requirements,
  }
}

const resumeTemplates = {
  classic: { accent: '15202b', border: 'd7dee7', background: 'ffffff', nameSize: 28, compact: false, label: '经典单栏 Word' },
  modern: { accent: '0f8f88', border: 'bfe4df', background: 'f7fbfb', nameSize: 30, compact: false, label: '现代重点突出' },
  compact: { accent: '23374d', border: 'd7dee7', background: 'ffffff', nameSize: 24, compact: true, label: '紧凑一页版' },
}

function getResumeTemplate(template = 'modern') {
  return resumeTemplates[template] || resumeTemplates.modern
}

function resumeHtml(resume, template = 'modern') {
  const theme = getResumeTemplate(template)
  return `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#15202b;padding:${theme.compact ? '30px 36px' : '44px'};line-height:${theme.compact ? '1.48' : '1.65'};background:#${theme.background}}
    h1{font-size:${theme.nameSize}px;margin:0 0 4px;color:#${theme.accent}} h2{font-size:17px;border-bottom:2px solid #${theme.border};padding-bottom:6px;margin-top:${theme.compact ? '16px' : '24px'};color:#${theme.accent}}
    h3{margin:10px 0 4px;font-size:15px}.muted{color:#5b6977}.tag{display:inline-block;background:#eef7f6;color:#${theme.accent};border:1px solid #${theme.border};border-radius:4px;padding:4px 8px;margin:3px;font-size:12px}
    li{margin:5px 0}.doc-note{font-size:12px;color:#7a8794;text-align:right}
  </style></head><body>
  <div class="doc-note">${theme.label}</div>
  <h1>${resume.candidate}</h1><div class="muted">${resume.title}</div>
  <h2>个人优势</h2><p>${resume.summary}</p><ul>${resume.strengths.map((item) => `<li>${item}</li>`).join('')}</ul>
  <h2>项目经历</h2>${resume.projects.map((project) => `<h3>${project.name}</h3><ul>${project.bullets.map((item) => `<li>${item}</li>`).join('')}</ul>`).join('')}
  <h2>技能关键词</h2>${resume.keywords.map((item) => `<span class="tag">${item}</span>`).join('')}
  </body></html>`
}

function buildResumeDocx(resume, template = 'modern') {
  const theme = getResumeTemplate(template)
  const accent = theme.accent
  const border = { style: BorderStyle.SINGLE, size: 8, color: theme.border }
  const paragraphSpacing = theme.compact ? { after: 90 } : { after: 150 }
  return new Document({
    sections: [{
      properties: {
        page: {
          margin: theme.compact
            ? { top: 720, right: 820, bottom: 720, left: 820 }
            : { top: 920, right: 1000, bottom: 920, left: 1000 },
        },
      },
      children: [
        new Paragraph({
          alignment: template === 'classic' ? AlignmentType.LEFT : AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: resume.candidate, bold: true, size: theme.nameSize * 2, color: accent })],
        }),
        new Paragraph({
          alignment: template === 'classic' ? AlignmentType.LEFT : AlignmentType.CENTER,
          spacing: { after: 220 },
          children: [new TextRun({ text: resume.title, size: 22, color: '5b6977' })],
        }),
        new Paragraph({ text: '个人优势', heading: HeadingLevel.HEADING_2, border: { bottom: border }, spacing: paragraphSpacing }),
        new Paragraph({ text: resume.summary, spacing: paragraphSpacing }),
        ...resume.strengths.map((item) => new Paragraph({ children: [new TextRun(`• ${item}`)], spacing: paragraphSpacing })),
        new Paragraph({ text: '项目经历', heading: HeadingLevel.HEADING_2, border: { bottom: border }, spacing: paragraphSpacing }),
        ...resume.projects.flatMap((project) => [
          new Paragraph({ text: project.name, heading: HeadingLevel.HEADING_3, spacing: { before: 100, after: 60 } }),
          ...project.bullets.map((item) => new Paragraph({ children: [new TextRun(`• ${item}`)], spacing: paragraphSpacing })),
        ]),
        new Paragraph({ text: '技能关键词', heading: HeadingLevel.HEADING_2, border: { bottom: border }, spacing: paragraphSpacing }),
        new Paragraph({ text: resume.keywords.join('  /  '), spacing: paragraphSpacing }),
      ],
    }],
  })
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, defaultProvider: defaultProviderId })
})

app.get('/api/providers', (req, res) => {
  res.json({ providers: providers.map(publicProvider), defaultProvider: defaultProviderId })
})

app.post('/api/parse-file', async (req, res) => {
  try {
    const { name = '', data = '', role = 'AI 产品经理' } = req.body
    const buffer = Buffer.from(String(data).split(',').pop() || '', 'base64')
    let text = ''
    if (/\.docx$/i.test(name)) {
      text = (await mammoth.extractRawText({ buffer })).value
    } else if (/\.pdf$/i.test(name)) {
      const parser = new PDFParse({ data: buffer })
      text = (await parser.getText()).text
      await parser.destroy()
    } else {
      text = buffer.toString('utf8')
    }
    res.json({ text, parsed: parseResume(text, role) })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '文件解析失败' })
  }
})

app.post('/api/analyze-resume', (req, res) => {
  const { text = '', role = 'AI 产品经理' } = req.body
  res.json(parseResume(text, role))
})

app.post('/api/opening-questions', (req, res) => {
  const { resumeText = '', jd = '', role = 'AI 产品经理' } = req.body
  res.json({ messages: buildOpeningQuestions({ resumeText, jd, role }) })
})

app.post('/api/analyze-job', (req, res) => {
  const { jd = '', role = 'AI 产品经理' } = req.body
  const job = analyzeJob(jd, role)
  res.json({ ...job, matches: buildMatches(role, job.requirements) })
})

app.post('/api/chat', async (req, res) => {
  const { providerId = defaultProviderId, messages = [], context = {} } = req.body
  const system = {
    role: 'system',
    content: `你是中文求职简历顾问和模拟面试官。目标岗位：${context.role || 'AI 产品经理'}。
必须基于用户上传/粘贴的简历和岗位 JD 追问，不要泛泛聊天。
简历内容：${String(context.resumeText || '').slice(0, 1800)}
岗位 JD：${String(context.jdText || '').slice(0, 1200)}
请通过追问挖掘 STAR、量化指标、个人贡献、项目难点、岗位匹配证据。每次只问 1-2 个问题，回答要短而具体。`,
  }
  try {
    const result = await callModel({ providerId, messages: [system, ...messages] })
    res.json(result)
  } catch (error) {
    res.json({
      provider: publicProvider(providers.find((item) => item.id === providerId) || providers[0]),
      content: fallbackAssistant(messages),
      mode: 'local-fallback',
      warning: error instanceof Error ? error.message : '模型调用失败，已使用本地兜底',
    })
  }
})

app.post('/api/generate', async (req, res) => {
  const { resumeText = '', jd = '', role = 'AI 产品经理', messages = [] } = req.body
  const resume = buildOptimizedResume({ resumeText, jd, role, messages })
  const job = analyzeJob(jd, role)
  const matches = buildMatches(role, job.requirements)
  res.json({
    resume,
    highlights: resume.strengths,
    requirements: job.requirements,
    matches,
    metrics: {
      completeness: 88,
      match: matches[0]?.score || 90,
      quantified: resume.strengths.some((item) => /%|分钟|家/.test(item)) ? 82 : 58,
    },
  })
})

app.post('/api/export/docx', async (req, res) => {
  const { resume, template = 'modern' } = req.body
  const doc = buildResumeDocx(resume, template)
  const buffer = await Packer.toBuffer(doc)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  res.setHeader('Content-Disposition', 'attachment; filename="resumepilot.docx"')
  res.send(buffer)
})

app.post('/api/export/pdf', async (req, res) => {
  const { resume, template = 'modern' } = req.body
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setContent(resumeHtml(resume, template), { waitUntil: 'networkidle' })
  const buffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '18mm', right: '16mm', bottom: '18mm', left: '16mm' } })
  await browser.close()
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', 'attachment; filename="resumepilot.pdf"')
  res.send(buffer)
})

app.listen(port, () => {
  console.log(`ResumePilot API listening on http://127.0.0.1:${port}`)
})
