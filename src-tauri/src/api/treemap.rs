/// 大盘云图数据源 — 参考 52etf.site 架构
///
/// 两个接口:
/// 1. 行业树结构(行业 → 细分行业 → 个股, 含流通市值)
///    GET https://52etf.site/api/market/treemap?market=all&v=1
///    需自定义请求头 `x-52etf-site-request: 1`(WAF 校验), 结构一天内基本不变 → 内存缓存 1 小时
/// 2. 实时行情(现价 + 涨跌幅)
///    POST https://gateway.jrj.com/quot-dpyt/hq  body {"column":"chg"}  → 无风控, 3 秒缓存
///    key 格式: 首位市场(1=SH, 0/2=SZ) + 6 位代码; np=现价, var=涨跌幅小数(×100 得百分比)
use crate::types::{MarketTreemap, TreemapIndustry, TreemapSector, TreemapStock};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// 行业树结构缓存(结构一天才变一次, 缓存 1 小时)
static TREE_CACHE: Mutex<Option<(Instant, Vec<TreemapIndustry>)>> = Mutex::new(None);
/// 实时行情缓存(jrj 接口无风控, 3 秒缓存足够)
static QUOTE_CACHE: Mutex<Option<(Instant, HashMap<String, (f64, f64)>)>> = Mutex::new(None);

const TREE_TTL: Duration = Duration::from_secs(3600);
const QUOTE_TTL: Duration = Duration::from_secs(3);

/// 拉取行业树结构(带 1 小时缓存)
async fn fetch_treemap_tree() -> Result<Vec<TreemapIndustry>, String> {
    if let Some((ts, tree)) = TREE_CACHE.lock().unwrap().as_ref() {
        if ts.elapsed() < TREE_TTL {
            return Ok(tree.clone());
        }
    }
    let client = super::build_http_client()?;
    let resp = client
        .get("https://52etf.site/api/market/treemap?market=all&v=1")
        // WAF 双重校验(2026-08-13 实测): Origin 必须是 52etf.site 域名(或 Referer 指向该站), 且必须携带自定义头 x-52etf-site-request: 1, 缺一即 403
        .header("Origin", "https://52etf.site")
        .header("x-52etf-site-request", "1")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("请求行业树失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("行业树接口返回 {}", resp.status()));
    }
    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析行业树 JSON 失败: {}", e))?;
    let arr = json.as_array().ok_or("行业树格式错误")?;
    let mut industries = Vec::with_capacity(arr.len());
    for ind in arr {
        let code = ind[0].as_str().unwrap_or("").to_string();
        let name = ind[1].as_str().unwrap_or("").to_string();
        let value = ind[2].as_f64().unwrap_or(0.0);
        let mut sectors = Vec::new();
        if let Some(sec_arr) = ind.get(3).and_then(|v| v.as_array()) {
            for sec in sec_arr {
                let s_code = sec[0].as_str().unwrap_or("").to_string();
                let s_name = sec[1].as_str().unwrap_or("").to_string();
                let s_value = sec[2].as_f64().unwrap_or(0.0);
                let mut stocks = Vec::new();
                if let Some(stk_arr) = sec.get(3).and_then(|v| v.as_array()) {
                    for stk in stk_arr {
                        stocks.push(TreemapStock {
                            code: stk[0].as_str().unwrap_or("").to_string(),
                            name: stk[1].as_str().unwrap_or("").to_string(),
                            value: stk[2].as_f64().unwrap_or(0.0),
                            price: 0.0,
                            chg: 0.0,
                        });
                    }
                }
                sectors.push(TreemapSector {
                    code: s_code,
                    name: s_name,
                    value: s_value,
                    chg: 0.0,
                    stocks,
                });
            }
        }
        industries.push(TreemapIndustry {
            code,
            name,
            value,
            chg: 0.0,
            sectors,
        });
    }
    *TREE_CACHE.lock().unwrap() = Some((Instant::now(), industries.clone()));
    Ok(industries)
}

/// 拉取实时行情(现价 + 涨跌幅, 3 秒缓存)
/// 返回 map: 股票代码("688256.SH") → (现价, 涨跌幅%)
async fn fetch_jrj_quotes() -> Result<HashMap<String, (f64, f64)>, String> {
    if let Some((ts, map)) = QUOTE_CACHE.lock().unwrap().as_ref() {
        if ts.elapsed() < QUOTE_TTL {
            return Ok(map.clone());
        }
    }
    let client = super::build_http_client()?;
    let resp = client
        .post("https://gateway.jrj.com/quot-dpyt/hq")
        .header("Content-Type", "application/json")
        .body(r#"{"column":"chg"}"#)
        .send()
        .await
        .map_err(|e| format!("请求实时行情失败: {}", e))?;
    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析实时行情 JSON 失败: {}", e))?;
    let hqs = json
        .get("data")
        .and_then(|d| d.get("hqs"))
        .and_then(|h| h.as_object())
        .ok_or("实时行情响应缺少 data.hqs")?;
    let mut map = HashMap::with_capacity(hqs.len());
    for (key, v) in hqs {
        // key 格式: 首位市场(1=SH, 0/2=SZ) + 6 位代码
        let market = match key.chars().next() {
            Some('1') => "SH",
            Some('0') | Some('2') => "SZ",
            _ => continue,
        };
        let code = key.get(1..).unwrap_or("");
        if code.len() != 6 {
            continue;
        }
        let np = v.get("np").and_then(|x| x.as_f64()).unwrap_or(0.0);
        let var = v.get("var").and_then(|x| x.as_f64()).unwrap_or(0.0);
        map.insert(format!("{}.{}", code, market), (np, var * 100.0));
    }
    *QUOTE_CACHE.lock().unwrap() = Some((Instant::now(), map.clone()));
    Ok(map)
}

/// 合并行业树与实时行情, 生成完整大盘云图数据
pub async fn fetch_market_treemap() -> Result<MarketTreemap, String> {
    let mut industries = fetch_treemap_tree().await?;
    let quotes = fetch_jrj_quotes().await?;

    let mut up = 0u32;
    let mut flat = 0u32;
    let mut down = 0u32;

    for ind in &mut industries {
        let (mut wsum, mut wchg) = (0.0, 0.0);
        for sec in &mut ind.sectors {
            let (mut swsum, mut swchg) = (0.0, 0.0);
            for stk in &mut sec.stocks {
                if let Some((price, chg)) = quotes.get(&stk.code) {
                    stk.price = *price;
                    stk.chg = *chg;
                    if *chg > 0.01 {
                        up += 1;
                    } else if *chg < -0.01 {
                        down += 1;
                    } else {
                        flat += 1;
                    }
                    swsum += stk.value.max(0.0);
                    swchg += chg * stk.value.max(0.0);
                }
            }
            sec.chg = if swsum > 0.0 { swchg / swsum } else { 0.0 };
            wsum += sec.value.max(0.0);
            wchg += sec.chg * sec.value.max(0.0);
        }
        ind.chg = if wsum > 0.0 { wchg / wsum } else { 0.0 };
    }

    Ok(MarketTreemap {
        time: now_str(),
        up,
        flat,
        down,
        industries,
    })
}

/// 当前时间字符串(UTC+8), 格式 "2026-08-13 16:40"
fn now_str() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
        + 8 * 3600; // UTC+8
    let days = secs / 86400;
    let rem = secs % 86400;
    let (y, m, d) = civil_from_days(days);
    format!("{:04}-{:02}-{:02} {:02}:{:02}", y, m, d, rem / 3600, (rem % 3600) / 60)
}

/// 天数 → 公历日期 (Howard Hinnant 算法)
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
