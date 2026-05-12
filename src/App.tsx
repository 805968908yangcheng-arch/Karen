import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  Check,
  ClipboardList,
  Download,
  FileText,
  KeyRound,
  Mic,
  MicOff,
  MessageSquareText,
  PenLine,
  PlugZap,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react'
import './App.css'

type StepId = 'intake' | 'target' | 'jobs' | 'interview' | 'export'
type TemplateId = 'classic' | 'modern' | 'compact'
type ChatMessage = { role: 'assistant' | 'user'; content: string; mode?: string }
type Provider = { id: string; name: string; vendor: string; model: string; baseUrl: string; status: string; maskedKey: string }
type JobMatch = { source: string; title: string; company: string; city: string; salary: string; score: number; reason: string }
type GeneratedResume = {
  candidate: string
  title: string
  summary: string
  strengths: string[]
  projects: Array<{ name: string; bullets: string[] }>
  keywords: string[]
}
type Analysis = {
  basics: { name?: string; currentTitle: string; years: string; targetRole: string; location?: string }
  sections: { skills: string[] }
  metrics: { completeness: number; match: number; quantified: number }
  missingFields: string[]
}

const steps: Array<{ id: StepId; title: string; detail: string }> = [
  { id: 'intake', title: '上传简历', detail: 'PDF / DOCX / 文本' },
  { id: 'target', title: '求职方向', detail: '岗位、城市、薪资' },
  { id: 'jobs', title: '导入岗位', detail: 'JD 与平台来源' },
  { id: 'interview', title: 'AI 对话', detail: '国产大模型驱动' },
  { id: 'export', title: '免费导出', detail: 'Word 模板、DOCX' },
]

const roles = ['AI 产品经理', '增长产品经理', 'B 端产品经理', '数据分析师', '运营策略', '项目经理']

const defaultResumeText =
  '高级产品经理，6 年经验。负责招聘 SaaS 智能筛选、岗位推荐、企业端增长实验，主导多个从 0 到 1 项目。上线后 HR 初筛时间从 42 分钟降到 18 分钟。'

const defaultJdText =
  '岗位职责：负责 AI 招聘产品规划，设计智能推荐、简历解析、面试辅助等能力。要求：5 年以上产品经验，熟悉 B 端工作流，有 AI 应用落地经验，数据驱动。'

const templates: Array<{ id: TemplateId; name: string; hint: string }> = [
  { id: 'classic', name: '经典单栏 Word', hint: '黑白清爽，适合通用投递和打印' },
  { id: 'modern', name: '现代重点突出', hint: '强化标题、成果和关键词层级' },
  { id: 'compact', name: '紧凑一页版', hint: '高信息密度，适合经历较多的候选人' },
]

const stepIcons = {
  intake: Upload,
  target: BriefcaseBusiness,
  jobs: Search,
  interview: MessageSquareText,
  export: Download,
}

const fallbackProviders: Provider[] = [
  { id: 'zhipu', name: '智谱 GLM', vendor: '智谱 AI', model: 'glm-4-flash', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', status: '已启用', maskedKey: '已配置' },
  { id: 'qwen', name: '通义千问', vendor: '阿里云百炼', model: 'qwen-plus', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', status: '未配置', maskedKey: '未配置' },
  { id: 'deepseek', name: 'DeepSeek', vendor: 'DeepSeek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', status: '未配置', maskedKey: '未配置' },
  { id: 'baidu', name: '文心一言', vendor: '百度智能云千帆', model: 'ernie-4.5', baseUrl: 'https://qianfan.baidubce.com/v2', status: '未配置', maskedKey: '未配置' },
  { id: 'doubao', name: '豆包', vendor: '火山引擎', model: 'doubao-seed', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', status: '未配置', maskedKey: '未配置' },
  { id: 'hunyuan', name: '混元', vendor: '腾讯云', model: 'hunyuan-turbos-latest', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', status: '未配置', maskedKey: '未配置' },
]

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike
type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
type SpeechRecognitionEventLike = {
  results: ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }>
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<T>
}

function App() {
  const [activeStep, setActiveStep] = useState<StepId>('intake')
  const [selectedRole, setSelectedRole] = useState('AI 产品经理')
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>('modern')
  const [providers, setProviders] = useState<Provider[]>(fallbackProviders)
  const [selectedProvider, setSelectedProvider] = useState('zhipu')
  const [resumeText, setResumeText] = useState(defaultResumeText)
  const [jdText, setJdText] = useState(defaultJdText)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [requirements, setRequirements] = useState<string[]>(['AI 工作流设计', 'B 端复杂系统', '数据指标拆解', '跨团队推进'])
  const [matches, setMatches] = useState<JobMatch[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: '请先上传或粘贴你的简历。我会读取简历后，围绕你的真实经历和目标岗位开始追问。' },
  ])
  const [reply, setReply] = useState('补充灰度范围：覆盖 126 家企业客户，3 周后采用率达到 68%。')
  const [generated, setGenerated] = useState<GeneratedResume | null>(null)
  const [status, setStatus] = useState('本地服务准备中')
  const [isBusy, setIsBusy] = useState(false)

  const activeIndex = steps.findIndex((step) => step.id === activeStep)
  const progress = useMemo(() => Math.round(((activeIndex + 1) / steps.length) * 100), [activeIndex])
  const currentProvider = providers.find((provider) => provider.id === selectedProvider) || providers[0]
  const metrics = analysis?.metrics || { completeness: 78, match: matches[0]?.score || 84, quantified: 56 }
  const highlights = generated?.strengths || [
    '将“负责智能筛选模块”改写为“主导 AI 初筛工作流，推动 HR 初筛耗时下降 57%”。',
    '补充推荐准确率、采用率、人工复核率三个指标，增强可信度。',
    '把跨团队协作写成业务闭环：需求拆解、策略评审、灰度上线、数据复盘。',
  ]

  useEffect(() => {
    api<{ providers: Provider[]; defaultProvider: string }>('/api/providers')
      .then((data) => {
        setProviders(data.providers)
        setSelectedProvider(data.defaultProvider)
        setStatus('本地 API 已连接')
      })
      .catch(() => setStatus('未连接本地 API，当前为前端预览模式'))
  }, [])

  const goNext = () => {
    const next = steps[Math.min(activeIndex + 1, steps.length - 1)]
    setActiveStep(next.id)
  }

  async function parseResume(next = true) {
    setIsBusy(true)
    try {
      const result = await api<Analysis>('/api/analyze-resume', {
        method: 'POST',
        body: JSON.stringify({ text: resumeText, role: selectedRole }),
      })
      setAnalysis(result)
      setRequirements(result.sections.skills)
      setStatus('简历已完成结构化解析')
      await refreshOpeningQuestions()
      if (next) goNext()
    } finally {
      setIsBusy(false)
    }
  }

  async function parseFile(file: File) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    setIsBusy(true)
    try {
      const result = await api<{ text: string; parsed: Analysis }>('/api/parse-file', {
        method: 'POST',
        body: JSON.stringify({ name: file.name, data, role: selectedRole }),
      })
      setResumeText(result.text || resumeText)
      setAnalysis(result.parsed)
      setStatus(`已解析文件：${file.name}`)
      await refreshOpeningQuestions(result.text || resumeText)
    } finally {
      setIsBusy(false)
    }
  }

  async function analyzeJob(next = true) {
    setIsBusy(true)
    try {
      const result = await api<{ requirements: string[]; matches: JobMatch[] }>('/api/analyze-job', {
        method: 'POST',
        body: JSON.stringify({ jd: jdText, role: selectedRole }),
      })
      setRequirements(result.requirements)
      setMatches(result.matches)
      setStatus('岗位要求与匹配列表已生成')
      await refreshOpeningQuestions()
      if (next) goNext()
    } finally {
      setIsBusy(false)
    }
  }

  async function refreshOpeningQuestions(nextResumeText = resumeText) {
    try {
      const result = await api<{ messages: ChatMessage[] }>('/api/opening-questions', {
        method: 'POST',
        body: JSON.stringify({ resumeText: nextResumeText, jd: jdText, role: selectedRole }),
      })
      setChatMessages(result.messages)
    } catch {
      setChatMessages([
        {
          role: 'assistant',
          content: `我已读取你的简历和目标岗位。接下来我会围绕 ${selectedRole} 追问：你最有代表性的项目是什么？你个人负责的关键决策、量化结果和协作推进分别是什么？`,
        },
      ])
    }
  }

  async function sendMessage() {
    const content = reply.trim()
    if (!content) return
    const nextMessages = [...chatMessages, { role: 'user' as const, content }]
    setChatMessages(nextMessages)
    setReply('')
    setIsBusy(true)
    try {
      const result = await api<{ content: string; mode: string; warning?: string }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ providerId: selectedProvider, messages: nextMessages, context: { role: selectedRole, resumeText, jdText } }),
      })
      setChatMessages([...nextMessages, { role: 'assistant', content: result.content, mode: result.mode }])
      setStatus(result.warning ? '模型不可用，已使用本地兜底回复' : `AI 回复完成：${result.mode === 'remote' ? '真实模型' : '本地兜底'}`)
    } finally {
      setIsBusy(false)
    }
  }

  async function generateResult() {
    setIsBusy(true)
    try {
      const result = await api<{ resume: GeneratedResume; highlights: string[]; requirements: string[]; matches: JobMatch[]; metrics: Analysis['metrics'] }>('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ resumeText, jd: jdText, role: selectedRole, messages: chatMessages, template: selectedTemplate }),
      })
      setGenerated(result.resume)
      setRequirements(result.requirements)
      setMatches(result.matches)
      setAnalysis((old) => ({
        basics: old?.basics || { currentTitle: '待补充', years: '待补充', targetRole: '待确认' },
        sections: { skills: result.requirements },
        metrics: result.metrics,
        missingFields: old?.missingFields || [],
      }))
      setStatus('优化简历、岗位匹配与导出内容已生成')
      setActiveStep('export')
    } finally {
      setIsBusy(false)
    }
  }

  async function downloadFile(kind: 'docx' | 'pdf') {
    if (!generated) await generateResult()
    const latestResume = generated || buildClientResume(selectedRole, requirements)
    const response = await fetch(`/api/export/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: latestResume, template: selectedTemplate }),
    })
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `resumepilot.${kind}`
    link.click()
    URL.revokeObjectURL(url)
    setStatus(`${kind.toUpperCase()} 已生成并开始下载`)
  }

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="流程导航">
        <div className="brand">
          <div className="brand-mark"><FileText size={21} /></div>
          <div><p className="eyebrow">ResumePilot</p><h1>AI 简历工作台</h1></div>
        </div>

        <nav className="step-list">
          {steps.map((step, index) => {
            const Icon = stepIcons[step.id]
            const isActive = step.id === activeStep
            const isDone = index < activeIndex
            return (
              <button className={`step-item ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`} key={step.id} onClick={() => setActiveStep(step.id)} type="button">
                <span className="step-icon">{isDone ? <Check size={17} /> : <Icon size={17} />}</span>
                <span><strong>{step.title}</strong><small>{step.detail}</small></span>
              </button>
            )
          })}
        </nav>

        <div className="privacy-note">
          <ShieldCheck size={18} />
          <span>全流程免费。模型密钥只保存在本地服务端 `.env.local`，不会暴露到浏览器。</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">第 {activeIndex + 1} 步 / 5</p><h2>{steps[activeIndex].title}</h2></div>
          <div className="progress-wrap" aria-label={`流程进度 ${progress}%`}>
            <span>{progress}%</span><div className="progress-track"><div style={{ width: `${progress}%` }} /></div>
          </div>
        </header>

        <div className="status-strip">{isBusy ? '处理中...' : status}</div>

        <div className="mobile-steps">
          {steps.map((step) => (
            <button aria-label={step.title} className={step.id === activeStep ? 'selected' : ''} key={step.id} onClick={() => setActiveStep(step.id)} type="button" />
          ))}
        </div>

        <div className="content-grid">
          <section className="task-panel">
            {activeStep === 'intake' && <IntakeStep isBusy={isBusy} onFile={parseFile} onNext={() => parseResume(true)} resumeText={resumeText} setResumeText={setResumeText} analysis={analysis} />}
            {activeStep === 'target' && <TargetStep onNext={() => analyzeJob(true)} selectedRole={selectedRole} setSelectedRole={setSelectedRole} requirements={requirements} />}
            {activeStep === 'jobs' && <JobImportStep jdText={jdText} setJdText={setJdText} requirements={requirements} onNext={() => analyzeJob(true)} />}
            {activeStep === 'interview' && <InterviewStep chatMessages={chatMessages} currentProvider={currentProvider} providers={providers} reply={reply} selectedProvider={selectedProvider} setReply={setReply} setSelectedProvider={setSelectedProvider} onSend={sendMessage} onNext={generateResult} isBusy={isBusy} />}
            {activeStep === 'export' && <ExportStep generated={generated} matches={matches} selectedRole={selectedRole} selectedTemplate={selectedTemplate} setSelectedTemplate={setSelectedTemplate} onDownload={downloadFile} />}
          </section>

          <aside className="insight-panel">
            <InsightPanel activeStep={activeStep} currentProvider={currentProvider} highlights={highlights} metrics={metrics} selectedRole={selectedRole} />
          </aside>
        </div>
      </section>
    </main>
  )
}

function IntakeStep({ isBusy, onFile, onNext, resumeText, setResumeText, analysis }: { isBusy: boolean; onFile: (file: File) => void; onNext: () => void; resumeText: string; setResumeText: (value: string) => void; analysis: Analysis | null }) {
  const parsedFields = analysis ? [
    analysis.basics.currentTitle !== '待补充',
    analysis.basics.years !== '待补充',
    analysis.sections.skills.length > 0,
    analysis.basics.targetRole !== '待确认',
  ].filter(Boolean).length : 0
  const skillsText = analysis?.sections.skills.length ? analysis.sections.skills.slice(0, 3).join(' / ') : '待补充'
  const previewRows = [
    ['姓名', analysis?.basics.name || '待补充'],
    ['当前职位', analysis?.basics.currentTitle || '待补充'],
    ['工作年限', analysis?.basics.years || '待补充'],
    ['关键词', skillsText],
    ['目标方向', analysis?.basics.targetRole || '待确认'],
  ]
  return (
    <div className="step-screen">
      <div className="screen-heading"><span className="pill">本地解析</span><h3>先上传或粘贴你的现有简历</h3><p>支持文本、DOCX、PDF 本地解析，解析结果会进入后续 AI 对话与简历生成。</p></div>
      <div className="intake-layout">
        <label className="upload-zone">
          <input accept=".pdf,.docx,.txt" onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} type="file" />
          <Upload size={26} /><strong>拖入 PDF / DOCX，或点击上传</strong><span>文件会发送到本地 API 解析，不上传第三方平台</span>
        </label>
        <div className="paste-card"><div className="field-label"><PenLine size={17} /><span>粘贴简历文本</span></div><textarea onChange={(event) => setResumeText(event.target.value)} value={resumeText} /></div>
      </div>
      <div className="parsed-card"><p className="eyebrow">解析预览</p><h4>{analysis ? `从简历中识别到 ${parsedFields} 项信息，${analysis.missingFields.length} 项待补充` : '等待解析简历内容'}</h4><div className="profile-grid">{previewRows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>{analysis?.missingFields.length ? <p className="parse-hint">待补充：{analysis.missingFields.join('、')}</p> : null}</div>
      <FooterAction label={isBusy ? '解析中...' : '解析并继续'} onClick={onNext} />
    </div>
  )
}

function TargetStep({ onNext, selectedRole, setSelectedRole, requirements }: { onNext: () => void; selectedRole: string; setSelectedRole: (role: string) => void; requirements: string[] }) {
  return (
    <div className="step-screen">
      <div className="screen-heading"><span className="pill">岗位定位</span><h3>把简历优化目标对准具体岗位</h3><p>选择越明确，后续追问和简历改写越能贴近招聘方的真实要求。</p></div>
      <div className="role-search"><Search size={18} /><input onChange={(event) => setSelectedRole(event.target.value)} value={selectedRole} /><button onClick={onNext} type="button">分析</button></div>
      <div className="chip-grid">{roles.map((role) => <button className={role === selectedRole ? 'selected' : ''} key={role} onClick={() => setSelectedRole(role)} type="button">{role}</button>)}</div>
      <div className="preference-grid">{['北京 / 上海 / 杭州', '25-45K', '5-8 年经验', 'B 端 SaaS / AI 应用'].map((item) => <div className="preference-card" key={item}><span>偏好</span><strong>{item}</strong></div>)}</div>
      <div className="requirement-band"><p className="eyebrow">当前识别能力标签</p><div>{requirements.map((tag) => <span key={tag}>{tag}</span>)}</div></div>
      <FooterAction label="继续导入岗位 JD" onClick={onNext} />
    </div>
  )
}

function JobImportStep({ jdText, setJdText, requirements, onNext }: { jdText: string; setJdText: (value: string) => void; requirements: string[]; onNext: () => void }) {
  return (
    <div className="step-screen">
      <div className="screen-heading"><span className="pill">用户授权采集</span><h3>导入你正在看的岗位要求</h3><p>本地版支持粘贴 JD 或岗位页面文本，生成岗位要求和匹配列表。</p></div>
      <div className="job-import-card"><div className="field-label"><ClipboardList size={17} /><span>岗位描述 / JD</span></div><textarea onChange={(event) => setJdText(event.target.value)} value={jdText} /></div>
      <div className="source-row">{['Boss直聘', '猎聘', '拉勾', '智联招聘'].map((source) => <button key={source} type="button">{source}</button>)}</div>
      <div className="requirement-band"><p className="eyebrow">已识别岗位关键词</p><div>{requirements.concat(['简历解析', '智能推荐']).slice(0, 10).map((tag) => <span key={tag}>{tag}</span>)}</div></div>
      <FooterAction label="分析 JD 并开始 AI 对话" onClick={onNext} />
    </div>
  )
}

function InterviewStep({ chatMessages, currentProvider, isBusy, onNext, onSend, providers, reply, selectedProvider, setReply, setSelectedProvider }: { chatMessages: ChatMessage[]; currentProvider: Provider; isBusy: boolean; onNext: () => void; onSend: () => void; providers: Provider[]; reply: string; selectedProvider: string; setReply: (value: string) => void; setSelectedProvider: (value: string) => void }) {
  const [isListening, setIsListening] = useState(false)
  const canUseSpeech = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

  function startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setReply('当前浏览器不支持语音识别。请使用 Chrome 或支持 Web Speech API 的浏览器。')
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = true
    setIsListening(true)
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0].transcript).join('')
      setReply(transcript)
    }
    recognition.onerror = () => setIsListening(false)
    recognition.onend = () => setIsListening(false)
    recognition.start()
  }

  return (
    <div className="step-screen interview-screen">
      <div className="screen-heading"><span className="pill">国产大模型接入</span><h3>像面试一样追问，也像简历顾问一样沉淀亮点</h3><p>当前通过本地 API 代理调用 {currentProvider.name}，模型密钥不会进入浏览器。</p></div>
      <ModelConnector currentProvider={currentProvider} providers={providers} selectedProvider={selectedProvider} setSelectedProvider={setSelectedProvider} />
      <div className="chat-panel">{chatMessages.map((message, index) => <div className={`chat-row ${message.role === 'user' ? 'user' : 'ai'}`} key={`${message.role}-${index}`}><div className="avatar">{message.role === 'user' ? '你' : 'AI'}</div><p>{message.content}{message.mode === 'local-fallback' ? <small> 本地兜底</small> : null}</p></div>)}</div>
      <div className="voice-note">{canUseSpeech ? '支持语音输入：点击麦克风开始说话，识别结果会进入输入框。' : '当前浏览器不支持 Web Speech API，可继续使用文字输入。'}</div>
      <div className="reply-bar">
        <input onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onSend()} value={reply} />
        <button aria-label="语音输入" className={`voice-button ${isListening ? 'listening' : ''}`} onClick={startVoiceInput} type="button">
          {isListening ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <button disabled={isBusy} onClick={onSend} type="button">发送</button>
      </div>
      <FooterAction label={isBusy ? '生成中...' : '生成优化简历与岗位匹配'} onClick={onNext} />
    </div>
  )
}

function ExportStep({ generated, matches, onDownload, selectedRole, selectedTemplate, setSelectedTemplate }: { generated: GeneratedResume | null; matches: JobMatch[]; onDownload: (kind: 'docx' | 'pdf') => void; selectedRole: string; selectedTemplate: TemplateId; setSelectedTemplate: (template: TemplateId) => void }) {
  const resume = generated || buildClientResume(selectedRole, ['AI 工作流设计', 'B 端复杂系统'])
  return (
    <div className="step-screen export-screen">
      <div className="screen-heading"><span className="pill">结果预览</span><h3>一版面向 {selectedRole} 的可投递简历</h3><p>选择 Word 样式模板后，系统会把优化好的简历内容填入模板；下载文件只包含你的本人简历，不包含岗位推荐。</p></div>
      <div className="template-tabs">{templates.map((template) => <button className={template.id === selectedTemplate ? 'selected' : ''} key={template.id} onClick={() => setSelectedTemplate(template.id)} type="button"><strong>{template.name}</strong><span>{template.hint}</span></button>)}</div>
      <div className={`resume-preview word-${selectedTemplate}`}><div className="resume-head"><div><h4>{resume.candidate}</h4><p>{resume.title}</p></div><span>Word 简历</span></div><section><h5>个人优势</h5><p>{resume.summary}</p>{resume.strengths.map((item) => <p key={item}>• {item}</p>)}</section><section><h5>项目经历</h5>{resume.projects.map((project) => <div className="resume-project" key={project.name}><strong>{project.name}</strong><p>{project.bullets.join(' ')}</p></div>)}</section><section><h5>关键词</h5><div className="resume-tags">{resume.keywords.map((item) => <span key={item}>{item}</span>)}</div></section></div>
      <div className="export-actions"><button className="primary-action locked" onClick={() => onDownload('docx')} type="button"><Download size={18} />下载可投递 Word 简历</button><button className="secondary-action" onClick={() => onDownload('pdf')} type="button"><Download size={18} />下载可投递 PDF 简历</button></div>
      <div className="job-reference"><div className="section-title"><p className="eyebrow">岗位推荐参考</p><span>以下岗位不会写入下载的简历文件</span></div><div className="job-list">{matches.slice(0, 10).map((item) => <article key={`${item.source}-${item.title}`}><div><span className="source">{item.source}</span><h4>{item.title}</h4><p>{item.company} · {item.city} · {item.salary}</p><p>{item.reason}</p></div><strong>{item.score}%</strong></article>)}</div></div>
    </div>
  )
}

function ModelConnector({ currentProvider, providers, selectedProvider, setSelectedProvider }: { currentProvider: Provider; providers: Provider[]; selectedProvider: string; setSelectedProvider: (provider: string) => void }) {
  return (
    <div className="model-card">
      <div className="model-card-head"><div><p className="eyebrow">模型路由</p><h4>选择 AI 对话使用的大模型</h4></div><span>OpenAI 兼容接口</span></div>
      <div className="provider-grid">{providers.map((provider) => <button className={provider.id === selectedProvider ? 'selected' : ''} key={provider.id} onClick={() => setSelectedProvider(provider.id)} type="button"><strong>{provider.name}</strong><span>{provider.vendor} · {provider.model}</span><em>{provider.status}</em></button>)}</div>
      <div className="api-config-grid"><label><span>API Base URL</span><input readOnly value={currentProvider.baseUrl} /></label><label><span>API Key</span><input readOnly type="password" value={currentProvider.maskedKey} /></label><label><span>当前模型</span><input readOnly value={currentProvider.model} /></label></div>
    </div>
  )
}

function InsightPanel({ activeStep, currentProvider, highlights, metrics, selectedRole }: { activeStep: StepId; currentProvider: Provider; highlights: string[]; metrics: Analysis['metrics']; selectedRole: string }) {
  const signals = [
    { label: '简历完整度', value: metrics.completeness, tone: 'good' },
    { label: '岗位匹配度', value: metrics.match, tone: 'strong' },
    { label: '量化成果', value: metrics.quantified, tone: 'warn' },
  ]
  return (
    <div className="insights">
      <div className="score-card"><p className="eyebrow">当前目标</p><h3>{selectedRole}</h3><span>基于岗位要求和简历草稿生成</span></div>
      <div className="model-status-card"><div className="field-label"><Bot size={17} /><span>当前 AI 引擎</span></div><strong>{currentProvider.name}</strong><p>用于追问生成、简历改写、岗位匹配和模拟面试反馈。</p><div><span><PlugZap size={14} /> {currentProvider.status}</span><span><KeyRound size={14} /> 密钥隔离</span><span><Settings2 size={14} /> 可切换</span></div></div>
      <div className="signal-list">{signals.map((signal) => <div className="signal" key={signal.label}><div><span>{signal.label}</span><strong>{signal.value}%</strong></div><div className="meter"><i className={signal.tone} style={{ width: `${signal.value}%` }} /></div></div>)}</div>
      <div className="highlight-card"><div className="field-label"><Sparkles size={17} /><span>可写入简历的亮点</span></div><ul>{highlights.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <div className="next-card"><p className="eyebrow">下一步建议</p><h4>{activeStep === 'export' ? '检查模板并直接导出' : '继续补齐量化成果'}</h4><p>优先补充采用率、节省时长、覆盖客户数；AI 能根据这些证据生成更贴合岗位的表达。</p></div>
    </div>
  )
}

function FooterAction({ label, onClick }: { label: string; onClick: () => void }) {
  return <div className="footer-action"><button className="secondary-action" type="button">保存草稿</button><button className="primary-action" onClick={onClick} type="button">{label}<ArrowRight size={18} /></button></div>
}

function buildClientResume(role: string, requirements: string[]): GeneratedResume {
  return {
    candidate: '陈晓然',
    title: `${role} / 6 年招聘 SaaS 与 B 端产品经验`,
    summary: `熟悉 ${requirements.slice(0, 4).join('、')}，能够将 AI 能力转化为可落地的业务工作流。`,
    strengths: ['主导 AI 初筛工作流从 0 到 1 上线，推动 HR 初筛耗时从 42 分钟下降至 18 分钟。'],
    projects: [{ name: 'AI 初筛工作流', bullets: ['设计简历解析、岗位推荐、人工复核闭环，协同算法与销售团队完成灰度验证。'] }],
    keywords: requirements,
  }
}

export default App
