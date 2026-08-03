/// Web 搜索与网页抓取 API
/// 搜索使用东方财富搜索 API（search-api-web.eastmoney.com，免费无需 API Key）：
///   - 财经垂直内容库（新闻/公告/研报），不会出现通用搜索引擎的意图跑偏
///     （如 Bing 搜"宁德时代"返回"宁德市"城市信息）
///   - sort=time 按时间倒序返回**最新**新闻，每条带发布时间和来源媒体
/// 抓取使用直接 HTTP 请求 + 智能正文提取。
///
/// 已知反爬站点（解析时过滤）：知乎、百度百科、豆瓣等
/// 这些站点对无 JS/无登录的请求返回 403 或登录墙，抓取必然失败

use serde::Serialize;
use regex::Regex;

/// 网页搜索结果项
#[derive(Debug, Clone, Serialize)]
pub struct WebSearchResult {
    pub title: String,
    pub snippet: String,
    pub url: String,
    /// 发布时间（如 "2026-08-03 13:14:56"），东财按时间倒序返回
    pub date: String,
}

/// 完整浏览器 UA（带 Chrome 版本号），降低被反爬拦截的概率
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// 反爬/登录墙重灾区，抓取必失败，搜索结果中直接过滤掉
const BLOCKED_HOSTS: &[&str] = &[
    "zhihu.com",
    "baike.baidu.com",
    "zhidao.baidu.com",
    "douban.com",
    "wenku.baidu.com",
    "bilibili.com",
    "weibo.com",
    "mp.weixin.qq.com",
];

/// 网页搜索：使用东方财富搜索 API（免费，无需 API Key，国内可访问）
/// 财经垂直内容库 + sort=time 按时间倒序 → 返回**最新**相关新闻，带发布时间
/// 不会出现通用搜索引擎的意图跑偏（如搜"宁德时代"返回"宁德市"城市信息）
/// 返回最多 15 条
///
/// 兼容 site: 域名 限定（如 "site:cninfo.com.cn"）：东财不识别该操作符，
/// 这里在本地按 URL 域名过滤兜底。
pub async fn web_search(query: &str, max_results: usize) -> Result<Vec<WebSearchResult>, String> {
    let mut results = search_eastmoney_news(query, max_results).await?;

    // site: 来源限定：本地按域名过滤兜底；
    // 过滤后为空说明该来源无收录，返回空结果让 AI 换来源（而不是返回不相关结果）
    let site_filters = extract_site_filters(query);
    if !site_filters.is_empty() {
        let filtered: Vec<WebSearchResult> = results
            .drain(..)
            .filter(|r| site_filters.iter().any(|d| r.url.to_lowercase().contains(d)))
            .collect();
        if !filtered.is_empty() {
            results = filtered;
        } else {
            return Ok(Vec::new());
        }
    }

    Ok(results)
}

/// 从查询中提取 site: 限定的域名列表（如 "site:cninfo.com.cn OR site:sse.com.cn"）
fn extract_site_filters(query: &str) -> Vec<String> {
    let re = Regex::new(r"(?i)site:([a-z0-9.-]+\.[a-z]{2,})").unwrap();
    re.captures_iter(query)
        .filter_map(|c| c.get(1))
        .map(|m| m.as_str().to_lowercase())
        .collect()
}

/// 调用东方财富搜索 API（JSONP），按时间倒序获取最新财经新闻
async fn search_eastmoney_news(query: &str, max_results: usize) -> Result<Vec<WebSearchResult>, String> {
    let client = super::build_http_client()?;

    // 东财搜索接口参数（cmsArticleWebOld = 新闻文章库，sort=time 按时间倒序）
    let param = serde_json::json!({
        "uid": "",
        "keyword": query,
        "type": ["cmsArticleWebOld"],
        "client": "web",
        "clientType": "web",
        "clientVersion": "curr",
        "param": {
            "cmsArticleWebOld": {
                "searchScope": "default",
                "sort": "time",
                "pageIndex": 1,
                "pageSize": max_results.min(15),
                "preTag": "<em>",
                "postTag": "</em>"
            }
        }
    });

    let resp = client
        .get("https://search-api-web.eastmoney.com/search/jsonp")
        .query(&[("cb", "jQuery"), ("param", param.to_string().as_str())])
        .header("Referer", "https://so.eastmoney.com/")
        .header("Accept", "*/*")
        .send()
        .await
        .map_err(|e| format!("搜索请求失败: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("搜索返回 HTTP {}", status));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取搜索响应失败: {}", e))?;

    parse_eastmoney_jsonp(&body)
}

/// 网页抓取：获取指定 URL 的正文纯文本
/// - 完整浏览器头模拟真实访问，降低 403 概率
/// - 自动按 Content-Type 的 charset 解码（GBK/GB2312 等）
/// - 智能提取正文（JSON-LD → 正文容器 → meta 描述 → 整页兜底）
/// - 安全截断，避免在 UTF-8 字符中间切片
pub async fn web_fetch(url: &str) -> Result<String, String> {
    // 只抓 http/https
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(format!("不支持的 URL 协议: {}", url));
    }

    let client = super::build_http_client()?;

    let resp = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("User-Agent", BROWSER_UA)
        .header("Referer", "https://cn.bing.com/")
        .send()
        .await
        .map_err(|e| format!("网页请求失败: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {}: 无法获取该网页（可能被反爬拦截或链接已失效）", status));
    }

    // .text() 会按响应头 charset 自动解码（依赖 reqwest 的 charset feature）
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取网页内容失败: {}", e))?;

    if body.trim().is_empty() {
        return Err("网页内容为空".to_string());
    }

    let text = extract_article(&body);

    // 内容太少说明是 JS 渲染页或登录墙，直接报错让 AI 换链接
    if text.chars().count() < 150 {
        return Err(
            "该网页是动态加载或需要登录，静态抓取拿不到正文。请换一个链接（优先选择新闻门户如腾讯新闻、新浪财经、东方财富等静态页面）"
                .to_string(),
        );
    }

    Ok(text)
}

// ─── 内部工具函数 ───

/// 解析东财 JSONP 响应：剥掉 jQuery(...) 壳 → 取 result.cmsArticleWebOld 新闻列表
fn parse_eastmoney_jsonp(body: &str) -> Result<Vec<WebSearchResult>, String> {
    // 剥 JSONP 壳（兼容有/无 callback 前缀）
    let json_str = body.trim();
    let json_str = if let Some(start) = json_str.find('{') {
        if let Some(end) = json_str.rfind('}') {
            &json_str[start..=end]
        } else {
            json_str
        }
    } else {
        json_str
    };

    let json: serde_json::Value =
        serde_json::from_str(json_str).map_err(|e| format!("解析搜索响应 JSON 失败: {}", e))?;

    let items = json
        .get("result")
        .and_then(|r| r.get("cmsArticleWebOld"))
        .and_then(|a| a.as_array())
        .ok_or_else(|| "未找到搜索结果，请尝试更换关键词".to_string())?;

    let mut results = Vec::new();
    for item in items {
        let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let url = item.get("url").and_then(|v| v.as_str()).unwrap_or("");
        if title.is_empty() || url.is_empty() {
            continue;
        }
        // 过滤反爬/登录墙站点
        if is_blocked_host(url) {
            continue;
        }
        let snippet = item.get("content").and_then(|v| v.as_str()).unwrap_or("");
        let date = item.get("date").and_then(|v| v.as_str()).unwrap_or("");
        results.push(WebSearchResult {
            title: strip_em_tags(title),
            snippet: strip_em_tags(snippet),
            url: url.to_string(),
            date: date.to_string(),
        });
    }

    if results.is_empty() {
        return Err("未找到搜索结果，请尝试更换关键词".to_string());
    }

    Ok(results)
}

/// 去掉东财搜索结果中的 <em> 高亮标签
fn strip_em_tags(s: &str) -> String {
    s.replace("<em>", "").replace("</em>", "")
}

/// 判断 URL 是否属于反爬/登录墙站点
fn is_blocked_host(url: &str) -> bool {
    let lower = url.to_lowercase();
    BLOCKED_HOSTS.iter().any(|h| lower.contains(h))
}

/// 从 HTML 中智能提取正文纯文本
/// 优先级: JSON-LD articleBody → JSON 转义 HTML（腾讯新闻等）→ 常见正文容器 → meta 描述 → 整页兜底
fn extract_article(html: &str) -> String {
    // 1. 尝试 JSON-LD 中的 articleBody（很多新闻站把正文放结构化数据里）
    let jsonld_re = Regex::new(r#""articleBody"\s*:\s*"((?:[^"\\]|\\.)*)""#).unwrap();
    if let Some(cap) = jsonld_re.captures(html) {
        let body = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        // JSON 中的 \n 转义还原
        let body = body.replace("\\n", "\n").replace("\\u003c", "<").replace("\\u003e", ">");
        let text = strip_html(&body);
        if text.chars().count() > 200 {
            return normalize_text(&text);
        }
    }

    // 2. JSON 内嵌转义 HTML（腾讯新闻 originContent.text 等）
    //    \u003c 是 < 的转义，出现多次说明正文以转义 HTML 形式藏在 JSON 里
    //    注意：还原后的正文仍在 <script> 里，不能移除 script
    if html.matches("\\u003c").count() >= 3 {
        let unescaped = unescape_json(html);
        let text = extract_containers(&unescaped);
        if text.chars().count() > 150 {
            return normalize_text(&text);
        }
        // 兜底：整个还原后的内容剥标签
        let text = strip_html(&unescaped);
        if text.chars().count() > 150 {
            return normalize_text(&text);
        }
    }

    extract_from_html(html)
}

/// 在纯 HTML 中提取正文（容器 → meta 描述 → 整页兜底）
fn extract_from_html(html: &str) -> String {
    // 1. 移除 script/style（包括 JSON-LD，避免影响后续解析）
    let script_re = Regex::new(r"(?is)<script[^>]*>.*?</script>").unwrap();
    let style_re = Regex::new(r"(?is)<style[^>]*>.*?</style>").unwrap();
    let text = script_re.replace_all(html, "");
    let text = style_re.replace_all(&text, "");
    let html = &text;

    // 2. 常见正文容器（按优先级）
    let text = extract_containers(html);
    if text.chars().count() > 150 {
        return normalize_text(&text);
    }

    // 3. meta description / og:description 兜底（属性顺序不固定，先抓标签再取 content）
    let meta_tag_re = Regex::new(r#"(?is)<meta[^>]*>"#).unwrap();
    let content_re = Regex::new(r#"(?i)content\s*=\s*["']([^"']*)["']"#).unwrap();
    for tag in meta_tag_re.find_iter(html) {
        let tag = tag.as_str();
        let is_desc = tag.to_lowercase().contains("description");
        if !is_desc {
            continue;
        }
        if let Some(cap) = content_re.captures(tag) {
            let text = cap.get(1).map(|m| strip_html(m.as_str())).unwrap_or_default();
            if text.chars().count() > 80 {
                return normalize_text(&text);
            }
        }
    }

    // 4. 整页兜底
    let text = strip_html(html);
    normalize_text(&text)
}

/// 尝试从常见正文容器中提取（article/main 标签或 class/id 匹配），不足 150 字符返回空串
fn extract_containers(html: &str) -> String {
    let container_re = Regex::new(
        r#"(?is)<(?:article|main)[^>]*>(.*?)</(?:article|main)>"#,
    ).unwrap();
    let class_re = Regex::new(
        r#"(?is)<(?:div|section|article)[^>]*(?:class|id)=["'][^"']*(?:article[-_]?(?:content|body|detail)|news[-_]?content|post[-_]?content|content[-_]?main|main[-_]?content|detail[-_]?content|rich_media_content)[^"']*["'][^>]*>(.*?)</(?:div|section|article)>"#,
    ).unwrap();

    for re in [&container_re, &class_re] {
        if let Some(cap) = re.captures(html) {
            let inner = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let text = strip_html(inner);
            if text.chars().count() > 150 {
                return normalize_text(&text);
            }
        }
    }
    String::new()
}

/// 还原 JSON 字符串转义（\uXXXX、\"、\\、\n 等），用于解析内嵌转义 HTML
fn unescape_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                if let Ok(cp) = u32::from_str_radix(&hex, 16) {
                    if let Some(ch) = char::from_u32(cp) {
                        out.push(ch);
                    }
                }
            }
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some('"') => out.push('"'),
            Some('\\') => out.push('\\'),
            Some('/') => out.push('/'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// 归一化文本：压缩空白、按 char 边界安全截断
fn normalize_text(text: &str) -> String {
    let text = text.trim().to_string();

    // 压缩连续空白（多个换行→最多两个换行）
    let re = Regex::new(r"\n[ \t]*\n[ \t]*\n+").unwrap();
    let text = re.replace_all(&text, "\n\n").to_string();
    let text = text.trim().to_string();

    // 安全截断到 50000 字符（按 char 边界，避免 panic）
    const MAX_CHARS: usize = 50000;
    if text.chars().count() > MAX_CHARS {
        text.chars().take(MAX_CHARS).collect::<String>() + "\n\n...（内容过长，已截断）"
    } else {
        text
    }
}

/// 去除 HTML 标签，返回纯文本
fn strip_html(s: &str) -> String {
    // 简单去除所有 HTML 标签
    let re = Regex::new(r"<[^>]*>").unwrap();
    let text = re.replace_all(s, "");
    // 处理 HTML 实体
    let text = text
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");
    text.trim().to_string()
}

// ─── 单元测试（需要网络，验证搜索与抓取链路） ───

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_web_search_latest_news() {
        // 搜"宁德时代"应返回最新个股新闻（东财财经库，按时间倒序），而不是"宁德市"城市信息
        let results = web_search("宁德时代", 10).await.unwrap();
        assert!(!results.is_empty());
        for r in &results {
            assert!(!is_blocked_host(&r.url), "不应包含反爬站: {}", r.url);
            assert!(!r.title.contains("<em>"), "标题不应残留高亮标签: {}", r.title);
        }
        // 结果应包含公司相关新闻且带发布时间
        assert!(
            results.iter().any(|r| r.title.contains("宁德时代") || r.url.contains("eastmoney")),
            "结果应包含'宁德时代'相关新闻: {:?}",
            results
        );
        println!("搜索到 {} 条:", results.len());
        for r in &results {
            println!("  [{}] {} - {}", r.date, r.title, r.url);
        }
    }

    #[tokio::test]
    async fn test_web_search_site_filter() {
        // site: 限定来源 —— 东财不识别该操作符，验证本地按域名过滤兜底
        let results = web_search("宁德时代 公告 site:cninfo.com.cn", 10).await.unwrap();
        // 巨潮资讯可能无收录或结果少，空结果也算通过（说明过滤兜底生效而非返回垃圾结果）
        for r in &results {
            assert!(
                r.url.to_lowercase().contains("cninfo.com.cn"),
                "site: 过滤后不应出现其他来源: {}",
                r.url
            );
        }
        println!("site:cninfo 过滤后 {} 条:", results.len());
        for r in &results {
            println!("  [{}] {}", r.title, r.url);
        }
    }

    #[test]
    fn test_extract_site_filters() {
        assert_eq!(extract_site_filters("宁德时代 公告 site:cninfo.com.cn"), vec!["cninfo.com.cn"]);
        assert_eq!(
            extract_site_filters("宁德时代 公告 site:cninfo.com.cn OR site:sse.com.cn"),
            vec!["cninfo.com.cn", "sse.com.cn"]
        );
        // 大小写不敏感
        assert_eq!(extract_site_filters("茅台 公告 SITE:SSE.COM.CN"), vec!["sse.com.cn"]);
        // 无 site: 返回空
        assert!(extract_site_filters("贵州茅台 最新新闻").is_empty());
    }

    #[test]
    fn test_strip_em_tags() {
        assert_eq!(strip_em_tags("<em>宁德时代</em>成立销售新公司"), "宁德时代成立销售新公司");
        assert_eq!(strip_em_tags("无标签文本"), "无标签文本");
        assert_eq!(strip_em_tags(""), "");
    }

    #[tokio::test]
    async fn test_web_fetch_static_pages() {
        // 腾讯新闻（正文在 JSON 转义 HTML 的 originContent 字段中）
        let r = web_fetch("https://news.qq.com/rain/a/20241006A06ZBY00").await;
        println!("腾讯新闻: {:?}", r.as_ref().map(|t| t.chars().count()).map_err(|e| e.clone()));
        assert!(r.is_ok(), "腾讯新闻抓取失败: {:?}", r.err());
        if let Ok(t) = r {
            assert!(t.contains("贵州"), "腾讯新闻正文应包含'贵州', 实际前200字: {}", &t[..t.len().min(200)]);
        }

        // 非法协议应直接报错
        let r = web_fetch("ftp://example.com/file").await;
        assert!(r.is_err(), "ftp 协议应报错");
    }

    #[test]
    fn test_normalize_text_truncates_safely() {
        // 中文多字节字符边界截断不应 panic
        let long = "股".repeat(60000);
        let out = normalize_text(&long);
        assert!(out.chars().count() <= 50020, "截断后应不超过 50000+后缀, 实际 {}", out.chars().count());
        assert!(out.contains("已截断"), "应包含截断提示");
        assert!(out.starts_with("股股股"));
    }

    #[test]
    fn test_is_blocked_host() {
        assert!(is_blocked_host("https://www.zhihu.com/question/123"));
        assert!(is_blocked_host("https://baike.baidu.com/item/xxx"));
        assert!(!is_blocked_host("https://news.qq.com/rain/a/123"));
        assert!(!is_blocked_host("https://finance.eastmoney.com/a/123.html"));
    }

    #[test]
    fn test_extract_article_jsonld() {
        let body = "这是一段很长的正文内容，超过了二百个字符的阈值要求所以一定会被提取出来。".repeat(8);
        assert!(body.chars().count() > 200, "测试正文应超 200 字符, 实际 {}", body.chars().count());
        let html = format!(r#"<html><head><script type="application/ld+json">{{"articleBody":"{}"}}</script></head><body><nav>导航噪音</nav></body></html>"#, body);
        let text = extract_article(&html);
        assert!(text.contains("正文内容"), "应提取 JSON-LD 正文, 实际: {}", text);
        assert!(!text.contains("导航噪音"), "不应包含导航");
    }

    #[test]
    fn test_extract_article_container() {
        let para = "这是正文段落一的内容".to_string() + &"内容".repeat(80) + "。";
        assert!(para.chars().count() > 150, "测试正文应超 150 字符, 实际 {}", para.chars().count());
        let html = format!(r#"<html><body><nav>导航噪音</nav><article><h1>标题</h1><p>{}</p><p>这是正文段落二。</p></article><footer>页脚</footer></body></html>"#, para);
        let text = extract_article(&html);
        assert!(text.contains("正文段落"), "应提取 article 容器内容, 实际: {}", text);
        assert!(!text.contains("导航噪音"), "不应包含导航");
        assert!(!text.contains("页脚"), "不应包含页脚");
    }

    #[test]
    fn test_extract_article_escaped_html() {
        // 模拟腾讯新闻：整个 originContent.text 都是 JSON 转义 HTML（\u003c 等）
        let para = "贵州是一个充满魅力与风情的地方，拥有很多的人文胜境和山水景区，过去交通不便，如今不仅交通畅达，景区和高速还经常实行半价优惠，已经成为国内炙手可热的旅游目的地。在贵州众多景区中，体验感最好的要数下面这15个景区，去过三个就算资深玩家。".to_string();
        let content = format!(
            r#"<div class="rich_media_content"><p>{}</p><p>第二段内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容。</p></div>"#,
            para
        );
        let escaped = content
            .replace("<", "\\u003c")
            .replace(">", "\\u003e")
            .replace("\"", "\\\"");
        let html = format!(
            r#"<html><head><script>window.__DATA__ = {{"originContent": {{"text": "{}"}}}};</script></head><body><div id="app">页面骨架</div></body></html>"#,
            escaped
        );
        let text = extract_article(&html);
        assert!(text.contains("充满魅力"), "应提取转义 HTML 正文, 实际: {}", text);
        assert!(!text.contains("页面骨架"), "不应包含骨架内容");
    }
}
