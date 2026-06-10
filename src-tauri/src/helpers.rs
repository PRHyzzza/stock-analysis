/// 将股票代码转换为 East Money 格式 (SH600519 / SZ300750)
pub fn to_em_code(code: &str) -> String {
    if code.starts_with("6") {
        format!("SH{}", code)
    } else {
        format!("SZ{}", code)
    }
}

/// 将股票代码转换为 Tencent 格式 (sh600519 / sz300750)
pub fn to_tencent_code(code: &str) -> String {
    if code.starts_with("6") {
        format!("sh{}", code)
    } else {
        format!("sz{}", code)
    }
}

/// 从 serde_json::Value 中提取 f64，兼容数字和字符串格式
pub fn parse_json_f64(v: &serde_json::Value) -> f64 {
    v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
        .unwrap_or(0.0)
}
