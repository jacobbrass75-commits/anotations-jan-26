import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const outDir = path.resolve("docs/launch/visuals");
const publicOutDir = path.resolve("client/public/campaign-assets");

const colors = {
  paper: "#FAFAF8",
  cream: "#F5F3F0",
  sand: "#F1ECE2",
  ink: "#2D2A26",
  muted: "#8A8580",
  line: "#E8E4E0",
  rose: "#D4556B",
  blue: "#5B7FA5",
  green: "#5A9E8F",
  yellow: "#E9B44C",
  white: "#FFFFFF",
};

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function lines(items, x, y, size, gap, options = {}) {
  const {
    weight = 500,
    fill = colors.ink,
    family = "Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    anchor = "start",
  } = options;

  return items
    .map(
      (item, index) =>
        `<text x="${x}" y="${y + index * gap}" text-anchor="${anchor}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(item)}</text>`,
    )
    .join("\n");
}

function pill(x, y, w, label, fill, stroke = "none") {
  return `
    <rect x="${x}" y="${y}" width="${w}" height="54" rx="27" fill="${fill}" stroke="${stroke}" />
    <text x="${x + 28}" y="${y + 35}" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="21" font-weight="700" fill="${colors.ink}">${esc(label)}</text>
  `;
}

function miniWindow(x, y, w, h, title) {
  return `
    <g filter="url(#softShadow)">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="${colors.white}" stroke="${colors.line}" />
      <rect x="${x}" y="${y}" width="${w}" height="72" rx="24" fill="${colors.cream}" />
      <circle cx="${x + 34}" cy="${y + 36}" r="8" fill="#FF5F57" />
      <circle cx="${x + 58}" cy="${y + 36}" r="8" fill="#FFBD2E" />
      <circle cx="${x + 82}" cy="${y + 36}" r="8" fill="#28C840" />
      <text x="${x + 126}" y="${y + 44}" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="20" font-weight="700" fill="${colors.ink}">${esc(title)}</text>
      <rect x="${x + 48}" y="${y + 116}" width="${w - 96}" height="18" rx="9" fill="${colors.line}" />
      <rect x="${x + 48}" y="${y + 160}" width="${w - 180}" height="16" rx="8" fill="${colors.sand}" />
      <rect x="${x + 48}" y="${y + 194}" width="${w - 130}" height="16" rx="8" fill="${colors.sand}" />
      <rect x="${x + 48}" y="${y + 250}" width="${w - 96}" height="${Math.max(88, h - 312)}" rx="18" fill="${colors.paper}" stroke="${colors.line}" />
      <text x="${x + 78}" y="${y + 305}" font-family="Source Serif 4, Georgia, serif" font-size="28" font-weight="700" fill="${colors.ink}">Working thesis</text>
      <rect x="${x + 78}" y="${y + 334}" width="${w - 210}" height="12" rx="6" fill="${colors.rose}" opacity=".65" />
      <rect x="${x + 78}" y="${y + 364}" width="${w - 170}" height="12" rx="6" fill="${colors.blue}" opacity=".55" />
      <rect x="${x + 78}" y="${y + 394}" width="${w - 260}" height="12" rx="6" fill="${colors.green}" opacity=".55" />
    </g>
  `;
}

function defs() {
  return `
    <defs>
      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#2D2A26" flood-opacity=".12"/>
      </filter>
      <filter id="smallShadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#2D2A26" flood-opacity=".10"/>
      </filter>
    </defs>
  `;
}

function squareSocial() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  ${defs()}
  <rect width="1080" height="1080" fill="${colors.paper}" />
  <rect x="0" y="0" width="1080" height="220" fill="${colors.cream}" />
  <rect x="78" y="78" width="924" height="924" rx="46" fill="${colors.white}" stroke="${colors.line}" />
  <text x="120" y="150" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="800" fill="${colors.ink}">ScholarMark</text>
  <text x="120" y="205" font-family="Source Serif 4, Georgia, serif" font-size="80" font-weight="800" fill="${colors.ink}">Get ahead on</text>
  <text x="120" y="292" font-family="Source Serif 4, Georgia, serif" font-size="80" font-weight="800" fill="${colors.rose}">your thesis</text>
  <text x="120" y="362" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="600" fill="${colors.ink}">this summer</text>
  ${lines(
    [
      "Research question",
      "Working outline",
      "Sources + feedback",
    ],
    150,
    470,
    31,
    62,
    { weight: 700 },
  )}
  <circle cx="120" cy="459" r="13" fill="${colors.rose}" />
  <circle cx="120" cy="521" r="13" fill="${colors.blue}" />
  <circle cx="120" cy="583" r="13" fill="${colors.green}" />
  ${miniWindow(612, 420, 340, 420, "Paper plan")}
  <rect x="120" y="852" width="362" height="70" rx="35" fill="${colors.ink}" />
  <text x="154" y="897" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="25" font-weight="800" fill="${colors.white}">scholarmark.ai/summer</text>
  ${pill(520, 862, 280, "early access", colors.cream, colors.line)}
  <text x="120" y="958" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22" font-weight="600" fill="${colors.muted}">For rising juniors and seniors starting big papers next year.</text>
</svg>`;
}

function storyVisual() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  ${defs()}
  <rect width="1080" height="1920" fill="${colors.paper}" />
  <rect x="54" y="54" width="972" height="1812" rx="58" fill="${colors.white}" stroke="${colors.line}" />
  <text x="108" y="146" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="800" fill="${colors.ink}">ScholarMark</text>
  <text x="108" y="235" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="26" font-weight="800" fill="${colors.rose}">SUMMER THESIS HEAD START</text>
  <text x="108" y="338" font-family="Source Serif 4, Georgia, serif" font-size="92" font-weight="800" fill="${colors.ink}">Future you</text>
  <text x="108" y="438" font-family="Source Serif 4, Georgia, serif" font-size="92" font-weight="800" fill="${colors.ink}">wants an</text>
  <text x="108" y="538" font-family="Source Serif 4, Georgia, serif" font-size="92" font-weight="800" fill="${colors.blue}">outline.</text>
  ${miniWindow(120, 650, 840, 610, "Research workspace")}
  <rect x="120" y="1350" width="840" height="270" rx="34" fill="${colors.cream}" stroke="${colors.line}" />
  ${lines(
    [
      "1. Shape the question",
      "2. Map your sources",
      "3. Build the outline",
      "4. Get revision feedback",
    ],
    178,
    1418,
    35,
    54,
    { weight: 800 },
  )}
  <rect x="120" y="1692" width="472" height="76" rx="38" fill="${colors.ink}" />
  <text x="166" y="1741" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="800" fill="${colors.white}">scholarmark.ai/summer</text>
  <text x="120" y="1822" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="26" font-weight="600" fill="${colors.muted}">Planning and revision support. You stay the author.</text>
</svg>`;
}

function flyerLetter() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1275" height="1650" viewBox="0 0 1275 1650">
  ${defs()}
  <rect width="1275" height="1650" fill="${colors.paper}" />
  <rect x="72" y="72" width="1131" height="1506" rx="34" fill="${colors.white}" stroke="${colors.line}" />
  <text x="126" y="154" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="36" font-weight="800" fill="${colors.ink}">ScholarMark</text>
  <rect x="830" y="108" width="290" height="56" rx="28" fill="${colors.cream}" stroke="${colors.line}" />
  <text x="865" y="145" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22" font-weight="800" fill="${colors.rose}">EARLY STUDENT ACCESS</text>
  <text x="126" y="296" font-family="Source Serif 4, Georgia, serif" font-size="82" font-weight="800" fill="${colors.ink}">Get ahead on your</text>
  <text x="126" y="390" font-family="Source Serif 4, Georgia, serif" font-size="82" font-weight="800" fill="${colors.rose}">thesis, capstone,</text>
  <text x="126" y="484" font-family="Source Serif 4, Georgia, serif" font-size="82" font-weight="800" fill="${colors.ink}">or big research paper</text>
  <text x="126" y="560" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="600" fill="${colors.ink}">Use the summer to start before fall gets busy.</text>
  <g filter="url(#smallShadow)">
    <rect x="126" y="648" width="1023" height="300" rx="30" fill="${colors.cream}" stroke="${colors.line}" />
    <text x="176" y="718" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="31" font-weight="900" fill="${colors.ink}">In your first week, build:</text>
    ${lines(
      [
        "A focused research question",
        "A working outline",
        "A source plan",
        "Draft feedback and next steps",
      ],
      206,
      790,
      30,
      43,
      { weight: 700 },
    )}
    <circle cx="176" cy="779" r="11" fill="${colors.rose}" />
    <circle cx="176" cy="822" r="11" fill="${colors.blue}" />
    <circle cx="176" cy="865" r="11" fill="${colors.green}" />
    <circle cx="176" cy="908" r="11" fill="${colors.yellow}" />
  </g>
  <rect x="126" y="1018" width="487" height="260" rx="30" fill="${colors.white}" stroke="${colors.line}" />
  <text x="176" y="1084" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="30" font-weight="900" fill="${colors.ink}">Who it is for</text>
  ${lines(
    [
      "Rising juniors and seniors",
      "Honors and thesis students",
      "Capstone and seminar writers",
      "Pre-law and grad-school writers",
    ],
    176,
    1144,
    25,
    38,
    { weight: 600, fill: colors.muted },
  )}
  <rect x="662" y="1018" width="487" height="260" rx="30" fill="${colors.white}" stroke="${colors.line}" />
  <text x="712" y="1084" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="30" font-weight="900" fill="${colors.ink}">Integrity note</text>
  ${lines(
    [
      "ScholarMark helps you plan,",
      "revise, and organize your own",
      "work. It does not replace",
      "your authorship.",
    ],
    712,
    1144,
    25,
    38,
    { weight: 600, fill: colors.muted },
  )}
  <rect x="126" y="1360" width="570" height="86" rx="43" fill="${colors.ink}" />
  <text x="177" y="1416" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.white}">scholarmark.ai/summer</text>
  <text x="126" y="1510" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="25" font-weight="600" fill="${colors.muted}">Summer Thesis Head Start - planning, sources, outlining, revision.</text>
</svg>`;
}

function bannerVisual() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="500" viewBox="0 0 1600 500">
  ${defs()}
  <rect width="1600" height="500" fill="${colors.paper}" />
  <rect x="36" y="36" width="1528" height="428" rx="34" fill="${colors.white}" stroke="${colors.line}" />
  <text x="86" y="116" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <text x="86" y="206" font-family="Source Serif 4, Georgia, serif" font-size="76" font-weight="900" fill="${colors.ink}">Summer Thesis Head Start</text>
  <text x="86" y="278" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="31" font-weight="600" fill="${colors.muted}">Research question. Source plan. Outline. Feedback before fall.</text>
  ${pill(86, 338, 310, "early access", colors.cream, colors.line)}
  <rect x="430" y="338" width="430" height="54" rx="27" fill="${colors.ink}" />
  <text x="462" y="373" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22" font-weight="900" fill="${colors.white}">scholarmark.ai/summer</text>
  ${miniWindow(1075, 96, 350, 300, "Paper plan")}
  <rect x="950" y="108" width="66" height="250" rx="33" fill="${colors.rose}" opacity=".18" />
  <rect x="996" y="156" width="66" height="250" rx="33" fill="${colors.blue}" opacity=".18" />
</svg>`;
}

function linkedinPost() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="627" viewBox="0 0 1200 627">
  ${defs()}
  <rect width="1200" height="627" fill="${colors.paper}" />
  <rect x="48" y="48" width="1104" height="531" rx="34" fill="${colors.white}" stroke="${colors.line}" />
  <text x="94" y="122" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="30" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <text x="94" y="212" font-family="Source Serif 4, Georgia, serif" font-size="68" font-weight="900" fill="${colors.ink}">Do not start your</text>
  <text x="94" y="292" font-family="Source Serif 4, Georgia, serif" font-size="68" font-weight="900" fill="${colors.rose}">big paper from zero.</text>
  <text x="94" y="358" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="650" fill="${colors.muted}">For thesis, capstone, honors,</text>
  <text x="94" y="396" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="650" fill="${colors.muted}">and research-heavy writing.</text>
  <rect x="94" y="468" width="392" height="64" rx="32" fill="${colors.ink}" />
  <text x="134" y="510" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="24" font-weight="900" fill="${colors.white}">scholarmark.ai/summer</text>
  ${miniWindow(750, 122, 300, 340, "Outline")}
</svg>`;
}

function emailHeader() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">
  ${defs()}
  <rect width="1200" height="400" fill="${colors.paper}" />
  <rect x="38" y="38" width="1124" height="324" rx="30" fill="${colors.white}" stroke="${colors.line}" />
  <text x="86" y="110" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <text x="86" y="188" font-family="Source Serif 4, Georgia, serif" font-size="58" font-weight="900" fill="${colors.ink}">Summer Thesis Head Start</text>
  <text x="86" y="248" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="26" font-weight="650" fill="${colors.muted}">Plan the paper before the semester starts.</text>
  <rect x="86" y="296" width="312" height="48" rx="24" fill="${colors.ink}" />
  <text x="116" y="328" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="19" font-weight="900" fill="${colors.white}">scholarmark.ai/summer</text>
  <rect x="842" y="92" width="62" height="210" rx="31" fill="${colors.rose}" opacity=".22" />
  <rect x="900" y="126" width="62" height="210" rx="31" fill="${colors.blue}" opacity=".22" />
  <rect x="958" y="74" width="62" height="210" rx="31" fill="${colors.green}" opacity=".20" />
  <rect x="1016" y="152" width="62" height="160" rx="31" fill="${colors.yellow}" opacity=".24" />
</svg>`;
}

function newspaperAd() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  ${defs()}
  <rect width="1200" height="675" fill="${colors.paper}" />
  <rect x="48" y="48" width="1104" height="579" rx="20" fill="${colors.white}" stroke="${colors.line}" />
  <text x="92" y="118" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <text x="92" y="194" font-family="Source Serif 4, Georgia, serif" font-size="62" font-weight="900" fill="${colors.ink}">The easiest time to start</text>
  <text x="92" y="266" font-family="Source Serif 4, Georgia, serif" font-size="62" font-weight="900" fill="${colors.rose}">a thesis is before fall.</text>
  ${lines(
    [
      "Build a research question, outline, source plan,",
      "and first feedback loop this summer.",
      "Writing coaching for student-owned work.",
    ],
    92,
    344,
    28,
    42,
    { weight: 650, fill: colors.muted },
  )}
  <rect x="92" y="508" width="402" height="62" rx="31" fill="${colors.ink}" />
  <text x="128" y="548" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="23" font-weight="900" fill="${colors.white}">scholarmark.ai/summer</text>
  <rect x="760" y="132" width="286" height="388" rx="28" fill="${colors.cream}" stroke="${colors.line}" />
  ${lines(
    ["Question", "Sources", "Outline", "Revision"],
    814,
    222,
    33,
    72,
    { weight: 900 },
  )}
  <circle cx="790" cy="211" r="11" fill="${colors.rose}" />
  <circle cx="790" cy="283" r="11" fill="${colors.blue}" />
  <circle cx="790" cy="355" r="11" fill="${colors.green}" />
  <circle cx="790" cy="427" r="11" fill="${colors.yellow}" />
</svg>`;
}

function referralSquare() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  ${defs()}
  <rect width="1080" height="1080" fill="${colors.paper}" />
  <rect x="70" y="70" width="940" height="940" rx="46" fill="${colors.white}" stroke="${colors.line}" />
  <text x="124" y="152" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <text x="124" y="264" font-family="Source Serif 4, Georgia, serif" font-size="76" font-weight="900" fill="${colors.ink}">Know someone</text>
  <text x="124" y="350" font-family="Source Serif 4, Georgia, serif" font-size="76" font-weight="900" fill="${colors.ink}">with a huge</text>
  <text x="124" y="436" font-family="Source Serif 4, Georgia, serif" font-size="76" font-weight="900" fill="${colors.blue}">paper next year?</text>
  <rect x="124" y="530" width="832" height="238" rx="34" fill="${colors.cream}" stroke="${colors.line}" />
  ${lines(
    [
      "Send them Summer Thesis Head Start.",
      "They can plan their question, outline,",
      "sources, and revision path before fall.",
    ],
    174,
    604,
    32,
    50,
    { weight: 750 },
  )}
  <rect x="124" y="842" width="364" height="70" rx="35" fill="${colors.ink}" />
  <text x="160" y="887" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="25" font-weight="900" fill="${colors.white}">Copy referral link</text>
  <text x="124" y="958" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="23" font-weight="650" fill="${colors.muted}">Use your tracked invite link for attribution.</text>
</svg>`;
}

function compactAnnouncement() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900">
  ${defs()}
  <rect width="900" height="900" fill="${colors.paper}" />
  <rect x="54" y="54" width="792" height="792" rx="38" fill="${colors.white}" stroke="${colors.line}" />
  <text x="104" y="132" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <text x="104" y="238" font-family="Source Serif 4, Georgia, serif" font-size="68" font-weight="900" fill="${colors.ink}">Starting a big</text>
  <text x="104" y="314" font-family="Source Serif 4, Georgia, serif" font-size="68" font-weight="900" fill="${colors.rose}">paper next year?</text>
  <text x="104" y="412" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="31" font-weight="700" fill="${colors.ink}">Get your topic, outline,</text>
  <text x="104" y="456" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="31" font-weight="700" fill="${colors.ink}">sources, and feedback</text>
  <text x="104" y="500" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="31" font-weight="700" fill="${colors.ink}">started this summer.</text>
  <rect x="104" y="610" width="390" height="68" rx="34" fill="${colors.ink}" />
  <text x="142" y="654" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="24" font-weight="900" fill="${colors.white}">scholarmark.ai/summer</text>
  <text x="104" y="748" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22" font-weight="650" fill="${colors.muted}">Planning and revision support. You stay the author.</text>
</svg>`;
}

function sourceGroundedSquare() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  ${defs()}
  <rect width="1080" height="1080" fill="${colors.paper}" />
  <rect x="72" y="72" width="936" height="936" rx="46" fill="${colors.white}" stroke="${colors.line}" />
  <text x="126" y="152" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <text x="126" y="264" font-family="Source Serif 4, Georgia, serif" font-size="76" font-weight="900" fill="${colors.ink}">AI writing</text>
  <text x="126" y="350" font-family="Source Serif 4, Georgia, serif" font-size="76" font-weight="900" fill="${colors.rose}">with receipts.</text>
  <text x="126" y="426" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="30" font-weight="700" fill="${colors.muted}">Plan, revise, and cite from your own source base.</text>
  <rect x="126" y="520" width="828" height="288" rx="34" fill="${colors.cream}" stroke="${colors.line}" />
  ${lines(
    [
      "Source-grounded feedback",
      "Citation-aware drafting support",
      "Original-source verification reminders",
      "You stay responsible for the final work",
    ],
    178,
    600,
    31,
    50,
    { weight: 780 },
  )}
  <circle cx="148" cy="589" r="12" fill="${colors.rose}" />
  <circle cx="148" cy="639" r="12" fill="${colors.blue}" />
  <circle cx="148" cy="689" r="12" fill="${colors.green}" />
  <circle cx="148" cy="739" r="12" fill="${colors.yellow}" />
  <rect x="126" y="874" width="392" height="70" rx="35" fill="${colors.ink}" />
  <text x="162" y="919" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="25" font-weight="900" fill="${colors.white}">scholarmark.ai/summer</text>
  <text x="558" y="918" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22" font-weight="700" fill="${colors.muted}">Built for long academic projects.</text>
</svg>`;
}

function citationAwareStory() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  ${defs()}
  <rect width="1080" height="1920" fill="${colors.paper}" />
  <rect x="54" y="54" width="972" height="1812" rx="58" fill="${colors.white}" stroke="${colors.line}" />
  <text x="108" y="146" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <text x="108" y="246" font-family="Source Serif 4, Georgia, serif" font-size="92" font-weight="900" fill="${colors.ink}">Citations</text>
  <text x="108" y="346" font-family="Source Serif 4, Georgia, serif" font-size="92" font-weight="900" fill="${colors.rose}">should point</text>
  <text x="108" y="446" font-family="Source Serif 4, Georgia, serif" font-size="92" font-weight="900" fill="${colors.ink}">back to sources.</text>
  <rect x="108" y="570" width="864" height="620" rx="38" fill="${colors.cream}" stroke="${colors.line}" />
  <text x="162" y="650" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.ink}">Use your source base to:</text>
  ${lines(
    [
      "Map claims to evidence",
      "Check quotes against originals",
      "Flag citation gaps before drafting",
      "Keep revision grounded in what you read",
    ],
    204,
    742,
    34,
    68,
    { weight: 760 },
  )}
  <circle cx="164" cy="730" r="13" fill="${colors.rose}" />
  <circle cx="164" cy="798" r="13" fill="${colors.blue}" />
  <circle cx="164" cy="866" r="13" fill="${colors.green}" />
  <circle cx="164" cy="934" r="13" fill="${colors.yellow}" />
  <rect x="108" y="1290" width="864" height="214" rx="38" fill="${colors.white}" stroke="${colors.line}" />
  <text x="162" y="1368" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="32" font-weight="900" fill="${colors.ink}">Not a black box.</text>
  <text x="162" y="1420" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="29" font-weight="650" fill="${colors.muted}">Writing support that keeps you close</text>
  <text x="162" y="1464" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="29" font-weight="650" fill="${colors.muted}">to the evidence you actually added.</text>
  <rect x="108" y="1630" width="472" height="76" rx="38" fill="${colors.ink}" />
  <text x="154" y="1679" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="900" fill="${colors.white}">scholarmark.ai/summer</text>
  <text x="108" y="1775" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="25" font-weight="650" fill="${colors.muted}">Always verify final citations against original sources.</text>
</svg>`;
}

function sourceBaseBanner() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="500" viewBox="0 0 1600 500">
  ${defs()}
  <rect width="1600" height="500" fill="${colors.paper}" />
  <rect x="36" y="36" width="1528" height="428" rx="34" fill="${colors.white}" stroke="${colors.line}" />
  <text x="86" y="116" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <text x="86" y="206" font-family="Source Serif 4, Georgia, serif" font-size="72" font-weight="900" fill="${colors.ink}">Bring a larger source base</text>
  <text x="86" y="286" font-family="Source Serif 4, Georgia, serif" font-size="72" font-weight="900" fill="${colors.rose}">into your writing process.</text>
  <text x="86" y="354" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="650" fill="${colors.muted}">Organize evidence, citations, outlines, and revision notes in one workspace.</text>
  <rect x="86" y="400" width="420" height="54" rx="27" fill="${colors.ink}" />
  <text x="118" y="435" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22" font-weight="900" fill="${colors.white}">scholarmark.ai/summer</text>
  <rect x="1160" y="102" width="266" height="280" rx="28" fill="${colors.cream}" stroke="${colors.line}" />
  ${lines(["Sources", "Claims", "Citations", "Draft"], 1222, 174, 30, 55, { weight: 900 })}
  <circle cx="1190" cy="163" r="11" fill="${colors.rose}" />
  <circle cx="1190" cy="218" r="11" fill="${colors.blue}" />
  <circle cx="1190" cy="273" r="11" fill="${colors.green}" />
  <circle cx="1190" cy="328" r="11" fill="${colors.yellow}" />
</svg>`;
}

function verificationCard() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  ${defs()}
  <rect width="1080" height="1080" fill="${colors.paper}" />
  <rect x="72" y="72" width="936" height="936" rx="46" fill="${colors.white}" stroke="${colors.line}" />
  <text x="126" y="152" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <text x="126" y="272" font-family="Source Serif 4, Georgia, serif" font-size="76" font-weight="900" fill="${colors.ink}">Less guessing.</text>
  <text x="126" y="358" font-family="Source Serif 4, Georgia, serif" font-size="76" font-weight="900" fill="${colors.blue}">More source checks.</text>
  <text x="126" y="436" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="30" font-weight="700" fill="${colors.muted}">A research workspace for drafting from material you add.</text>
  <rect x="126" y="540" width="388" height="236" rx="32" fill="${colors.cream}" stroke="${colors.line}" />
  <text x="174" y="612" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="30" font-weight="900" fill="${colors.ink}">Before you write</text>
  ${lines(["Collect sources", "Mark evidence", "Build the outline"], 174, 674, 25, 40, { weight: 680, fill: colors.muted })}
  <rect x="566" y="540" width="388" height="236" rx="32" fill="${colors.cream}" stroke="${colors.line}" />
  <text x="614" y="612" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="30" font-weight="900" fill="${colors.ink}">Before you submit</text>
  ${lines(["Check citations", "Verify quotes", "Review claims"], 614, 674, 25, 40, { weight: 680, fill: colors.muted })}
  <rect x="126" y="866" width="392" height="70" rx="35" fill="${colors.ink}" />
  <text x="162" y="911" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="25" font-weight="900" fill="${colors.white}">scholarmark.ai/summer</text>
  <text x="126" y="968" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="21" font-weight="650" fill="${colors.muted}">AI can be wrong. ScholarMark keeps verification in the workflow.</text>
</svg>`;
}

function quoteContextSquare() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  ${defs()}
  <rect width="1080" height="1080" fill="${colors.paper}" />
  <rect x="72" y="72" width="936" height="936" rx="46" fill="${colors.white}" stroke="${colors.line}" />
  <text x="126" y="152" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <text x="126" y="262" font-family="Source Serif 4, Georgia, serif" font-size="76" font-weight="900" fill="${colors.ink}">Find the quote.</text>
  <text x="126" y="348" font-family="Source Serif 4, Georgia, serif" font-size="76" font-weight="900" fill="${colors.rose}">Keep the context.</text>
  <text x="126" y="426" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="30" font-weight="700" fill="${colors.muted}">Write from evidence you can trace back to your sources.</text>
  <rect x="126" y="520" width="828" height="266" rx="34" fill="${colors.cream}" stroke="${colors.line}" />
  <text x="176" y="590" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="27" font-weight="900" fill="${colors.ink}">Quote found in your source base</text>
  <rect x="176" y="626" width="630" height="16" rx="8" fill="${colors.rose}" opacity=".62" />
  <rect x="176" y="664" width="710" height="14" rx="7" fill="${colors.blue}" opacity=".40" />
  <rect x="176" y="696" width="560" height="14" rx="7" fill="${colors.green}" opacity=".42" />
  <text x="176" y="746" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22" font-weight="700" fill="${colors.muted}">Source details, page/section when available, and context stay attached.</text>
  <rect x="126" y="866" width="392" height="70" rx="35" fill="${colors.ink}" />
  <text x="162" y="911" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="25" font-weight="900" fill="${colors.white}">scholarmark.ai/summer</text>
  <text x="558" y="910" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="21" font-weight="700" fill="${colors.muted}">For thesis and capstone writing.</text>
</svg>`;
}

function largeSourceBaseSquare() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  ${defs()}
  <rect width="1080" height="1080" fill="${colors.paper}" />
  <rect x="72" y="72" width="936" height="936" rx="46" fill="${colors.white}" stroke="${colors.line}" />
  <text x="126" y="152" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <text x="126" y="270" font-family="Source Serif 4, Georgia, serif" font-size="76" font-weight="900" fill="${colors.ink}">Turn a large</text>
  <text x="126" y="356" font-family="Source Serif 4, Georgia, serif" font-size="76" font-weight="900" fill="${colors.blue}">source base</text>
  <text x="126" y="442" font-family="Source Serif 4, Georgia, serif" font-size="76" font-weight="900" fill="${colors.ink}">into usable evidence.</text>
  <rect x="126" y="540" width="252" height="218" rx="32" fill="${colors.cream}" stroke="${colors.line}" />
  <text x="178" y="632" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="54" font-weight="900" fill="${colors.rose}">many</text>
  <text x="178" y="684" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="25" font-weight="800" fill="${colors.ink}">sources</text>
  <rect x="414" y="540" width="252" height="218" rx="32" fill="${colors.cream}" stroke="${colors.line}" />
  <text x="466" y="632" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="54" font-weight="900" fill="${colors.blue}">quotes</text>
  <text x="466" y="684" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="25" font-weight="800" fill="${colors.ink}">with context</text>
  <rect x="702" y="540" width="252" height="218" rx="32" fill="${colors.cream}" stroke="${colors.line}" />
  <text x="754" y="632" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="54" font-weight="900" fill="${colors.green}">draft</text>
  <text x="754" y="684" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="25" font-weight="800" fill="${colors.ink}">from evidence</text>
  <rect x="126" y="862" width="392" height="70" rx="35" fill="${colors.ink}" />
  <text x="162" y="907" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="25" font-weight="900" fill="${colors.white}">scholarmark.ai/summer</text>
  <text x="126" y="968" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="21" font-weight="650" fill="${colors.muted}">Upload, clip, search, quote, cite, and revise in one workspace.</text>
</svg>`;
}

function quoteFinderBanner() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="500" viewBox="0 0 1600 500">
  ${defs()}
  <rect width="1600" height="500" fill="${colors.paper}" />
  <rect x="36" y="36" width="1528" height="428" rx="34" fill="${colors.white}" stroke="${colors.line}" />
  <text x="86" y="116" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <text x="86" y="206" font-family="Source Serif 4, Georgia, serif" font-size="72" font-weight="900" fill="${colors.ink}">The quote finder for</text>
  <text x="86" y="286" font-family="Source Serif 4, Georgia, serif" font-size="72" font-weight="900" fill="${colors.rose}">serious research writing.</text>
  <text x="86" y="342" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="24" font-weight="700" fill="${colors.muted}">Search a large source base for passages with context.</text>
  <text x="86" y="376" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="24" font-weight="700" fill="${colors.muted}">Draft from evidence students can verify.</text>
  <rect x="86" y="400" width="420" height="54" rx="27" fill="${colors.ink}" />
  <text x="118" y="435" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22" font-weight="900" fill="${colors.white}">scholarmark.ai/summer</text>
  <rect x="1090" y="100" width="360" height="288" rx="30" fill="${colors.cream}" stroke="${colors.line}" />
  <text x="1140" y="172" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="900" fill="${colors.ink}">Quote + context</text>
  <rect x="1140" y="214" width="250" height="14" rx="7" fill="${colors.rose}" opacity=".62" />
  <rect x="1140" y="252" width="210" height="12" rx="6" fill="${colors.blue}" opacity=".46" />
  <rect x="1140" y="284" width="270" height="12" rx="6" fill="${colors.green}" opacity=".45" />
  <text x="1140" y="342" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="20" font-weight="700" fill="${colors.muted}">source + surrounding context</text>
</svg>`;
}

function evidenceToParagraphStory() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  ${defs()}
  <rect width="1080" height="1920" fill="${colors.paper}" />
  <rect x="54" y="54" width="972" height="1812" rx="58" fill="${colors.white}" stroke="${colors.line}" />
  <text x="108" y="146" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <text x="108" y="250" font-family="Source Serif 4, Georgia, serif" font-size="90" font-weight="900" fill="${colors.ink}">From source</text>
  <text x="108" y="350" font-family="Source Serif 4, Georgia, serif" font-size="90" font-weight="900" fill="${colors.rose}">base to</text>
  <text x="108" y="450" font-family="Source Serif 4, Georgia, serif" font-size="90" font-weight="900" fill="${colors.ink}">paragraph.</text>
  <rect x="108" y="570" width="864" height="300" rx="38" fill="${colors.cream}" stroke="${colors.line}" />
  <text x="162" y="648" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.ink}">1. Find the passage</text>
  <rect x="162" y="700" width="650" height="16" rx="8" fill="${colors.rose}" opacity=".60" />
  <rect x="162" y="742" width="580" height="14" rx="7" fill="${colors.blue}" opacity=".45" />
  <rect x="108" y="930" width="864" height="300" rx="38" fill="${colors.cream}" stroke="${colors.line}" />
  <text x="162" y="1008" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.ink}">2. Keep the context</text>
  ${lines(["What came before", "What the author means", "Why it matters to your claim"], 204, 1084, 30, 54, { weight: 760 })}
  <circle cx="166" cy="1072" r="12" fill="${colors.rose}" />
  <circle cx="166" cy="1126" r="12" fill="${colors.blue}" />
  <circle cx="166" cy="1180" r="12" fill="${colors.green}" />
  <rect x="108" y="1290" width="864" height="250" rx="38" fill="${colors.white}" stroke="${colors.line}" />
  <text x="162" y="1368" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="900" fill="${colors.ink}">3. Draft with evidence</text>
  <text x="162" y="1430" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="29" font-weight="650" fill="${colors.muted}">Use quotes and notes from your library,</text>
  <text x="162" y="1474" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="29" font-weight="650" fill="${colors.muted}">then verify citations before submitting.</text>
  <rect x="108" y="1638" width="472" height="76" rx="38" fill="${colors.ink}" />
  <text x="154" y="1687" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="900" fill="${colors.white}">scholarmark.ai/summer</text>
  <text x="108" y="1784" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="25" font-weight="650" fill="${colors.muted}">Writing support for student-owned work.</text>
</svg>`;
}

function carouselSlide(title, accent, bullets, footer = "scholarmark.ai/summer") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  ${defs()}
  <rect width="1080" height="1080" fill="${colors.paper}" />
  <rect x="72" y="72" width="936" height="936" rx="46" fill="${colors.white}" stroke="${colors.line}" />
  <text x="126" y="154" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="32" font-weight="900" fill="${colors.ink}">ScholarMark</text>
  <rect x="126" y="210" width="120" height="12" rx="6" fill="${accent}" />
  ${lines(title, 126, 330, 76, 86, {
    weight: 900,
    family: "Source Serif 4, Georgia, serif",
    fill: colors.ink,
  })}
  <rect x="126" y="570" width="828" height="266" rx="34" fill="${colors.cream}" stroke="${colors.line}" />
  ${lines(bullets, 180, 650, 32, 58, { weight: 760 })}
  <circle cx="148" cy="638" r="12" fill="${accent}" />
  <circle cx="148" cy="696" r="12" fill="${colors.blue}" />
  <circle cx="148" cy="754" r="12" fill="${colors.green}" />
  <text x="126" y="926" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="26" font-weight="900" fill="${colors.ink}">${esc(footer)}</text>
</svg>`;
}

function previewHtml(files) {
  const cards = files
    .map(
      ({ title, svg }) => `
        <section class="card">
          <h2>${esc(title)}</h2>
          <img src="./${esc(svg)}" alt="${esc(title)}" />
        </section>
      `,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ScholarMark Summer Campaign Visuals</title>
  <style>
    :root {
      color: ${colors.ink};
      background: ${colors.paper};
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
      margin: 0;
      padding: 36px;
    }
    header {
      max-width: 1120px;
      margin: 0 auto 28px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 32px;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: ${colors.muted};
      font-size: 16px;
    }
    main {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 22px;
      max-width: 1120px;
      margin: 0 auto;
    }
    .card {
      background: ${colors.white};
      border: 1px solid ${colors.line};
      border-radius: 12px;
      padding: 18px;
      box-shadow: 0 18px 50px rgba(45,42,38,.08);
    }
    h2 {
      margin: 0 0 14px;
      font-size: 16px;
      letter-spacing: 0;
    }
    img {
      width: 100%;
      display: block;
      border: 1px solid ${colors.line};
      border-radius: 8px;
      background: ${colors.paper};
    }
  </style>
</head>
<body>
  <header>
    <h1>ScholarMark Summer Campaign Visuals</h1>
    <p>Editable SVG source files with PNG exports for quick posting and review.</p>
  </header>
  <main>
    ${cards}
  </main>
</body>
</html>`;
}

function manifestMarkdown(assets) {
  const rows = assets
    .map(
      (asset) =>
        `| ${asset.title} | ${asset.size} | \`${asset.base}.svg\` | \`${asset.base}.png\` | ${asset.use} |`,
    )
    .join("\n");

  return `# ScholarMark Summer Thesis Head Start Visual Assets

Generated by \`scripts/generate_summer_thesis_visuals.mjs\`.

## Asset Index

| Asset | Size | Editable source | PNG export | Best use |
|---|---:|---|---|---|
${rows}

## Creative Direction

- Premium academic workspace look.
- Warm ScholarMark palette from \`client/src/index.css\`.
- Soft macOS-style window motifs without changing the brand.
- Clear academic-integrity positioning: planning and revision support, not a
  replacement for student work.

## Recommended First Use

1. Use \`summer-thesis-email-header.png\` at the top of the first academic-office
   send.
2. Use \`summer-thesis-social-square.png\` and the three carousel slides for
   Instagram or LinkedIn.
3. Use \`summer-thesis-letter-flyer.png\` for campus posting or PDF handouts.
4. Use \`summer-thesis-referral-square.png\` after signup to drive referrals.
5. Use \`preview.html\` to inspect all editable SVG source files in one page.
6. Use \`phone-preview.png\` for quick mobile review.

## Notes

- The short link shown is \`scholarmark.ai/summer\`.
- If a QR code is needed, add it at export time using the final tracked link for
  each campus or channel.
- Keep rewarded ambassador posts disclosed with a line like: "I may receive free
  ScholarMark access if students join through my link."
`;
}

async function makePhonePreview(assets) {
  const width = 1080;
  const margin = 56;
  const cardWidth = width - margin * 2;
  const previewMaxWidth = 880;
  const previewMaxHeight = 590;
  const cardHeight = 720;
  const headerHeight = 170;
  const height = headerHeight + assets.length * cardHeight + margin;
  const composites = [];

  const headerSvg = `
    <svg width="${width}" height="${headerHeight}">
      <rect width="${width}" height="${headerHeight}" fill="${colors.paper}" />
      <text x="${margin}" y="70" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="42" font-weight="900" fill="${colors.ink}">ScholarMark visual pack</text>
      <text x="${margin}" y="118" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="24" font-weight="650" fill="${colors.muted}">Summer Thesis Head Start campaign assets</text>
    </svg>`;

  composites.push({ input: Buffer.from(headerSvg), top: 0, left: 0 });

  for (const [index, asset] of assets.entries()) {
    const top = headerHeight + index * cardHeight;
    const cardSvg = `
      <svg width="${width}" height="${cardHeight}">
        <rect x="${margin}" y="24" width="${cardWidth}" height="${cardHeight - 48}" rx="28" fill="${colors.white}" stroke="${colors.line}" />
        <text x="${margin + 34}" y="78" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="900" fill="${colors.ink}">${esc(asset.title)}</text>
        <text x="${margin + 34}" y="116" font-family="Libre Franklin, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="20" font-weight="650" fill="${colors.muted}">${esc(asset.size)} - ${esc(asset.use)}</text>
      </svg>`;
    composites.push({ input: Buffer.from(cardSvg), top, left: 0 });

    const imagePath = path.join(outDir, `${asset.base}.png`);
    const resized = await sharp(imagePath)
      .resize({ width: previewMaxWidth, height: previewMaxHeight, fit: "inside" })
      .png()
      .toBuffer();
    const metadata = await sharp(resized).metadata();
    composites.push({
      input: resized,
      top: top + 148 + Math.floor((previewMaxHeight - metadata.height) / 2),
      left: Math.floor((width - metadata.width) / 2),
    });
  }

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: colors.paper,
    },
  })
    .composite(composites)
    .png()
    .toFile(path.join(outDir, "phone-preview.png"));
}

const assets = [
  {
    title: "Find the quote, keep the context",
    base: "summer-thesis-quote-context",
    size: "1080x1080",
    use: "Primary social post for quote retrieval and context positioning",
    svg: quoteContextSquare(),
  },
  {
    title: "Large source base to usable evidence",
    base: "summer-thesis-large-source-base",
    size: "1080x1080",
    use: "Social post for large-library/source-base benefit",
    svg: largeSourceBaseSquare(),
  },
  {
    title: "Quote finder banner",
    base: "summer-thesis-quote-finder-banner",
    size: "1600x500",
    use: "Newsletter or web banner for quote-finder positioning",
    svg: quoteFinderBanner(),
  },
  {
    title: "Source base to paragraph story",
    base: "summer-thesis-evidence-to-paragraph-story",
    size: "1080x1920",
    use: "Story/Reel frame for quote-to-writing workflow",
    svg: evidenceToParagraphStory(),
  },
  {
    title: "Instagram square",
    base: "summer-thesis-social-square",
    size: "1080x1080",
    use: "Primary social post",
    svg: squareSocial(),
  },
  {
    title: "Story/Reel frame",
    base: "summer-thesis-story",
    size: "1080x1920",
    use: "Instagram story, Reel cover, TikTok story",
    svg: storyVisual(),
  },
  {
    title: "Letter flyer",
    base: "summer-thesis-letter-flyer",
    size: "1275x1650",
    use: "Printable letter flyer or PDF handout",
    svg: flyerLetter(),
  },
  {
    title: "Wide campus banner",
    base: "summer-thesis-campus-banner",
    size: "1600x500",
    use: "Campus newsletter banner or web header",
    svg: bannerVisual(),
  },
  {
    title: "LinkedIn post",
    base: "summer-thesis-linkedin-post",
    size: "1200x627",
    use: "LinkedIn, X card, department social",
    svg: linkedinPost(),
  },
  {
    title: "Email header",
    base: "summer-thesis-email-header",
    size: "1200x400",
    use: "Top image for email outreach",
    svg: emailHeader(),
  },
  {
    title: "Student newspaper ad",
    base: "summer-thesis-newspaper-ad",
    size: "1200x675",
    use: "Student newspaper, newsletter ad block",
    svg: newspaperAd(),
  },
  {
    title: "Referral square",
    base: "summer-thesis-referral-square",
    size: "1080x1080",
    use: "Referral ask after signup",
    svg: referralSquare(),
  },
  {
    title: "Compact announcement",
    base: "summer-thesis-compact-announcement",
    size: "900x900",
    use: "Group chat, Discord, campus resource post",
    svg: compactAnnouncement(),
  },
  {
    title: "Carousel slide 1",
    base: "summer-thesis-carousel-01-question",
    size: "1080x1080",
    use: "Carousel: research question",
    svg: carouselSlide(
      ["Start with", "the question."],
      colors.rose,
      ["Turn a rough topic", "into a researchable question", "before fall begins"],
    ),
  },
  {
    title: "Carousel slide 2",
    base: "summer-thesis-carousel-02-sources",
    size: "1080x1080",
    use: "Carousel: source planning",
    svg: carouselSlide(
      ["Make sources", "usable."],
      colors.blue,
      ["See what each source supports", "find evidence gaps", "plan what to read next"],
    ),
  },
  {
    title: "Carousel slide 3",
    base: "summer-thesis-carousel-03-outline",
    size: "1080x1080",
    use: "Carousel: outline and revision",
    svg: carouselSlide(
      ["Leave with", "an outline."],
      colors.green,
      ["Build the sections", "check argument flow", "get revision next steps"],
    ),
  },
  {
    title: "Source-grounded AI square",
    base: "summer-thesis-source-grounded-ai",
    size: "1080x1080",
    use: "Social post for citation/source-base messaging",
    svg: sourceGroundedSquare(),
  },
  {
    title: "Citation-aware story",
    base: "summer-thesis-citation-aware-story",
    size: "1080x1920",
    use: "Story/Reel frame for citation verification messaging",
    svg: citationAwareStory(),
  },
  {
    title: "Large source base banner",
    base: "summer-thesis-source-base-banner",
    size: "1600x500",
    use: "Newsletter/web banner for source-base positioning",
    svg: sourceBaseBanner(),
  },
  {
    title: "Verification workflow square",
    base: "summer-thesis-verification-workflow",
    size: "1080x1080",
    use: "Social post about checking quotes and citations",
    svg: verificationCard(),
  },
];

await mkdir(outDir, { recursive: true });
await mkdir(publicOutDir, { recursive: true });

for (const asset of assets) {
  const svgName = `${asset.base}.svg`;
  const pngName = `${asset.base}.png`;
  const svgPath = path.join(outDir, svgName);
  const pngPath = path.join(outDir, pngName);
  await writeFile(svgPath, asset.svg, "utf8");
  await sharp(Buffer.from(asset.svg)).png().toFile(pngPath);
}

await writeFile(
  path.join(outDir, "preview.html"),
  previewHtml(assets.map((asset) => ({ title: asset.title, svg: `${asset.base}.svg` }))),
  "utf8",
);

await writeFile(path.join(outDir, "README.md"), manifestMarkdown(assets), "utf8");
await makePhonePreview(assets);

for (const asset of assets) {
  await copyFile(path.join(outDir, `${asset.base}.svg`), path.join(publicOutDir, `${asset.base}.svg`));
  await copyFile(path.join(outDir, `${asset.base}.png`), path.join(publicOutDir, `${asset.base}.png`));
}
await copyFile(path.join(outDir, "README.md"), path.join(publicOutDir, "README.md"));
await copyFile(path.join(outDir, "preview.html"), path.join(publicOutDir, "preview.html"));
await copyFile(path.join(outDir, "phone-preview.png"), path.join(publicOutDir, "phone-preview.png"));

console.log(`Generated ${assets.length} SVG files, ${assets.length} PNG files, preview.html, README.md, and phone-preview.png in ${outDir}`);
console.log(`Mirrored campaign assets to ${publicOutDir}`);
