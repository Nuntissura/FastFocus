const KNOWN_BOTS = [
  { bot_name: "Googlebot", bot_kind: "search", re: /googlebot/i },
  { bot_name: "Bingbot", bot_kind: "search", re: /bingbot/i },
  { bot_name: "DuckDuckBot", bot_kind: "search", re: /duckduckbot/i },
  { bot_name: "Applebot", bot_kind: "search", re: /applebot/i },
  { bot_name: "YandexBot", bot_kind: "search", re: /yandexbot/i },
  { bot_name: "Baiduspider", bot_kind: "search", re: /baiduspider/i },

  { bot_name: "OAI-SearchBot", bot_kind: "search", re: /oai-searchbot/i },
  { bot_name: "ChatGPT-User", bot_kind: "user", re: /chatgpt-user/i },
  { bot_name: "GPTBot", bot_kind: "training", re: /gptbot/i },

  { bot_name: "ClaudeBot", bot_kind: "training", re: /claudebot/i },

  { bot_name: "Google-Extended", bot_kind: "training", re: /google-extended/i },

  { bot_name: "FacebookExternalHit", bot_kind: "social_preview", re: /facebookexternalhit|facebot/i },
  { bot_name: "Twitterbot", bot_kind: "social_preview", re: /twitterbot/i },
  { bot_name: "LinkedInBot", bot_kind: "social_preview", re: /linkedinbot/i },
  { bot_name: "Slackbot", bot_kind: "social_preview", re: /slackbot/i },
  { bot_name: "Discordbot", bot_kind: "social_preview", re: /discordbot/i },
  { bot_name: "Pinterestbot", bot_kind: "social_preview", re: /pinterestbot/i },

  { bot_name: "AhrefsBot", bot_kind: "seo_tool", re: /ahrefsbot/i },
  { bot_name: "SemrushBot", bot_kind: "seo_tool", re: /semrushbot/i },
  { bot_name: "MJ12bot", bot_kind: "seo_tool", re: /mj12bot/i },
  { bot_name: "DotBot", bot_kind: "seo_tool", re: /dotbot/i },
];

const GENERIC_BOT_RE = /bot|spider|crawl|slurp/i;
const GENERIC_HTTP_CLIENT_RE = /curl\/|wget\/|python-requests|aiohttp|go-http-client|libwww-perl|scrapy|httpie/i;

export function classifyUserAgent(userAgent) {
  const ua = typeof userAgent === "string" ? userAgent.trim() : "";
  if (!ua) return { is_bot: false, bot_name: null, bot_kind: null, user_agent: null };

  for (const item of KNOWN_BOTS) {
    if (item.re.test(ua)) {
      return { is_bot: true, bot_name: item.bot_name, bot_kind: item.bot_kind, user_agent: ua };
    }
  }

  if (GENERIC_HTTP_CLIENT_RE.test(ua)) {
    return { is_bot: true, bot_name: "GenericHttpClient", bot_kind: "unknown", user_agent: ua };
  }

  if (GENERIC_BOT_RE.test(ua)) {
    return { is_bot: true, bot_name: "GenericBot", bot_kind: "unknown", user_agent: ua };
  }

  return { is_bot: false, bot_name: null, bot_kind: null, user_agent: ua };
}

