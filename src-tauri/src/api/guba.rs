/// 东方财富股吧帖子抓取（个股社区情绪数据源）
///
/// 数据来源：`https://guba.eastmoney.com/list,{code}.html`（服务端渲染 HTML）。
/// 帖子数据以 `var article_list={"re":[{...}]}` 形式内嵌在页面末尾的 <script> 中，
/// 字段：post_id / post_title / user_nickname / post_click_count / post_comment_count /
/// post_publish_time / stockbar_code。
/// 页面会混入关联吧（如财富号评论吧）的帖子，按 stockbar_code == 目标代码过滤。
use crate::types::GubaPost;
use serde::Deserialize;

/// article_list 原始结构（re 为帖子数组）
#[derive(Deserialize)]
struct GubaRaw {
    re: Vec<PostRaw>,
}

/// 帖子原始字段（serde 映射内嵌 JSON 的 snake_case 字段）
#[derive(Deserialize)]
struct PostRaw {
    #[serde(rename = "post_id")]
    post_id: i64,
    #[serde(rename = "post_title")]
    post_title: String,
    #[serde(rename = "stockbar_code")]
    stockbar_code: String,
    #[serde(rename = "user_nickname")]
    user_nickname: String,
    #[serde(rename = "post_click_count")]
    post_click_count: u64,
    #[serde(rename = "post_comment_count")]
    post_comment_count: u64,
    #[serde(rename = "post_publish_time")]
    post_publish_time: String,
}

/// 从股吧 HTML 中提取 `var article_list=` 后的完整 JSON 对象字符串。
/// 用括号深度扫描定位对象边界：正确跳过字符串内的 { } 与转义字符。
fn extract_article_list_json(html: &str) -> Option<String> {
    const MARKER: &str = "var article_list=";
    let start = html.find(MARKER)? + MARKER.len();
    let bytes = html.as_bytes();
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escaped = false;
    let mut end = start;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
        } else {
            match b {
                b'"' => in_string = true,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = i + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
    }
    if depth != 0 {
        return None;
    }
    Some(html[start..end].to_string())
}

/// 获取个股股吧帖子列表（社区情绪）
/// @param code 股票代码（A 股 6 位纯数字）
/// @param limit 最多返回条数（页面一次约 20-80 条）
pub async fn fetch_stock_guba_posts(code: &str, limit: usize) -> Result<Vec<GubaPost>, String> {
    let client = super::build_http_client()?;
    let url = format!("https://guba.eastmoney.com/list,{}.html", code);

    let resp = client
        .get(&url)
        .header("Referer", "https://guba.eastmoney.com/")
        .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| format!("请求股吧数据失败: {}", e))?;

    // 先检查状态码，避免 403/5xx 返回的 HTML 被误报为"解析失败"
    if !resp.status().is_success() {
        return Err(format!("股吧接口返回 HTTP {}", resp.status()));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!("读取股吧响应失败: {}", e))?;

    let json_str = extract_article_list_json(&html)
        .ok_or_else(|| "股吧页面未找到帖子数据（页面结构可能变化）".to_string())?;
    let raw: GubaRaw =
        serde_json::from_str(&json_str).map_err(|e| format!("解析股吧帖子 JSON 失败: {}", e))?;

    let posts: Vec<GubaPost> = raw
        .re
        .into_iter()
        .filter(|p| p.stockbar_code == code) // 过滤关联吧混入的帖子
        .take(limit)
        .map(|p| GubaPost {
            id: p.post_id,
            title: p.post_title,
            author: p.user_nickname,
            click_count: p.post_click_count,
            comment_count: p.post_comment_count,
            publish_time: p.post_publish_time,
        })
        .collect();

    Ok(posts)
}
