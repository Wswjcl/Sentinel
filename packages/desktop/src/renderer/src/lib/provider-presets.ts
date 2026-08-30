// Provider presets for the profile editor. Data extracted from
// cc-switch (https://github.com/farion1231/cc-switch, MIT) - ported as
// data, referral/tracking parameters stripped. Regenerate with
// scripts/extract-presets.mjs when upstream updates.
export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  models: string[]
  websiteUrl?: string
  apiKeyUrl?: string
  official?: boolean
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    "id": "kimi",
    "name": "Kimi",
    "baseUrl": "https://api.moonshot.cn/v1",
    "models": [
      "kimi-k2.7-code",
      "kimi-k3"
    ],
    "websiteUrl": "https://platform.kimi.com/",
    "apiKeyUrl": "https://platform.kimi.com/console/api-keys",
    "official": true
  },
  {
    "id": "kimi-for-coding",
    "name": "Kimi For Coding",
    "baseUrl": "https://api.kimi.com/coding/v1",
    "models": [
      "kimi-for-coding"
    ],
    "websiteUrl": "https://www.kimi.com/code/",
    "apiKeyUrl": "https://platform.kimi.com/console/api-keys",
    "official": true
  },
  {
    "id": "packycode",
    "name": "PackyCode",
    "baseUrl": "https://www.packyapi.ai/v1",
    "models": [
      "claude-sonnet-5",
      "claude-opus-5"
    ],
    "websiteUrl": "https://www.packyapi.ai/",
    "apiKeyUrl": "https://www.packyapi.ai/register"
  },
  {
    "id": "zetaapi",
    "name": "ZetaAPI",
    "baseUrl": "https://api.zetaapi.ai/v1",
    "models": [
      "gpt-5.6-sol"
    ],
    "websiteUrl": "https://zetaapi.ai/",
    "apiKeyUrl": "https://zetaapi.ai/go/u117"
  },
  {
    "id": "apinebula",
    "name": "APINebula",
    "baseUrl": "https://apinebula.ai/v1",
    "models": [
      "gpt-5.6-sol"
    ],
    "websiteUrl": "https://apinebula.ai/",
    "apiKeyUrl": "https://apinebula.ai/VjM74M"
  },
  {
    "id": "aicodemirror",
    "name": "AICodeMirror",
    "baseUrl": "https://api.aicodemirror.ai/api/claudecode",
    "models": [
      "claude-sonnet-5",
      "claude-opus-5"
    ],
    "websiteUrl": "https://www.aicodemirror.ai/",
    "apiKeyUrl": "https://www.aicodemirror.ai/register"
  },
  {
    "id": "fennoai",
    "name": "FennoAI",
    "baseUrl": "https://api.fenno.ai/v1",
    "models": [
      "gpt-5.6-sol"
    ],
    "websiteUrl": "https://api.fenno.ai/",
    "apiKeyUrl": "https://api.fenno.ai/register"
  },
  {
    "id": "runapi",
    "name": "RunAPI",
    "baseUrl": "https://runapi.host",
    "models": [
      "claude-sonnet-5",
      "claude-opus-5",
      "claude-haiku-4-5"
    ],
    "websiteUrl": "https://runapi.host/",
    "apiKeyUrl": "https://runapi.host/register"
  },
  {
    "id": "shengsuanyun",
    "name": "Shengsuanyun",
    "baseUrl": "https://router.shengsuanyun.com/api/v1",
    "models": [
      "anthropic/claude-opus-5",
      "anthropic/claude-sonnet-5"
    ],
    "websiteUrl": "https://www.shengsuanyun.com/",
    "apiKeyUrl": "https://www.shengsuanyun.com/"
  },
  {
    "id": "aigocode",
    "name": "AIGoCode",
    "baseUrl": "https://api.aigocode.app",
    "models": [
      "claude-sonnet-5",
      "claude-opus-5"
    ],
    "websiteUrl": "https://aigocode.app/",
    "apiKeyUrl": "https://aigocode.app/invite/CC-SWITCH"
  },
  {
    "id": "qiniu",
    "name": "Qiniu",
    "baseUrl": "https://api.qnaigc.com/v1",
    "models": [
      "gpt-5.6-sol"
    ],
    "websiteUrl": "https://s.qiniu.com/nMvAvy",
    "apiKeyUrl": "https://s.qiniu.com/nMvAvy"
  },
  {
    "id": "aicoding",
    "name": "AICoding",
    "baseUrl": "https://api.aicoding.inc",
    "models": [
      "claude-sonnet-5",
      "claude-opus-5"
    ],
    "websiteUrl": "https://aicoding.inc/",
    "apiKeyUrl": "https://aicoding.inc/i/CCSWITCH"
  },
  {
    "id": "subrouter",
    "name": "SubRouter",
    "baseUrl": "https://subrouter.ai/v1",
    "models": [
      "gpt-5.6-sol"
    ],
    "websiteUrl": "https://subrouter.ai/",
    "apiKeyUrl": "https://subrouter.ai/register"
  },
  {
    "id": "apikey-fun",
    "name": "APIKEY.FUN",
    "baseUrl": "https://api.apikey.fun/v1",
    "models": [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5"
    ],
    "websiteUrl": "https://apikey.fun/",
    "apiKeyUrl": "https://apikey.fun/register"
  },
  {
    "id": "code0",
    "name": "Code0",
    "baseUrl": "https://code0.ai/v1",
    "models": [
      "gpt-5.6-sol"
    ],
    "websiteUrl": "https://code0.ai/",
    "apiKeyUrl": "https://code0.ai/agent/register/B2XHxGjGmRvqgznY"
  },
  {
    "id": "teamorouter",
    "name": "TeamoRouter",
    "baseUrl": "https://api.teamorouter.cn/v1",
    "models": [
      "gpt-5.6-sol"
    ],
    "websiteUrl": "https://teamorouter.cn/",
    "apiKeyUrl": "https://teamorouter.cn/"
  },
  {
    "id": "ppio",
    "name": "PPIO",
    "baseUrl": "https://api.ppio.com/openai/v1",
    "models": [
      "deepseek/deepseek-v4-flash-0731"
    ],
    "websiteUrl": "https://ppio.com/",
    "apiKeyUrl": "https://ppio.com/activity/ccswitch"
  },
  {
    "id": "claudecn",
    "name": "ClaudeCN",
    "baseUrl": "https://claudecn.top",
    "models": [
      "claude-sonnet-5",
      "claude-opus-5",
      "claude-haiku-4-5"
    ],
    "websiteUrl": "https://claudecn.top/",
    "apiKeyUrl": "https://claudecn.ai/register"
  },
  {
    "id": "agent-plan",
    "name": "火山 Agent Plan",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/plan/v3",
    "models": [
      "ark-code-latest"
    ],
    "websiteUrl": "https://www.volcengine.com/activity/agentplan",
    "apiKeyUrl": "https://www.volcengine.com/activity/agentplan",
    "official": true
  },
  {
    "id": "coding-plan",
    "name": "火山 Coding Plan",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/coding/v3",
    "models": [
      "ark-code-latest"
    ],
    "websiteUrl": "https://www.volcengine.com/activity/codingplan",
    "apiKeyUrl": "https://www.volcengine.com/activity/codingplan",
    "official": true
  },
  {
    "id": "byteplus",
    "name": "BytePlus",
    "baseUrl": "https://ark.ap-southeast.bytepluses.com/api/coding/v3",
    "models": [
      "ark-code-latest"
    ],
    "websiteUrl": "https://www.byteplus.com/en/product/modelark",
    "apiKeyUrl": "https://www.byteplus.com/en/product/modelark",
    "official": true
  },
  {
    "id": "doubaoseed",
    "name": "DouBaoSeed",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
    "models": [
      "doubao-seed-2-1-pro-260628"
    ],
    "websiteUrl": "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    "apiKeyUrl": "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    "official": true
  },
  {
    "id": "a6api",
    "name": "A6API",
    "baseUrl": "https://api.a6api.com/v1",
    "models": [
      "gpt-5.6-sol"
    ],
    "websiteUrl": "https://www.a6api.com/",
    "apiKeyUrl": "https://a6api.com/register"
  },
  {
    "id": "atlascloud",
    "name": "AtlasCloud",
    "baseUrl": "https://api.atlascloud.ai/v1",
    "models": [
      "zai-org/glm-5.1"
    ],
    "websiteUrl": "https://www.atlascloud.ai/console/coding-plan",
    "apiKeyUrl": "https://www.atlascloud.ai/console/coding-plan"
  },
  {
    "id": "ccsub",
    "name": "CCSub",
    "baseUrl": "https://www.ccsub.net/v1",
    "models": [
      "gpt-5.6-sol"
    ],
    "websiteUrl": "https://www.ccsub.net/",
    "apiKeyUrl": "https://www.ccsub.net/register"
  },
  {
    "id": "sssaicode",
    "name": "SSSAiCode",
    "baseUrl": "https://node-hk.sssaicodeapi.com/api/v1",
    "models": [
      "claude-sonnet-5",
      "claude-opus-5"
    ],
    "websiteUrl": "https://sssaicodeapi.com/",
    "apiKeyUrl": "https://sssaicodeapi.com/register"
  },
  {
    "id": "micu",
    "name": "Micu",
    "baseUrl": "https://www.micuapi.ai/v1",
    "models": [
      "claude-opus-5",
      "claude-sonnet-5"
    ],
    "websiteUrl": "https://www.micuapi.ai/",
    "apiKeyUrl": "https://www.micuapi.ai/register"
  },
  {
    "id": "rightcode",
    "name": "RightCode",
    "baseUrl": "https://www.rightapi.ai/codex/v1",
    "models": [
      "gpt-5.6-sol"
    ],
    "websiteUrl": "https://www.rightapi.ai/",
    "apiKeyUrl": "https://www.rightapi.ai/register"
  },
  {
    "id": "etok-ai",
    "name": "ETok.ai",
    "baseUrl": "https://api.etok.ai/v1",
    "models": [
      "claude-opus-5",
      "claude-sonnet-5"
    ],
    "websiteUrl": "https://etok.ai/",
    "apiKeyUrl": "https://etok.ai/"
  },
  {
    "id": "cubence",
    "name": "Cubence",
    "baseUrl": "https://api.cubence.com/v1",
    "models": [
      "claude-sonnet-5",
      "claude-opus-5"
    ],
    "websiteUrl": "https://cubence.com/",
    "apiKeyUrl": "https://cubence.com/signup"
  },
  {
    "id": "crazyrouter",
    "name": "CrazyRouter",
    "baseUrl": "https://cn.crazyrouter.com",
    "models": [
      "claude-sonnet-5",
      "claude-opus-5"
    ],
    "websiteUrl": "https://www.crazyrouter.com/",
    "apiKeyUrl": "https://www.crazyrouter.com/register"
  },
  {
    "id": "dmxapi",
    "name": "DMXAPI",
    "baseUrl": "https://www.dmxapi.cn/v1",
    "models": [
      "claude-sonnet-5",
      "claude-opus-5"
    ],
    "websiteUrl": "https://www.dmxapi.cn/",
    "apiKeyUrl": "https://www.dmxapi.cn/"
  },
  {
    "id": "sudocode-chat",
    "name": "SudoCode.chat",
    "baseUrl": "https://api.sudocode.chat/v1",
    "models": [
      "gpt-5.6-sol"
    ],
    "websiteUrl": "https://sudocode.chat/",
    "apiKeyUrl": "https://sudocode.chat/sign-up"
  },
  {
    "id": "sudocode-us",
    "name": "SudoCode.us",
    "baseUrl": "https://sudocode.us/v1",
    "models": [
      "gpt-5.6-sol"
    ],
    "websiteUrl": "https://sudocode.us/",
    "apiKeyUrl": "https://sudocode.us/"
  },
  {
    "id": "xycai",
    "name": "XycAi",
    "baseUrl": "https://apicdn.xycai.us/v1",
    "models": [
      "gpt-5.6-sol"
    ],
    "websiteUrl": "https://xycai.us/",
    "apiKeyUrl": "https://xycai.us/register"
  },
  {
    "id": "amux",
    "name": "Amux",
    "baseUrl": "https://api.amux.ai/v1",
    "models": [
      "gpt-5.6-sol"
    ],
    "websiteUrl": "https://amux.ai/",
    "apiKeyUrl": "https://amux.ai/"
  },
  {
    "id": "deepseek",
    "name": "DeepSeek",
    "baseUrl": "https://api.deepseek.com/v1",
    "models": [
      "deepseek-v4-pro",
      "deepseek-v4-flash"
    ],
    "websiteUrl": "https://platform.deepseek.com/",
    "apiKeyUrl": "https://platform.deepseek.com/api_keys",
    "official": true
  },
  {
    "id": "zhipu-glm",
    "name": "Zhipu GLM",
    "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
    "models": [
      "glm-5.1"
    ],
    "websiteUrl": "https://open.bigmodel.cn/",
    "apiKeyUrl": "https://www.bigmodel.cn/claude-code",
    "official": true
  },
  {
    "id": "zhipu-glm-en",
    "name": "Zhipu GLM en",
    "baseUrl": "https://api.z.ai/api/coding/paas/v4",
    "models": [
      "glm-5.1"
    ],
    "websiteUrl": "https://z.ai/",
    "apiKeyUrl": "https://z.ai/subscribe",
    "official": true
  },
  {
    "id": "baidu-qianfan-token-plan",
    "name": "Baidu Qianfan Token Plan",
    "baseUrl": "https://qianfan.baidubce.com/v2/tokenplan/personal",
    "models": [
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-v4-flash-0731",
      "glm-5.2",
      "glm-5.1",
      "kimi-k2.6"
    ],
    "websiteUrl": "https://cloud.baidu.com/product/codingplan.html",
    "apiKeyUrl": "https://console.bce.baidu.com/qianfan/resource/token-plan",
    "official": true
  },
  {
    "id": "stepfun",
    "name": "StepFun",
    "baseUrl": "https://api.stepfun.com/step_plan/v1",
    "models": [
      "step-3.5-flash-2603",
      "step-3.5-flash"
    ],
    "websiteUrl": "https://platform.stepfun.com/step-plan",
    "apiKeyUrl": "https://platform.stepfun.com/interface-key",
    "official": true
  },
  {
    "id": "stepfun-en",
    "name": "StepFun en",
    "baseUrl": "https://api.stepfun.ai/step_plan/v1",
    "models": [
      "step-3.5-flash-2603",
      "step-3.5-flash"
    ],
    "websiteUrl": "https://platform.stepfun.ai/step-plan",
    "apiKeyUrl": "https://platform.stepfun.ai/interface-key",
    "official": true
  },
  {
    "id": "stepfun-step-plan",
    "name": "StepFun Step Plan",
    "baseUrl": "https://api.stepfun.com/step_plan/v1",
    "models": [
      "step-3.5-flash"
    ],
    "websiteUrl": "https://platform.stepfun.com/docs/zh/step-plan/overview",
    "apiKeyUrl": "https://platform.stepfun.com/interface-key",
    "official": true
  },
  {
    "id": "modelscope",
    "name": "ModelScope",
    "baseUrl": "https://api-inference.modelscope.cn/v1",
    "models": [
      "ZhipuAI/GLM-5.2"
    ],
    "websiteUrl": "https://modelscope.cn/",
    "apiKeyUrl": "https://modelscope.cn/my/myaccesstoken"
  },
  {
    "id": "kat-coder",
    "name": "KAT-Coder",
    "baseUrl": "https://vanchin.streamlake.ai/api/gateway/v1/endpoints/${ENDPOINT_ID}/openai",
    "models": [
      "KAT-Coder-Pro"
    ],
    "websiteUrl": "https://console.streamlake.ai/",
    "apiKeyUrl": "https://console.streamlake.ai/console/api-key",
    "official": true
  },
  {
    "id": "longcat",
    "name": "Longcat",
    "baseUrl": "https://api.longcat.chat/openai/v1",
    "models": [
      "LongCat-2.0"
    ],
    "websiteUrl": "https://longcat.chat/platform",
    "apiKeyUrl": "https://longcat.chat/platform/api_keys",
    "official": true
  },
  {
    "id": "minimax",
    "name": "MiniMax",
    "baseUrl": "https://api.minimaxi.com/v1",
    "models": [
      "MiniMax-M2.7"
    ],
    "websiteUrl": "https://platform.minimaxi.com/",
    "apiKeyUrl": "https://platform.minimaxi.com/subscribe/coding-plan",
    "official": true
  },
  {
    "id": "minimax-en",
    "name": "MiniMax en",
    "baseUrl": "https://api.minimax.io/v1",
    "models": [
      "MiniMax-M2.7"
    ],
    "websiteUrl": "https://platform.minimax.io/",
    "apiKeyUrl": "https://platform.minimax.io/subscribe/coding-plan",
    "official": true
  },
  {
    "id": "bailing",
    "name": "BaiLing",
    "baseUrl": "https://api.tbox.cn/v1",
    "models": [
      "Ling-2.5-1T"
    ],
    "websiteUrl": "https://alipaytbox.yuque.com/sxs0ba/ling/get_started",
    "official": true
  },
  {
    "id": "xiaomi-mimo",
    "name": "Xiaomi MiMo",
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "models": [
      "mimo-v2.5-pro",
      "mimo-v2.5"
    ],
    "websiteUrl": "https://platform.xiaomimimo.com/",
    "apiKeyUrl": "https://platform.xiaomimimo.com/#/console/api-keys",
    "official": true
  },
  {
    "id": "xiaomi-mimo-token-plan-china",
    "name": "Xiaomi MiMo Token Plan (China)",
    "baseUrl": "https://token-plan-cn.xiaomimimo.com/v1",
    "models": [
      "mimo-v2.5-pro",
      "mimo-v2.5"
    ],
    "websiteUrl": "https://platform.xiaomimimo.com/#/token-plan",
    "apiKeyUrl": "https://platform.xiaomimimo.com/#/console/plan-manage",
    "official": true
  },
  {
    "id": "opencode-go",
    "name": "OpenCode Go",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "models": [
      "glm-5.2",
      "kimi-k2.7-code",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "mimo-v2.5-pro"
    ],
    "websiteUrl": "https://opencode.ai/go",
    "apiKeyUrl": "https://opencode.ai/go"
  },
  {
    "id": "aihubmix",
    "name": "AiHubMix",
    "baseUrl": "https://aihubmix.com/v1",
    "models": [
      "claude-sonnet-5",
      "claude-opus-5"
    ],
    "websiteUrl": "https://aihubmix.com/",
    "apiKeyUrl": "https://aihubmix.com/"
  },
  {
    "id": "cherryin",
    "name": "CherryIN",
    "baseUrl": "https://open.cherryin.net/v1",
    "models": [
      "anthropic/claude-sonnet-5",
      "anthropic/claude-opus-5"
    ],
    "websiteUrl": "https://open.cherryin.ai/",
    "apiKeyUrl": "https://open.cherryin.ai/console/token"
  },
  {
    "id": "openrouter",
    "name": "OpenRouter",
    "baseUrl": "https://openrouter.ai/api/v1",
    "models": [
      "anthropic/claude-sonnet-5",
      "anthropic/claude-opus-5"
    ],
    "websiteUrl": "https://openrouter.ai/",
    "apiKeyUrl": "https://openrouter.ai/keys"
  },
  {
    "id": "therouter",
    "name": "TheRouter",
    "baseUrl": "https://api.therouter.ai/v1",
    "models": [
      "anthropic/claude-sonnet-5",
      "openai/gpt-5.3-codex",
      "openai/gpt-5.2",
      "google/gemini-3.6-flash",
      "qwen/qwen3-coder-480b"
    ],
    "websiteUrl": "https://therouter.ai/",
    "apiKeyUrl": "https://dashboard.therouter.ai/"
  },
  {
    "id": "novita-ai",
    "name": "Novita AI",
    "baseUrl": "https://api.novita.ai/openai",
    "models": [
      "zai-org/glm-5.1"
    ],
    "websiteUrl": "https://novita.ai/",
    "apiKeyUrl": "https://novita.ai/"
  },
  {
    "id": "nvidia",
    "name": "Nvidia",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "models": [
      "moonshotai/kimi-k2.5"
    ],
    "websiteUrl": "https://build.nvidia.com/",
    "apiKeyUrl": "https://build.nvidia.com/settings/api-keys"
  },
  {
    "id": "pipellm",
    "name": "PIPELLM",
    "baseUrl": "https://cc-api.pipellm.ai",
    "models": [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001"
    ],
    "websiteUrl": "https://code.pipellm.ai/",
    "apiKeyUrl": "https://code.pipellm.ai/login"
  },
  {
    "id": "e-flowcode",
    "name": "E-FlowCode",
    "baseUrl": "https://e-flowcode.cc/v1",
    "models": [
      "gpt-5.2-codex",
      "gpt-5.3-codex"
    ],
    "websiteUrl": "https://e-flowcode.cc/",
    "apiKeyUrl": "https://e-flowcode.cc/"
  },
  {
    "id": "jiekou-ai",
    "name": "JieKou AI",
    "baseUrl": "https://api.jiekou.ai/openai/v1",
    "models": [
      "claude-fable-5"
    ],
    "websiteUrl": "https://jiekou.ai/#model-library",
    "apiKeyUrl": "https://jiekou.ai/settings/key-management"
  }
]
