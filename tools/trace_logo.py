#!/usr/bin/env python3
"""
Trace the Epsilon Labs mark out of the raster that ships on the hardware.

`assets/brand/epsilon-raster.png` is the 120px white epsilon embedded in the
Epsilon1 firmware (`src/StartupLogoPng.h`) — it is the mark that boots on the
device, so it is the authoritative one. It is also only 120px, which is not
enough to set type-height on a retina display or to sample 40k points from.

This walks its alpha channel and emits a vector of the same shape:

    python3 tools/trace_logo.py          # writes assets/brand/epsilon.svg

Run once. The SVG is committed; you do not need this script to build the site.

Method: bicubic-ish upsample of the alpha field, marching squares with
sub-pixel interpolation along the 0.5 iso-line, Douglas-Peucker simplification,
then Catmull-Rom -> cubic Bezier so the curves stay smooth at any size.
"""

import math
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "assets", "brand", "epsilon-raster.png")
DST = os.path.join(ROOT, "assets", "brand", "epsilon.svg")

UPSAMPLE = 6       # 120 -> 720, enough that the iso-line reads smooth
SIMPLIFY = 1.6     # Douglas-Peucker tolerance, in upsampled pixels
MIN_POINTS = 12    # drop specks; the mark has exactly one contour


# ── PNG ───────────────────────────────────────────────────────────────────

def read_rgba(path):
    """Minimal PNG reader. Handles the 8-bit RGBA non-interlaced case, which
    is what the firmware asset is. Anything else is a hard error rather than a
    silent wrong answer."""
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: not a PNG")

    idat = b""
    width = height = depth = color = None
    i = 8
    while i < len(data):
        (length,) = struct.unpack(">I", data[i:i + 4])
        kind = data[i + 4:i + 8]
        chunk = data[i + 8:i + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", chunk[:13])
            if (depth, color, interlace) != (8, 6, 0):
                raise ValueError(
                    f"{path}: expected 8-bit RGBA non-interlaced, "
                    f"got depth={depth} colortype={color} interlace={interlace}"
                )
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
        i += 12 + length

    if width is None:
        raise ValueError(f"{path}: no IHDR")

    raw = zlib.decompress(idat)
    bpp, stride = 4, width * 4
    out = bytearray(height * stride)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        f = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if f:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                if f == 1:
                    line[x] = (line[x] + a) & 255
                elif f == 2:
                    line[x] = (line[x] + b) & 255
                elif f == 3:
                    line[x] = (line[x] + (a + b) // 2) & 255
                elif f == 4:
                    p = a + b - c
                    da, db, dc = abs(p - a), abs(p - b), abs(p - c)
                    pr = a if (da <= db and da <= dc) else (b if db <= dc else c)
                    line[x] = (line[x] + pr) & 255
                else:
                    raise ValueError(f"{path}: bad filter type {f} on row {y}")
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, out


# ── scalar field ──────────────────────────────────────────────────────────

def alpha_field(width, height, rgba):
    return [[rgba[(y * width + x) * 4 + 3] / 255.0 for x in range(width)] for y in range(height)]


def sample(field, w, h, x, y):
    """Bilinear sample with clamped edges."""
    x = min(max(x, 0.0), w - 1.0)
    y = min(max(y, 0.0), h - 1.0)
    x0, y0 = int(x), int(y)
    x1, y1 = min(x0 + 1, w - 1), min(y0 + 1, h - 1)
    fx, fy = x - x0, y - y0
    top = field[y0][x0] * (1 - fx) + field[y0][x1] * fx
    bot = field[y1][x0] * (1 - fx) + field[y1][x1] * fx
    return top * (1 - fy) + bot * fy


def upsample(field, w, h, factor):
    """Bilinear upsample, then one pass of a small binomial blur so the
    iso-line does not inherit the source's pixel staircase."""
    W, H = w * factor, h * factor
    big = [[sample(field, w, h, x / factor, y / factor) for x in range(W)] for y in range(H)]

    k = [1, 4, 6, 4, 1]
    ks = 16
    tmp = [[0.0] * W for _ in range(H)]
    for y in range(H):
        row = big[y]
        for x in range(W):
            s = 0.0
            for i, kv in enumerate(k):
                xx = min(max(x + i - 2, 0), W - 1)
                s += row[xx] * kv
            tmp[y][x] = s / ks
    for x in range(W):
        col = [tmp[y][x] for y in range(H)]
        for y in range(H):
            s = 0.0
            for i, kv in enumerate(k):
                yy = min(max(y + i - 2, 0), H - 1)
                s += col[yy] * kv
            big[y][x] = s / ks
    return big, W, H


# ── marching squares ──────────────────────────────────────────────────────

ISO = 0.5


def lerp_edge(pa, va, pb, vb):
    denom = (vb - va)
    t = 0.5 if abs(denom) < 1e-9 else (ISO - va) / denom
    t = min(max(t, 0.0), 1.0)
    return (pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t)


def contours(field, W, H):
    """Collect iso-line segments cell by cell, then chain them into rings."""
    segs = []
    for y in range(H - 1):
        for x in range(W - 1):
            tl, tr = field[y][x], field[y][x + 1]
            bl, br = field[y + 1][x], field[y + 1][x + 1]
            idx = (1 if tl > ISO else 0) | (2 if tr > ISO else 0) | \
                  (4 if br > ISO else 0) | (8 if bl > ISO else 0)
            if idx in (0, 15):
                continue
            p_top = lerp_edge((x, y), tl, (x + 1, y), tr)
            p_right = lerp_edge((x + 1, y), tr, (x + 1, y + 1), br)
            p_bottom = lerp_edge((x + 1, y + 1), br, (x, y + 1), bl)
            p_left = lerp_edge((x, y + 1), bl, (x, y), tl)

            # Wound so the filled side stays on the left.
            table = {
                1: [(p_left, p_top)], 2: [(p_top, p_right)], 3: [(p_left, p_right)],
                4: [(p_right, p_bottom)], 6: [(p_top, p_bottom)],
                7: [(p_left, p_bottom)], 8: [(p_bottom, p_left)],
                9: [(p_bottom, p_top)], 11: [(p_bottom, p_right)],
                12: [(p_right, p_left)], 13: [(p_right, p_top)],
                14: [(p_top, p_left)],
                5: [(p_left, p_top), (p_right, p_bottom)],
                10: [(p_top, p_right), (p_bottom, p_left)],
            }
            segs.extend(table[idx])

    # chain
    q = 10000.0
    def keyof(p):
        return (round(p[0] * q), round(p[1] * q))

    starts = {}
    for a, b in segs:
        starts.setdefault(keyof(a), []).append((a, b))

    rings, used = [], set()
    for a0, b0 in segs:
        if id((a0, b0)) in used:
            continue
        ring = [a0, b0]
        used.add(id((a0, b0)))
        cur = b0
        while True:
            nxt = None
            for cand in starts.get(keyof(cur), []):
                if id(cand) in used:
                    continue
                nxt = cand
                break
            if nxt is None:
                break
            used.add(id(nxt))
            cur = nxt[1]
            if keyof(cur) == keyof(a0):
                break
            ring.append(cur)
        if len(ring) >= MIN_POINTS:
            rings.append(ring)
    return rings


# ── simplify + fit ────────────────────────────────────────────────────────

def rdp(points, tol):
    if len(points) < 3:
        return points[:]
    ax, ay = points[0]
    bx, by = points[-1]
    dx, dy = bx - ax, by - ay
    norm = math.hypot(dx, dy)
    worst, wi = -1.0, 0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        if norm < 1e-9:
            d = math.hypot(px - ax, py - ay)
        else:
            d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
        if d > worst:
            worst, wi = d, i
    if worst <= tol:
        return [points[0], points[-1]]
    return rdp(points[:wi + 1], tol)[:-1] + rdp(points[wi:], tol)


def to_bezier(ring, sx, sy, ox, oy, tension=1.0):
    """Closed Catmull-Rom through the simplified ring, emitted as cubics."""
    n = len(ring)
    def P(i):
        x, y = ring[i % n]
        return ((x - ox) * sx, (y - oy) * sy)

    d = []
    x0, y0 = P(0)
    d.append(f"M{x0:.2f} {y0:.2f}")
    for i in range(n):
        p0, p1, p2, p3 = P(i - 1), P(i), P(i + 1), P(i + 2)
        c1 = (p1[0] + (p2[0] - p0[0]) / 6.0 * tension, p1[1] + (p2[1] - p0[1]) / 6.0 * tension)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6.0 * tension, p2[1] - (p3[1] - p1[1]) / 6.0 * tension)
        d.append(f"C{c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}")
    d.append("Z")
    return "".join(d)


# ── main ──────────────────────────────────────────────────────────────────

def main():
    if not os.path.exists(SRC):
        sys.exit(f"missing {SRC}")

    w, h, rgba = read_rgba(SRC)
    field = alpha_field(w, h, rgba)
    big, W, H = upsample(field, w, h, UPSAMPLE)

    rings = contours(big, W, H)
    if not rings:
        sys.exit("traced no contours — is the raster empty?")
    rings.sort(key=len, reverse=True)

    simplified = [rdp(r, SIMPLIFY) for r in rings]

    xs = [p[0] for r in simplified for p in r]
    ys = [p[1] for r in simplified for p in r]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    gw, gh = maxx - minx, maxy - miny

    # Normalise onto a 1000-tall canvas so the mark can be set by cap height.
    scale = 1000.0 / gh
    vw = gw * scale
    paths = [to_bezier(r, scale, scale, minx, miny) for r in simplified]

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw:.2f} 1000" role="img" aria-label="Epsilon Labs">
  <title>Epsilon Labs</title>
  <path fill="currentColor" fill-rule="evenodd" d="{''.join(paths)}"/>
</svg>
"""
    with open(DST, "w") as f:
        f.write(svg)

    print(f"source   {w}x{h} raster, {sum(1 for y in range(h) for x in range(w) if field[y][x] > 0.5)} filled px")
    print(f"traced   {len(rings)} contour(s), {sum(len(r) for r in rings)} raw points")
    print(f"simplified to {sum(len(r) for r in simplified)} points (tol {SIMPLIFY}px @ {UPSAMPLE}x)")
    print(f"viewBox  0 0 {vw:.2f} 1000   (aspect {vw / 1000:.4f})")
    print(f"wrote    {DST}  ({os.path.getsize(DST)} bytes)")


if __name__ == "__main__":
    main()
