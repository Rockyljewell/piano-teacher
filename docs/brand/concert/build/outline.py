import sys, json
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

def kern_pairs(font):
    gpos = font['GPOS'].table
    res = {}
    for li, lookup in enumerate(gpos.LookupList.Lookup):
        subs = lookup.SubTable
        for st in subs:
            if lookup.LookupType == 9: st = st.ExtSubTable
            if getattr(st, 'LookupType', lookup.LookupType) != 2 and lookup.LookupType not in (2,9): continue
            if not hasattr(st, 'Format'): continue
            if not hasattr(st, 'Coverage'): continue
            cov = st.Coverage.glyphs
            if st.Format == 1:
                for i, g1 in enumerate(cov):
                    for pvr in st.PairSet[i].PairValueRecord:
                        v = pvr.Value1
                        if v is not None and getattr(v, 'XAdvance', 0):
                            res.setdefault((g1, pvr.SecondGlyph), v.XAdvance)
            elif st.Format == 2:
                cd1 = st.ClassDef1.classDefs; cd2 = st.ClassDef2.classDefs
                res.setdefault('__class__', []).append((set(cov), cd1, cd2, st.Class1Record))
    return res

def kern(res, a, b):
    if (a, b) in res: return res[(a, b)]
    for cov, cd1, cd2, recs in res.get('__class__', []):
        if a not in cov: continue
        c1 = cd1.get(a, 0); c2 = cd2.get(b, 0)
        v = recs[c1].Class2Record[c2].Value1
        if v is not None and getattr(v, 'XAdvance', 0): return v.XAdvance
    return 0

def outline(fontfile, text, tracking=0):
    font = TTFont(fontfile)
    cmap = font.getBestCmap(); gs = font.getGlyphSet(); hmtx = font['hmtx']
    upm = font['head'].unitsPerEm
    res = kern_pairs(font)
    x = 0; paths = []; names = [cmap[ord(c)] for c in text]; boxes=[]
    for i, g in enumerate(names):
        pen = SVGPathPen(gs)
        tp = TransformPen(pen, (1, 0, 0, -1, x, 0))
        gs[g].draw(tp)
        bp = BoundsPen(gs); gs[g].draw(bp)
        b = bp.bounds
        boxes.append((x + (b[0] if b else 0), x + (b[2] if b else 0), -(b[3] if b else 0), -(b[1] if b else 0)))
        paths.append(pen.getCommands())
        x += hmtx[g][0] + tracking
        if i + 1 < len(names): x += kern(res, g, names[i+1])
    return {'upm': upm, 'paths': paths, 'boxes': boxes, 'advance': x - tracking,
            'ascender': font['hhea'].ascent, 'descender': font['hhea'].descent,
            'capHeight': getattr(font['OS/2'], 'sCapHeight', 0), 'xHeight': getattr(font['OS/2'], 'sxHeight', 0)}

if __name__ == '__main__':
    fontfile, text, tracking = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 0
    print(json.dumps(outline(fontfile, text, tracking)))
