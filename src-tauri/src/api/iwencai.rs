/// 问财（iwencai.com）智能选股 API
///
/// 接口：POST https://www.iwencai.com/unifiedwap/unified-wap/v2/result/get-robot-data
/// 自然语言问句 → 选股结果表格（与网页版"问财选股"完全一致）
///
/// 风控要点（已实测验证）：
///   - 必须携带 Cookie `v`（由 chameleon.js 本地生成，前端 WebView 执行后获取）
///   - 必须携带完整浏览器 UA + Referer + Origin，否则 Nginx 403
///   - 同一个 v 连续请求约 4-6 次后触发频率风控 → Nginx 403，换新 v 立即恢复
///     （前端 useIwencaiRobot 已内置 403 自动换 v 重试）
///   - 参数中绝不能携带 condition（Nginx 直接 403）
///   - 免费接口忽略 page 参数（page=1/2/3 返回内容完全相同），翻页须在本地进行
///   - perpage 上限 100（传 200 也只返回 100 行），默认 50
///   - 响应为标准 UTF-8 JSON（中文为 \\uXXXX 转义），无需 GBK 解码
///
/// 响应解析路径（用户指定）：
///   data.answer[0].txt[0].content.components[0].data
///     .columns  -> [{ label, key, index_name, unit, type }]
///     .datas    -> [{ "股票代码": "301565.SZ", "股票简称": "中仑新材", ... }, ...]
///                 （对象数组，每行是 中文列名 → 值 的 map）
///     .meta.extra -> { condition, token, row_count }（已确认存在）

use serde::{Deserialize, Serialize};

/// 问财接口地址
const IWENCAI_URL: &str = "https://www.iwencai.com/unifiedwap/unified-wap/v2/result/get-robot-data";

/// 完整浏览器 UA（降低被反爬拦截的概率）
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// 问财列定义（真实结构：label 为英文标识，key 为中文列名（可含日期后缀），name 为显示名）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IwencaiColumn {
    /// 英文标识（code / name / ratio ...）
    pub label: String,
    /// 中文列名（含日期后缀，如 "收盘价:不复权[20260806]"），与 datas 行 key 对应
    pub key: String,
    /// 显示名（index_name，如 "股票代码" / "最新涨跌幅"）
    pub name: String,
    /// 单位（% / 元 / 亿元 ...）
    pub unit: String,
    /// 类型（STR / DOUBLE）
    #[serde(rename = "type")]
    pub col_type: String,
}

/// 问财选股结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IwencaiRobotData {
    /// 列定义（label/key/name/unit/type）
    pub columns: Vec<IwencaiColumn>,
    /// 数据行：对象数组，每行为 中文列名(key) → 值 的 map
    pub datas: Vec<serde_json::Value>,
    /// 服务端回传的完整条件表达式（可用于二次查询）
    pub condition: String,
    /// 服务端回传的 token（可用于二次查询）
    pub token: String,
    /// 总命中行数（当前页最多 perpage 行）
    pub row_count: i64,
    /// 原始问句（回传给前端展示/复用）
    pub question: String,
}

/// 调用问财 get-robot-data 接口
///
/// # 参数
/// - `question`: 自然语言选股问句（如 "非ST，市值大于50亿"）
/// - `page` / `perpage`: 分页参数（page 服务端忽略；perpage 上限 100，默认 50）
/// - `v`: chameleon.js 生成的 Cookie v 值（由前端 WebView 执行 chameleon.js 获取）
/// - `token`: 问财接口 token（用户提供，如 0ac9879417859978476843866）
pub async fn fetch_iwencai_robot(
    question: &str,
    page: i64,
    perpage: i64,
    v: &str,
    token: &str,
) -> Result<IwencaiRobotData, String> {
    let client = crate::api::build_http_client()?;

    // add_info 参数（固定结构，服务端用于场景标记）
    let add_info = "{\"urp\":{\"scene\":1,\"company\":1,\"business\":1},\"contentType\":\"json\"}";

    let params = [
        ("question", question.to_string()),
        ("source", "Ths_iwencai_Xuangu".to_string()),
        ("version", "2.0".to_string()),
        ("secondary_intent", "stock".to_string()),
        ("rsh", String::new()),
        ("page", page.to_string()),
        ("perpage", perpage.to_string()),
        ("token", token.to_string()),
        ("add_info", add_info.to_string()),
    ];

    let resp = client
        .post(IWENCAI_URL)
        .header("User-Agent", BROWSER_UA)
        .header("Referer", "https://www.iwencai.com/unifiedwap/")
        .header("Origin", "https://www.iwencai.com")
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
        .header("Cookie", format!("v={}", v))
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("问财请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("问财请求失败: HTTP {}", resp.status()));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取问财响应失败: {}", e))?;

    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("解析问财响应失败: {}", e))?;

    // 业务错误（-9138 等限流/风控错误码）
    let status_code = json["status_code"].as_i64().unwrap_or(-1);
    if status_code != 0 {
        let msg = json["status_msg"]
            .as_str()
            .unwrap_or("未知错误")
            .to_string();
        return Err(format!("问财查询失败 ({}): {}", status_code, msg));
    }

    // 用户指定解析路径：data.answer[0].txt[0].content.components[0].data
    let data = &json["data"]["answer"][0]["txt"][0]["content"]["components"][0]["data"];
    if data.is_null() {
        return Err("问财响应缺少数据 (data.answer[0].txt[0].content.components[0].data)".to_string());
    }

    // 列定义（label / key / index_name）
    let mut columns: Vec<IwencaiColumn> = Vec::new();
    if let Some(arr) = data["columns"].as_array() {
        for col in arr {
            columns.push(IwencaiColumn {
                label: col["label"].as_str().unwrap_or("").to_string(),
                key: col["key"].as_str().unwrap_or("").to_string(),
                name: col["index_name"].as_str().unwrap_or("").to_string(),
                unit: col["unit"].as_str().unwrap_or("").to_string(),
                col_type: col["type"].as_str().unwrap_or("").to_string(),
            });
        }
    }

    // 数据行：对象数组，每行是 中文列名 → 值 的 map，原样透传
    let datas: Vec<serde_json::Value> = data["datas"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    // meta.extra: condition / token / row_count
    let extra = &data["meta"]["extra"];
    let condition = extra["condition"].as_str().unwrap_or("").to_string();
    let token2 = extra["token"].as_str().unwrap_or("").to_string();
    let row_count = extra["row_count"].as_i64().unwrap_or(0);

    Ok(IwencaiRobotData {
        columns,
        datas,
        condition,
        token: token2,
        row_count,
        question: question.to_string(),
    })
}
