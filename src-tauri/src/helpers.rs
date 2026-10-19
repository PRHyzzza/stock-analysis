/// 归一化股票代码：剥离市场前缀（sh/sz/bj/hk，大小写不敏感）与
/// 外部来源后缀（.SH/.SZ/.BJ/.HK，如问财返回的 600519.SH）
/// 例: "sh600519" → "600519"；"600519.SH" → "600519"；"HK00700" → "00700"
pub fn normalize_code(code: &str) -> String {
    let s = code.trim();
    // 前缀只剥 2 字母市场标识；用 get(..2) 避免在多字节字符中间切片 panic
    let s = match s.get(..2) {
        Some(head) if matches!(head.to_ascii_lowercase().as_str(), "sh" | "sz" | "bj" | "hk") => {
            &s[2..]
        }
        _ => s,
    };
    // 后缀 .SH/.SZ/.BJ/.HK，仅当主体是纯字母数字时才剥离（避免误伤 "1.5" 这类输入）
    if let Some((base, suffix)) = s.rsplit_once('.') {
        if matches!(suffix.to_ascii_lowercase().as_str(), "sh" | "sz" | "bj" | "hk")
            && !base.is_empty()
            && base.chars().all(|c| c.is_ascii_alphanumeric())
        {
            return base.to_string();
        }
    }
    s.to_string()
}

/// 判断是否为港股（5 位数字代码，如 00700）
pub fn is_hk_stock(code: &str) -> bool {
    let code = normalize_code(code);
    // 港股代码为 5 位数字（可能前导零），如 00700、00388
    code.len() == 5 && code.chars().all(|c| c.is_ascii_digit())
}

/// 判断是否为北交所股票（6 位数字，43/82/83/87/88/92 开头）
pub fn is_bse_stock(code: &str) -> bool {
    let code = normalize_code(code);
    code.len() == 6
        && code.chars().all(|c| c.is_ascii_digit())
        && ["43", "82", "83", "87", "88", "92"]
            .iter()
            .any(|p| code.starts_with(p))
}

/// 判断是否为沪市（6/900 开头：沪 A / 沪 B）
fn is_shanghai(code: &str) -> bool {
    code.starts_with('6') || code.starts_with("900")
}

/// 将股票代码转换为 East Money 格式
/// A 股: SH600519 / SZ300750 / SH900901(沪B)
/// 港股: HK00700
/// 北交所: BJ430047
pub fn to_em_code(code: &str) -> String {
    let code = normalize_code(code);
    if is_hk_stock(&code) {
        return format!("HK{}", code);
    }
    if is_bse_stock(&code) {
        return format!("BJ{}", code);
    }
    if is_shanghai(&code) {
        format!("SH{}", code)
    } else {
        format!("SZ{}", code)
    }
}

/// 将股票代码转换为 Tencent 格式
/// A 股: sh600519 / sz300750 / sh900901(沪B)
/// 港股: hk00700
/// 北交所: bj430047
pub fn to_tencent_code(code: &str) -> String {
    let code = normalize_code(code);
    if is_hk_stock(&code) {
        return format!("hk{}", code);
    }
    if is_bse_stock(&code) {
        return format!("bj{}", code);
    }
    if is_shanghai(&code) {
        format!("sh{}", code)
    } else {
        format!("sz{}", code)
    }
}

/// 将股票代码转换为东方财富 secid 格式（用于资金流向等 API）
/// A 股: 1.600519 (沪市) / 0.300750 (深市)
/// 港股: 116.00700
/// 北交所: 0.430047 (东财将北交所归入 0 市场)
pub fn to_em_secid(code: &str) -> String {
    let code = normalize_code(code);
    if is_hk_stock(&code) {
        return format!("116.{}", code);
    }
    if is_bse_stock(&code) {
        return format!("0.{}", code);
    }
    if is_shanghai(&code) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_code_strips_prefix_and_suffix() {
        assert_eq!(normalize_code("sh600519"), "600519");
        assert_eq!(normalize_code("SH600519"), "600519");
        assert_eq!(normalize_code("sz300750"), "300750");
        assert_eq!(normalize_code("bj430047"), "430047");
        assert_eq!(normalize_code("hk00700"), "00700");
        assert_eq!(normalize_code("600519.SH"), "600519");
        assert_eq!(normalize_code("300750.sz"), "300750");
        assert_eq!(normalize_code(" 600519 "), "600519");
    }

    #[test]
    fn normalize_code_keeps_plain_codes() {
        assert_eq!(normalize_code("600519"), "600519");
        assert_eq!(normalize_code("00700"), "00700");
        // 非代码输入不被误伤（中文不会被切成半个字符而 panic）
        assert_eq!(normalize_code("贵州茅台"), "贵州茅台");
        assert_eq!(normalize_code("1.5"), "1.5");
    }

    #[test]
    fn tencent_codes_do_not_double_prefix() {
        assert_eq!(to_tencent_code("sh600519"), "sh600519");
        assert_eq!(to_tencent_code("600519"), "sh600519");
        assert_eq!(to_tencent_code("300750"), "sz300750");
        assert_eq!(to_tencent_code("600519.SH"), "sh600519");
        assert_eq!(to_tencent_code("HK00700"), "hk00700");
        assert_eq!(to_tencent_code("00700"), "hk00700");
        assert_eq!(to_tencent_code("430047"), "bj430047");
    }

    #[test]
    fn em_codes_and_secids() {
        assert_eq!(to_em_code("600519"), "SH600519");
        assert_eq!(to_em_code("600519.SH"), "SH600519");
        assert_eq!(to_em_code("300750"), "SZ300750");
        assert_eq!(to_em_code("900901"), "SH900901");
        assert_eq!(to_em_code("00700"), "HK00700");
        assert_eq!(to_em_code("430047"), "BJ430047");
        assert_eq!(to_em_secid("600519"), "1.600519");
        assert_eq!(to_em_secid("300750"), "0.300750");
        assert_eq!(to_em_secid("00700"), "116.00700");
        assert_eq!(to_em_secid("430047"), "0.430047");
    }

    #[test]
    fn market_classification() {
        assert!(is_hk_stock("00700"));
        assert!(is_hk_stock("hk00700"));
        assert!(is_hk_stock("00700.HK"));
        assert!(!is_hk_stock("600519"));
        assert!(is_bse_stock("430047"));
        assert!(is_bse_stock("830001"));
        assert!(is_bse_stock("920001"));
        assert!(!is_bse_stock("600519"));
        assert!(!is_bse_stock("300750"));
    }

    #[test]
    fn parse_json_f64_accepts_number_and_string() {
        assert_eq!(parse_json_f64(&serde_json::json!(12.5)), 12.5);
        assert_eq!(parse_json_f64(&serde_json::json!("12.5")), 12.5);
        assert_eq!(parse_json_f64(&serde_json::json!(null)), 0.0);
    }
}
