"""다비오 회의록 빌더: 회의록 JSON -> DOCX, HWPX, PDF

사용법: python3 templates/build_minutes.py <회의록.json> [출력폴더]
출력 파일명은 JSON의 file_name 값을 그대로 사용한다.
"""
import json, os, subprocess, sys, zipfile
from xml.sax.saxutils import escape

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor

HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, "dabeeo_logo.png")
LOGO_PX = (618, 138)
FONT = "Pretendard"  # 굵은 글씨 (templates/fonts, Bold)
FONT_REG = "Pretendard Medium"  # 본문 (Regular 파일이 없어 Medium 사용)
NAVY, BLUE, HEAD_BG, GRAY = "1B2A6B", "4C7DF0", "E8EDF8", "8A93AD"
TAGLINE = "Dabeeo is an Earth Intelligence Company."
CLASS = "사내 공유용"
META_KEYS = ["회의주제", "회의일자", "회의장소", "참석자(내부)", "참석자(외부)"]


# ---------------------------------------------------------------- DOCX
def _font(run, size, bold=False, color=None):
    name = FONT if bold else FONT_REG
    run.font.name = name
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def _para(container, text="", size=9.5, bold=False, color=None, align=None, after=0, line=1.5):
    p = container.add_paragraph()
    pf = p.paragraph_format
    pf.space_before, pf.space_after, pf.line_spacing = Pt(0), Pt(after), line
    if align:
        p.alignment = align
    if text:
        _font(p.add_run(text), size, bold, color)
    return p


def _cell_borders(cell, color=NAVY, sz=6, sides=("top", "left", "bottom", "right")):
    tcPr = cell._element.get_or_add_tcPr()
    b = OxmlElement("w:tcBorders")
    for side in ("top", "left", "bottom", "right"):
        e = OxmlElement(f"w:{side}")
        if side in sides:
            e.set(qn("w:val"), "single"); e.set(qn("w:sz"), str(sz)); e.set(qn("w:color"), color)
        else:
            e.set(qn("w:val"), "nil")
        b.append(e)
    tcPr.append(b)


def _shade(cell, fill):
    s = OxmlElement("w:shd")
    s.set(qn("w:val"), "clear"); s.set(qn("w:color"), "auto"); s.set(qn("w:fill"), fill)
    cell._element.get_or_add_tcPr().append(s)


def _widths(table, widths):
    table.autofit = False
    layout = OxmlElement("w:tblLayout"); layout.set(qn("w:type"), "fixed")
    table._tbl.tblPr.append(layout)
    for i, w in enumerate(widths):
        table.columns[i].width = w
        for c in table.columns[i].cells:
            c.width = w


def _first_para(cell):
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1.5
    return p


def build_docx(d, path):
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Mm(210), Mm(297)
    sec.left_margin = sec.right_margin = Mm(20)
    sec.top_margin, sec.bottom_margin = Mm(15), Mm(15)
    width = Mm(170)

    # 상단: 로고 | MEETING MINUTES, 아래 남색 굵은 선
    top = doc.add_table(rows=1, cols=2)
    top.alignment = WD_TABLE_ALIGNMENT.CENTER
    l, r = top.rows[0].cells
    _widths(top, [Mm(85), Mm(85)])
    _first_para(l).add_run().add_picture(LOGO, width=Mm(30))
    rp = _first_para(r); rp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    _font(rp.add_run("MEETING MINUTES"), 8, True, NAVY)
    for c in (l, r):
        _cell_borders(c, sz=18, sides=("bottom",))

    _para(doc, after=6)
    _para(doc, "회 의 록", 20, True, NAVY, WD_ALIGN_PARAGRAPH.CENTER, after=10)

    # 본문 표
    rows = META_KEYS + ["내용", "특이사항"]
    t = doc.add_table(rows=len(rows), cols=2)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    _widths(t, [Mm(32), width - Mm(32)])
    for i, key in enumerate(rows):
        th, td = t.rows[i].cells
        _cell_borders(th); _cell_borders(td); _shade(th, HEAD_BG)
        _font(_first_para(th).add_run(key), 9.5, True, NAVY)
        if key in META_KEYS:
            _font(_first_para(td).add_run(d["meta"].get(key, "")), 9.5)
        elif key == "내용":
            first = True
            for s in d["sections"]:
                p = _first_para(td) if first else _para(td)
                if not first:
                    p.paragraph_format.space_before = Pt(6)
                first = False
                _font(p.add_run("▌"), 10, True, BLUE)
                _font(p.add_run(s["title"]), 10.5, True)
                for sub in s["subs"]:
                    if sub.get("title"):
                        sp = _para(td, sub["title"], 9.5, True, NAVY)
                        sp.paragraph_format.space_before = Pt(2)
                    for ln in sub["lines"]:
                        _para(td, ln)
        else:
            notes = d.get("notes") or [""]
            _font(_first_para(td).add_run(notes[0]), 9.5)
            for n in notes[1:]:
                _para(td, n)

    # 바닥글
    fp = sec.footer.paragraphs[0]
    ts = fp.paragraph_format.tab_stops
    for pos in (Mm(82.55), Mm(165.1)):  # Footer 스타일 기본 탭 제거
        ts.add_tab_stop(pos, WD_TAB_ALIGNMENT.CLEAR)
    ts.add_tab_stop(width, WD_TAB_ALIGNMENT.RIGHT)
    _font(fp.add_run(TAGLINE + "\t" + CLASS), 8, color=GRAY)
    doc.save(path)


# ---------------------------------------------------------------- HWPX
NS = ('xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" '
      'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" '
      'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" '
      'xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" '
      'xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" '
      'xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" '
      'xmlns:opf="http://www.idpf.org/2007/opf/"')
LANGS = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"]
LKEYS = ["hangul", "latin", "hanja", "japanese", "other", "symbol", "user"]
MM = 283.465
# charPr: (pt, bold, color)
CHARS = [(10, 0, "#000000"), (9.5, 0, "#000000"), (10.5, 1, "#000000"), (9.5, 1, "#" + NAVY),
         (20, 1, "#" + NAVY), (8, 1, "#" + NAVY), (8, 0, "#" + GRAY), (10, 1, "#" + BLUE)]
C_BODY, C_SEC, C_SUB, C_TITLE, C_MM, C_FOOT, C_MARK = 1, 2, 3, 4, 5, 6, 7
P_LEFT, P_CENTER, P_RIGHT, P_GAP = 0, 1, 2, 3


def _attrs(v):
    return " ".join(f'{k}="{v}"' for k in LKEYS)


def _border(id_, sides=None, width="0.12 mm", fill=None):
    sides = sides or {}
    xs = "".join(f'<hh:{s}Border type="{"SOLID" if s in sides else "NONE"}" '
                 f'width="{sides.get(s, "0.1 mm")}" color="#{NAVY if s in sides else "000000"}"/>'
                 for s in ("left", "right", "top", "bottom"))
    fb = (f'<hc:fillBrush><hc:winBrush faceColor="#{fill}" hatchColor="#999999" alpha="0"/></hc:fillBrush>'
          if fill else "")
    return (f'<hh:borderFill id="{id_}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">'
            '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>'
            f'{xs}<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>{fb}</hh:borderFill>')


def _header():
    font = "".join(
        f'<hh:font id="{i}" face="{f}" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" '
        'weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" '
        'midline="1" xHeight="1"/></hh:font>' for i, f in enumerate([FONT_REG, FONT]))
    faces = "".join(f'<hh:fontface lang="{l}" fontCnt="2">{font}</hh:fontface>' for l in LANGS)
    thin = "0.12 mm"
    bfs = [_border(1), _border(2),
           _border(3, {s: thin for s in ("left", "right", "top", "bottom")}),
           _border(4, {s: thin for s in ("left", "right", "top", "bottom")}, fill=HEAD_BG),
           _border(5, {"bottom": "0.7 mm"})]
    chars = []
    for i, (pt, bold, color) in enumerate(CHARS):
        chars.append(
            f'<hh:charPr id="{i}" height="{int(pt * 100)}" textColor="{color}" shadeColor="none" useFontSpace="0" '
            f'useKerning="0" symMark="NONE" borderFillIDRef="2">'
            f'<hh:fontRef {_attrs(1 if bold else 0)}/>'
            f'<hh:ratio {_attrs(100)}/>'
            f'<hh:spacing {_attrs(0)}/>'
            f'<hh:relSz {_attrs(100)}/>'
            f'<hh:offset {_attrs(0)}/>'
            f'{"<hh:bold/>" if bold else ""}'
            '<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/>'
            '<hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>')
    paras = []
    for i, (align, prev) in enumerate([("LEFT", 0), ("CENTER", 0), ("RIGHT", 0), ("LEFT", 600)]):
        paras.append(
            f'<hh:paraPr id="{i}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" '
            'suppressLineNumbers="0" checked="0">'
            f'<hh:align horizontal="{align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>'
            '<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" '
            'keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>'
            '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>'
            '<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/>'
            f'<hc:right value="0" unit="HWPUNIT"/><hc:prev value="{prev}" unit="HWPUNIT"/>'
            '<hc:next value="0" unit="HWPUNIT"/></hh:margin>'
            '<hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>'
            '<hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" '
            'connect="0" ignoreMargin="0"/></hh:paraPr>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<hh:head {NS} version="1.4" secCnt="1">'
            '<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList>'
            f'<hh:fontfaces itemCnt="7">{faces}</hh:fontfaces>'
            f'<hh:borderFills itemCnt="{len(bfs)}">{"".join(bfs)}</hh:borderFills>'
            f'<hh:charProperties itemCnt="{len(chars)}">{"".join(chars)}</hh:charProperties>'
            '<hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>'
            f'<hh:paraProperties itemCnt="{len(paras)}">{"".join(paras)}</hh:paraProperties>'
            '<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" '
            'charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles>'
            '</hh:refList><hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/>'
            '</hh:compatibleDocument><hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/>'
            '</hh:docOption><hh:trackchageConfig flags="56"/></hh:head>')


class _Ids:
    n = 1000

    def __call__(self):
        _Ids.n += 1
        return _Ids.n


_id = _Ids()


def _p(runs, para=P_LEFT, inner=""):
    """runs: [(charPrID, text)]"""
    rs = "".join(f'<hp:run charPrIDRef="{c}"><hp:t>{escape(t)}</hp:t></hp:run>' for c, t in runs)
    return (f'<hp:p id="{_id()}" paraPrIDRef="{para}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
            f'{inner}{rs or "<hp:run charPrIDRef=" + chr(34) + "0" + chr(34) + "/>"}</hp:p>')


def _tc(col, row, w, h, bf, paras, valign="TOP"):
    return (f'<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="{bf}">'
            f'<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="{valign}" '
            'linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'
            f'{"".join(paras)}</hp:subList><hp:cellAddr colAddr="{col}" rowAddr="{row}"/>'
            f'<hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="{w}" height="{h}"/>'
            '<hp:cellMargin left="510" right="510" top="283" bottom="283"/></hp:tc>')


def _tbl(rows, widths, row_h):
    W = sum(widths)
    trs = "".join(f"<hp:tr>{''.join(r)}</hp:tr>" for r in rows)
    return (f'<hp:tbl id="{_id()}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" '
            'textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" '
            f'rowCnt="{len(rows)}" colCnt="{len(widths)}" cellSpacing="0" borderFillIDRef="2" noAdjust="0">'
            f'<hp:sz width="{W}" widthRelTo="ABSOLUTE" height="{row_h * len(rows)}" heightRelTo="ABSOLUTE" protect="0"/>'
            '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" '
            'vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
            '<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
            '<hp:inMargin left="510" right="510" top="141" bottom="141"/>'
            f'{trs}</hp:tbl>')


def _pic(w, h):
    pw, ph = LOGO_PX[0] * 75, LOGO_PX[1] * 75
    return (f'<hp:pic id="{_id()}" zOrder="1" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" '
            'textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" '
            f'instid="{_id()}" reverse="0">'
            f'<hp:offset x="0" y="0"/><hp:orgSz width="{w}" height="{h}"/><hp:curSz width="{w}" height="{h}"/>'
            f'<hp:flip horizontal="0" vertical="0"/>'
            f'<hp:rotationInfo angle="0" centerX="{w // 2}" centerY="{h // 2}" rotateimage="1"/>'
            '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
            '<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
            '<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>'
            f'<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="{w}" y="0"/><hc:pt2 x="{w}" y="{h}"/>'
            f'<hc:pt3 x="0" y="{h}"/></hp:imgRect>'
            f'<hp:imgClip left="0" right="{pw}" top="0" bottom="{ph}"/>'
            '<hp:inMargin left="0" right="0" top="0" bottom="0"/>'
            f'<hp:imgDim dimwidth="{pw}" dimheight="{ph}"/>'
            '<hc:img binaryItemIDRef="image1" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>'
            '<hp:effects/>'
            f'<hp:sz width="{w}" widthRelTo="ABSOLUTE" height="{h}" heightRelTo="ABSOLUTE" protect="0"/>'
            '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" '
            'vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
            '<hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic>')


SECPR = (
    '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" '
    'tabStopUnit="HWPUNIT" outlineShapeIDRef="0" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">'
    '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>'
    '<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>'
    '<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" '
    'fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>'
    '<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>'
    '<hp:pagePr landscape="WIDELY" width="59528" height="84186" gutterType="LEFT_ONLY">'
    '<hp:margin header="2835" footer="2835" gutter="0" left="5669" right="5669" top="4252" bottom="4252"/>'
    '</hp:pagePr>'
    '<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>'
    '<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/>'
    '<hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/>'
    '<hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/>'
    '</hp:footNotePr>'
    '<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>'
    '<hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/>'
    '<hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/>'
    '<hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/>'
    '</hp:endNotePr>'
    '<hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" '
    'fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>'
    '</hp:secPr><hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/>'
    '</hp:ctrl>')


def _section(d):
    text_w = 59528 - 2 * 5669
    half = text_w // 2
    lw = int(30 * MM); lh = int(lw * LOGO_PX[1] / LOGO_PX[0])
    first = (f'<hp:p id="{_id()}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
             f'<hp:run charPrIDRef="0">{SECPR}</hp:run><hp:run charPrIDRef="0">'
             + _tbl([[_tc(0, 0, half, lh + 600, 5,
                          [_p([], P_LEFT).replace('<hp:run charPrIDRef="0"/>',
                                                  f'<hp:run charPrIDRef="0">{_pic(lw, lh)}<hp:t/></hp:run>')],
                          "BOTTOM"),
                      _tc(1, 0, text_w - half, lh + 600, 5, [_p([(C_MM, "MEETING MINUTES")], P_RIGHT)],
                          "BOTTOM")]], [half, text_w - half], lh + 600)
             + '<hp:t/></hp:run></hp:p>')
    body = [first, _p([]), _p([(C_TITLE, "회 의 록")], P_CENTER), _p([])]

    c1 = int(32 * MM); c2 = text_w - c1
    rows = []
    keys = META_KEYS + ["내용", "특이사항"]
    for i, key in enumerate(keys):
        if key in META_KEYS:
            ps = [_p([(C_BODY, d["meta"].get(key, ""))])]
        elif key == "내용":
            ps = []
            for j, s in enumerate(d["sections"]):
                ps.append(_p([(C_MARK, "▌"), (C_SEC, s["title"])], P_LEFT if j == 0 else P_GAP))
                for sub in s["subs"]:
                    if sub.get("title"):
                        ps.append(_p([(C_SUB, sub["title"])]))
                    ps += [_p([(C_BODY, ln)]) for ln in sub["lines"]]
        else:
            ps = [_p([(C_BODY, n)]) for n in (d.get("notes") or [""])]
        rows.append([_tc(0, i, c1, 1500, 4, [_p([(C_SUB, key)])]), _tc(1, i, c2, 1500, 3, ps)])
    body.append(f'<hp:p id="{_id()}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                f'<hp:run charPrIDRef="0">{_tbl(rows, [c1, c2], 1500)}<hp:t/></hp:run></hp:p>')
    body.append(_p([]))
    body.append(_p([(C_FOOT, TAGLINE + "    |    " + CLASS)], P_RIGHT))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<hs:sec {NS}>{"".join(body)}</hs:sec>')


def build_hwpx(d, path):
    title = escape(d["meta"].get("회의주제", "회의록"))
    content_hpf = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<opf:package {NS} version="" unique-identifier="" id=""><opf:metadata>'
        f'<opf:title>{title}</opf:title><opf:language>ko</opf:language></opf:metadata><opf:manifest>'
        '<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>'
        '<opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/>'
        '<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>'
        '<opf:item id="settings" href="settings.xml" media-type="application/xml"/>'
        '</opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/>'
        '<opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>')
    files = {
        "version.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                       '<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" '
                       'tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" '
                       'xmlVersion="1.4" application="Hancom Office Hangul" appVersion="11, 0, 0, 0"/>',
        "META-INF/container.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                                  '<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" '
                                  'xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles>'
                                  '<ocf:rootfile full-path="Contents/content.hpf" '
                                  'media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>',
        "META-INF/manifest.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                                 '<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>',
        "Contents/content.hpf": content_hpf,
        "Contents/header.xml": _header(),
        "Contents/section0.xml": _section(d),
        "settings.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                        '<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" '
                        'xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0">'
                        '<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>',
    }
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/hwp+zip", compress_type=zipfile.ZIP_STORED)
        for name, xml in files.items():
            z.writestr(name, xml, compress_type=zipfile.ZIP_DEFLATED)
        z.write(LOGO, "BinData/image1.png", compress_type=zipfile.ZIP_DEFLATED)


# ---------------------------------------------------------------- main
def main():
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(src))
    d = json.load(open(src, encoding="utf-8"))
    base = os.path.join(out, d["file_name"])
    build_docx(d, base + ".docx")
    build_hwpx(d, base + ".hwpx")
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", out, base + ".docx"],
                   check=True, capture_output=True)
    print("\n".join(base + e for e in (".docx", ".hwpx", ".pdf")))


if __name__ == "__main__":
    main()
