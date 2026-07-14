"""三阳线（红色阳线 + 上升趋势）应用图标生成器"""
from PIL import Image, ImageDraw
import os

ICON_DIR = r"e:\stock-analysis\src-tauri\icons"

# 目标尺寸列表
SIZES = [
    ("32x32.png", 32),
    ("128x128.png", 128),
    ("256x256.png", 256),
    ("310x310.png", 310),
    ("icon.png", 512),
    ("icon.ico", 256),
    # Windows Store 图标
    ("Square30x30Logo.png", 30),
    ("Square44x44Logo.png", 44),
    ("Square71x71Logo.png", 71),
    ("Square89x89Logo.png", 89),
    ("Square107x107Logo.png", 107),
    ("Square142x142Logo.png", 142),
    ("Square150x150Logo.png", 150),
    ("Square284x284Logo.png", 284),
    ("Square310x310Logo.png", 310),
    ("StoreLogo.png", 50),
]


def draw_icon(size: int) -> Image.Image:
    """绘制三阳线图标"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 背景：深色圆角方形
    margin = size * 0.04
    bg_radius = size * 0.22
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=bg_radius,
        fill=(23, 25, 28),  # --ink
    )

    # K线绘制区域（在背景内部留 padding）
    pad = size * 0.22
    area_top = pad
    area_bottom = size - pad
    area_h = area_bottom - area_top
    area_w = size - 2 * pad
    area_center_y = (area_top + area_bottom) / 2

    # 三根阳线参数
    candle_count = 3
    candle_gap = area_w * 0.10
    body_width = (area_w - (candle_count + 1) * candle_gap) / candle_count
    wick_width = max(1.5, size * 0.008)

    # 阳线颜色
    bull_color = (220, 38, 38)

    # 三根蜡烛：高度递增，中心位置逐步上移（体现上升趋势）
    body_heights_pct = [0.38, 0.52, 0.62]   # 实体高度占 area_h 比例
    center_pct =       [0.65, 0.57, 0.47]   # 实体中心距 area_top 的比例（越小越靠上）

    for i in range(candle_count):
        # 水平居中：等间距分布
        cx = pad + candle_gap + i * (body_width + candle_gap) + body_width / 2

        body_h = body_heights_pct[i] * area_h
        body_center_y = area_top + center_pct[i] * area_h
        body_top = body_center_y - body_h / 2
        body_bottom = body_center_y + body_h / 2

        # 影线
        wick_top = body_top - area_h * 0.04
        wick_bottom = body_bottom + area_h * 0.04
        draw.rounded_rectangle(
            [cx - wick_width / 2, wick_top, cx + wick_width / 2, wick_bottom],
            radius=wick_width / 2,
            fill=bull_color,
        )

        # 实体（阳线矩形）
        draw.rounded_rectangle(
            [
                cx - body_width / 2,
                body_top,
                cx + body_width / 2,
                body_bottom,
            ],
            radius=body_width * 0.18,
            fill=bull_color,
        )

    return img


def main():
    os.makedirs(ICON_DIR, exist_ok=True)

    # 以 1024px 为基准渲染，再缩放
    base_size = 1024
    base_img = draw_icon(base_size)

    for filename, target_size in SIZES:
        filepath = os.path.join(ICON_DIR, filename)
        if target_size == base_size:
            resized = base_img
        else:
            resized = base_img.resize((target_size, target_size), Image.LANCZOS)
        # ICO 格式需要保存为 RGBA PNG 或直接存 ICO
        if filename.endswith(".ico"):
            resized.save(filepath, format="ICO", sizes=[(target_size, target_size)])
        else:
            resized.save(filepath, format="PNG")
        print(f"  ✓ {filename} ({target_size}×{target_size})")

    print(f"\n全部 {len(SIZES)} 个图标已生成到 {ICON_DIR}")


if __name__ == "__main__":
    main()
