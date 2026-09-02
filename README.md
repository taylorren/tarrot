# 小小问题

一个温和的每日塔罗练习应用。回答一个诚实的问题，翻开三张牌，
获得安静、具体、有温度的解读——其中「关于问题的一点解读」由
**AI（Ollama 云端模型）** 动态生成，基于你提出的问题与三张真实抽到的
牌（含正位/逆位）。

> v2 起前端重构为 **Vue 3 + Vite + TypeScript**（原为原生 JS 单文件）。

## 结构

```
index.html            Vite 入口（挂载点 + 字体）
vite.config.ts        Vue 插件 + 开发代理 /api → :8787
src/
  main.ts             createApp 入口
  styles.css          全局样式（含 a11y：focus / reduced-motion）
  App.vue             外壳：intro / reading 两个阶段切换
  components/         SiteIntro · ReadingView · CardSlot ·
                      Reflection · AiReading · ReadingFooter · Toast
  store/reading.ts    单例状态机：抽牌 · AI 预取 · 重置
  composables/        useToast
  lib/                cards · guidance · spread · markdown · api · types
public/cards/*.png    78 张牌面（Vite 构建时自动拷贝）
server/server.js      无依赖 Node 后端：Ollama 代理 + 生产静态托管
```

- `OLLAMA_API_KEY` 只留在服务端，不下发到浏览器
- `.env` — Ollama 云端凭据（已在 `.gitignore` 中忽略）

## 运行

```bash
# 开发：一条命令同时启动 后端(:8787) + Vite(:5173)，/api 自动代理，不限次数
npm start
# → 打开 http://localhost:5173

# `npm run dev` 与 `npm start` 相同。

# 也可以分开跑（需要两个终端）
npm run server      # 仅后端
npm run dev:web     # 仅前端

# 生产：构建前端后，以配额限制启动静态/API 服务
npm run prod
# → 打开 http://localhost:8787

# 质量检查
npm run type-check   # vue-tsc
```

首次使用请先确认 `.env` 里有有效的 `OLLAMA_API_KEY`。
在 [ollama.com/settings/keys](https://ollama.com/settings/keys) 创建。

> 说明：直连 `https://ollama.com/api/chat` 时，服务端会自动去掉
> `OLLAMA_MODEL` 末尾的 `-cloud` 后缀（该后缀仅用于本地 Ollama 卸载场景）。

## 体验设计：翻完三张牌才请求 AI，也才计费

- 三张牌（含正/逆位）在用户翻开第一张前就已经确定，
  但 **AI 请求被刻意推迟到第三张牌翻开的那一刻**（`showAi()` → `requestReading()`）。
- 这样**计费与体验完全一致**：用户真正收到一次解读，才扣一次次数；
  中途"换一个问题"或离开的解读永远不会消耗配额（服务端也会检测客户端
  已断开、不计次，记为 `abandoned`）。
- 第三张牌翻开后的等待由"让三张牌之间的线索慢慢浮现……"承接；
  就绪即显示，失败时保留手工逐牌提醒并提供"再试一次"。

> ⚠️ 维护提醒：请不要把 AI 请求提前到三张牌翻完之前——那会让用户
> 为没有收到的解读付费，也会破坏翻牌节奏。

## 解读间隔与用量日志

云端 Ollama 有成本，所以生产环境中每次**成功送达的解读**后，需要等待 4 小时
才能开始下一次。可用环境变量 `READING_COOLDOWN_HOURS` 调整间隔：

- **服务端是真正的闸门**（`server/server.js`）：冷却中返回 `429`，前端显示
  温和的等待提示（牌与手工提醒仍可看，但没有"再试一次"）。
- **身份**：匿名 cookie（`tarrot_id`，HttpOnly，1 年）；cookie 被禁时退回到
  哈希后的 IP（SHA-256 截断，不存原始 IP）。没有账号，没有性别/年龄这类个人信息。
- **冷却时间从成功送达解读时开始计算**，不会受时区或午夜边界影响。
- **失败的调用不计次**（没有花你的配额），但也会被记录下来。
- **解读内容保留 4 小时**：问题、牌面与 AI 解读仅保存在 `logs/active-readings.json`
  以支持冷却期间的重读，过期后自动删除。该文件和用量日志均被 `.gitignore` 排除。
- `GET /api/quota` 是免费预检，前端用它显示是否可开始新解读或剩余等待时间。

用量日志写在 `logs/usage-YYYY-MM.jsonl`（已 gitignore，属于你的私有数据），
每行一条 JSON，供你判断何时做免费/付费版本：

```json
{"ts":"…","status":"ok","clientId":"…","ipHash":"…","model":"gpt-oss:20b",
 "latencyMs":8214,"promptTokens":371,"completionTokens":966,"cooldownHours":4}
```

`status` 有四种：`ok`（开始冷却）、`error`（调用失败，不进入冷却）、
`cooldown`（被 429 挡下的尝试——这是付费需求的最直接信号）、
`abandoned`（AI 还没返回用户就离开了，不计次）。
重启用日志恢复最近一次成功解读时间，所以冷却不会因为重启而失效。看数时最值得盯的是
`promptTokens + completionTokens`（你真实的成本）和 `cooldown` 数量。

## AI 牌义参考

服务端的 `server/tarot-knowledge.json` 包含完整 78 张牌的关键词、正位与逆位英文参考，
每次只向模型提供本次抽到的三张牌。数据来自
[coderdoder-mode/Mystic](https://github.com/coderdoder-mode/Mystic)，采用 MIT 许可证；
原始文件、许可证和归属说明保存在 `server/third-party/`。中文的三牌整合、语气与安全边界由本项目定义。

## API

`POST /api/reading`，请求体：

```json
{
  "question": "我正面临一个职业上的选择",
  "cards": [
    { "name": "The Hermit", "reversed": false, "position": 0 },
    { "name": "Two of Swords", "reversed": true, "position": 1 },
    { "name": "The Star", "reversed": false, "position": 2 }
  ]
}
```

响应：`{ "reading": "…解读文本…", "thread": "…今天可做的一小步…" }`