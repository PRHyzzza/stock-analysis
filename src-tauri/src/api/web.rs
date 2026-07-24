/// Web 搜索与网页抓取 API
/// 使用 DuckDuckGo Lite 实现免费网页搜索（无需 API Key）

use serde::Serialize;
use regex::Regex;

/// 网页搜索结果项
#[derive(Debug, Clone, Serialize)]
pub struct WebSearchResult {
    pub title: String,
    pub snippet: String,
    pub url: String,
}

/// 网页搜索：使用 DuckDuckGo Lite（免费，无需 API Key）
/// 返回最多 15 条搜索结果
pub async fn web_search(query: &str, max_results: usize) -> Result<Vec<WebSearchResult>, String> {
    let client = super::build_http_client()?;
    let url = format!(
        "https://lite.duckduckgo.com/lite/?q={}",
        urlencoding(query)
    );

    let resp = client
        .get(&url)
        .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| format!("搜索请求失败: {}", e))?;

    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取搜索响应失败: {}", e))?;

    parse_ddg_lite(&body, max_results)
}

/// 网页抓取：获取指定 URL 的文本内容
/// 返回纯文本（去除 HTML 标签），限制最大 50000 字符以控制 token 消耗
pub async fn web_fetch(url: &str) -> Result<String, String> {
    let client = super::build_http_client()?;

    let resp = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|e| format!("网页请求失败: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {}: 无法获取该网页", status));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取网页内容失败: {}", e))?;

    Ok(extract_text(&body))
}

// ─── 内部工具函数 ───

/// URL 编码（简单实现，处理中文等特殊字符）
fn urlencoding(s: &str) -> String {
    let mut result = String::new();
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            b' ' => result.push('+'),
            _ => {
                result.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    result
}

/// 解析 DuckDuckGo Lite 的 HTML 搜索结果
fn parse_ddg_lite(html: &str, max_results: usize) -> Result<Vec<WebSearchResult>, String> {
    let mut results = Vec::new();

    // DDG Lite 结果格式:
    // <a rel="nofollow" href="URL" class="result-link">TITLE</a>
    // <span class="result-snippet">SNIPPET</span>

    let link_re = Regex::new(
        r#"<a[^>]*href="([^"]*)"[^>]*class="[^"]*result-link[^"]*"[^>]*>([^<]*(?:<[^/][^>]*>[^<]*</[^>]*>)*[^<]*)</a>"#
    ).map_err(|e| format!("正则编译失败: {}", e))?;

    let snippet_re = Regex::new(
        r#"<span[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([^<]*(?:<[^/][^>]*>[^<]*</[^>]*>)*[^<]*)</span>"#
    ).map_err(|e| format!("正则编译失败: {}", e))?;

    // 更宽松的匹配：找所有 result-link 和 result-snippet
    let links: Vec<(String, String)> = link_re
        .captures_iter(html)
        .map(|cap| {
            let url = cap.get(1).map(|m| String::from(m.as_str())).unwrap_or_default();
            let title = cap.get(2).map(|m| strip_html(m.as_str())).unwrap_or_default();
            (url, title)
        })
        .collect();

    let snippets: Vec<String> = snippet_re
        .captures_iter(html)
        .map(|cap| {
            cap.get(1).map(|m| strip_html(m.as_str())).unwrap_or_default()
        })
        .collect();

    for (i, (url, title)) in links.into_iter().enumerate() {
        if results.len() >= max_results {
            break;
        }
        if url.is_empty() || title.is_empty() {
            continue;
        }
        // 过滤掉 DuckDuckGo 自身的链接
        if url.contains("duckduckgo.com") {
            continue;
        }
        let snippet = snippets.get(i).cloned().unwrap_or_default();
        results.push(WebSearchResult {
            title,
            snippet,
            url: url.clone(),
        });
    }

    if results.is_empty() {
        return Err("未找到搜索结果，请尝试更换关键词".to_string());
    }

    Ok(results)
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

/// 从 HTML 中提取纯文本内容（用于 web_fetch）
fn extract_text(html: &str) -> String {
    // 移除 script 和 style 标签及其内容
    let script_re = Regex::new(r"(?is)<script[^>]*>.*?</script>").unwrap();
    let style_re = Regex::new(r"(?is)<style[^>]*>.*?</style>").unwrap();
    let text = script_re.replace_all(html, "");
    let text = style_re.replace_all(&text, "");

    // 去除所有 HTML 标签
    let text = strip_html(&text);

    // 压缩空白（多个换行→最多两个换行）
    let re = Regex::new(r"\n\s*\n\s*\n+").unwrap();
    let text = re.replace_all(&text, "\n\n");

    let text = text.trim().to_string();

    // 限制最大字符数
    if text.len() > 50000 {
        text[..50000].to_string()
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_urlencoding() {
        assert_eq!(urlencoding("hello world"), "hello+world");
        assert_eq!(urlencoding("测试"), "%E6%B5%8B%E8%AF%95");
    }

    #[test]
    fn test_strip_html() {
        assert_eq!(strip_html("<b>hello</b>"), "hello");
        assert_eq!(strip_html("a &amp; b"), "a & b");
    }
}
