/// 判断是否为港股（5 位数字代码，如 00700）
pub fn is_hk_stock(code: &str) -> bool {
    // 去掉可能的 hk/HK 前缀
    let code = code.trim_start_matches(|c: char| c == 'h' || c == 'H' || c == 'k' || c == 'K');
    // 港股代码为 5 位数字（可能前导零），如 00700、00388
    code.len() == 5 && code.chars().all(|c| c.is_ascii_digit())
}

/// 将股票代码转换为 East Money 格式
/// A 股: SH600519 / SZ300750
/// 港股: HK00700
pub fn to_em_code(code: &str) -> String {
    if is_hk_stock(code) {
        let stripped = code.trim_start_matches(|c: char| c == 'h' || c == 'H' || c == 'k' || c == 'K');
        return format!("HK{}", stripped);
    }
    if code.starts_with("6") {
        format!("SH{}", code)
    } else {
        format!("SZ{}", code)
    }
}

/// 将股票代码转换为 Tencent 格式
/// A 股: sh600519 / sz300750
/// 港股: hk00700
pub fn to_tencent_code(code: &str) -> String {
    if is_hk_stock(code) {
        let stripped = code.trim_start_matches(|c: char| c == 'h' || c == 'H' || c == 'k' || c == 'K');
        return format!("hk{}", stripped);
    }
    if code.starts_with("6") {
        format!("sh{}", code)
    } else {
        format!("sz{}", code)
    }
}

/// 将股票代码转换为东方财富 secid 格式（用于资金流向等 API）
/// A 股: 1.600519 (沪市) / 0.300750 (深市)
/// 港股: 116.00700
pub fn to_em_secid(code: &str) -> String {
    if is_hk_stock(code) {
        let stripped = code.trim_start_matches(|c: char| c == 'h' || c == 'H' || c == 'k' || c == 'K');
        return format!("116.{}", stripped);
    }
    if code.starts_with("6") {
        format!("1.{}", code)
    } else {
        format!("0.{}", code)
    }
}

/// 从 serde_json::Value 中提取 f64，兼容数字和字符串格式
pub fn parse_json_f64(v: &serde_json::Value) -> f64 {
    v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
        .unwrap_or(0.0)
}
