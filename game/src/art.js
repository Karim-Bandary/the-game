/* ============================================================================
   Tab artwork — drawn in code, not photographed.

   Why SVG and not images: the game ships as one offline file, so every
   kilobyte of art is a kilobyte in the APK. These scenes cost almost nothing,
   stay sharp on any screen, and carry no licensing question. If real painted
   art replaces them later it drops into the same band with no other change.

   Each scene is a silhouette with one warm light source, so the five read as
   one place seen from five rooms. IDs are prefixed per scene because several
   of these end up in the same document.
   ========================================================================== */

var ART = {

  /* The office at night: the desk you decide from, and the lamp still on. */
  pres: '<svg viewBox="0 0 1200 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">'
    + '<defs>'
    + '<radialGradient id="pres-lamp" cx="50%" cy="50%" r="50%">'
    + '<stop offset="0%" stop-color="#e8c87a" stop-opacity=".55"/>'
    + '<stop offset="100%" stop-color="#e8c87a" stop-opacity="0"/></radialGradient>'
    + '<linearGradient id="pres-win" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="#26324a"/><stop offset="100%" stop-color="#141c2c"/></linearGradient>'
    + '</defs>'
    + '<rect x="0" y="0" width="1200" height="400" fill="#10141c"/>'
    + '<rect x="360" y="30" width="480" height="250" rx="4" fill="url(#pres-win)" stroke="#2a3547" stroke-width="3"/>'
    + '<path d="M600,30 L600,280 M360,155 L840,155" stroke="#2a3547" stroke-width="3"/>'
    + '<circle cx="470" cy="90" r="3" fill="#8fa3c4" opacity=".7"/>'
    + '<circle cx="700" cy="70" r="2" fill="#8fa3c4" opacity=".5"/>'
    + '<circle cx="760" cy="120" r="2" fill="#8fa3c4" opacity=".45"/>'
    + '<rect x="150" y="240" width="120" height="140" fill="#161d2b"/>'
    + '<rect x="930" y="240" width="120" height="140" fill="#161d2b"/>'
    + '<circle cx="790" cy="268" r="95" fill="url(#pres-lamp)"/>'
    + '<rect x="520" y="215" width="120" height="90" rx="14" fill="#131924"/>'
    + '<rect x="240" y="300" width="720" height="22" rx="3" fill="#0d1017"/>'
    + '<rect x="268" y="322" width="16" height="58" fill="#0d1017"/>'
    + '<rect x="916" y="322" width="16" height="58" fill="#0d1017"/>'
    + '<rect x="620" y="286" width="86" height="14" rx="2" fill="#1d2534"/>'
    + '<rect x="636" y="278" width="70" height="10" rx="2" fill="#222b3c"/>'
    + '<rect x="782" y="262" width="12" height="38" fill="#1d2534"/>'
    + '<path d="M760,262 L816,262 L800,236 L776,236 Z" fill="#2a3446"/>'
    + '<rect x="0" y="0" width="1200" height="400" fill="url(#fade-down)"/>'
    + '</svg>',

  /* The vault: mostly empty shelves, and a door that takes two people to open. */
  treas: '<svg viewBox="0 0 1200 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">'
    + '<defs><linearGradient id="treas-shaft" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="#e8c87a" stop-opacity=".22"/>'
    + '<stop offset="100%" stop-color="#e8c87a" stop-opacity="0"/></linearGradient></defs>'
    + '<rect x="0" y="0" width="1200" height="400" fill="#10141c"/>'
    + '<path d="M520,0 L700,0 L800,400 L400,400 Z" fill="url(#treas-shaft)"/>'
    + '<rect x="60" y="120" width="230" height="12" fill="#1a2130"/>'
    + '<rect x="60" y="230" width="230" height="12" fill="#1a2130"/>'
    + '<rect x="60" y="340" width="230" height="12" fill="#1a2130"/>'
    + '<rect x="86" y="78" width="52" height="42" fill="#161d2b"/>'
    + '<rect x="152" y="92" width="40" height="28" fill="#141a26"/>'
    + '<rect x="86" y="196" width="46" height="34" fill="#161d2b"/>'
    + '<rect x="910" y="120" width="230" height="12" fill="#1a2130"/>'
    + '<rect x="910" y="230" width="230" height="12" fill="#1a2130"/>'
    + '<rect x="910" y="340" width="230" height="12" fill="#1a2130"/>'
    + '<rect x="1042" y="82" width="54" height="38" fill="#161d2b"/>'
    + '<circle cx="600" cy="215" r="148" fill="#141a26" stroke="#28313f" stroke-width="10"/>'
    + '<circle cx="600" cy="215" r="112" fill="none" stroke="#222b38" stroke-width="6"/>'
    + '<circle cx="600" cy="215" r="74" fill="none" stroke="#1d2532" stroke-width="4"/>'
    + '<path d="M600,141 L600,289 M526,215 L674,215 M548,163 L652,267 M652,163 L548,267" stroke="#242d3b" stroke-width="6"/>'
    + '<circle cx="600" cy="215" r="30" fill="#1a2130" stroke="#8a6f32" stroke-width="4"/>'
    + '<circle cx="600" cy="215" r="9" fill="#e8c87a" opacity=".65"/>'
    + '<rect x="0" y="0" width="1200" height="400" fill="url(#fade-down)"/>'
    + '</svg>',

  /* The city you are responsible for: half built, half neglected. */
  serv: '<svg viewBox="0 0 1200 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">'
    + '<rect x="0" y="0" width="1200" height="400" fill="#10141c"/>'
    + '<circle cx="960" cy="110" r="52" fill="#e8c87a" opacity=".13"/>'
    + '<rect x="40" y="250" width="90" height="150" fill="#161d2b"/>'
    + '<rect x="140" y="200" width="70" height="200" fill="#131a26"/>'
    + '<rect x="220" y="280" width="110" height="120" fill="#171e2c"/>'
    + '<rect x="700" y="230" width="80" height="170" fill="#131a26"/>'
    + '<rect x="790" y="290" width="120" height="110" fill="#161d2b"/>'
    + '<rect x="1080" y="240" width="90" height="160" fill="#141b28"/>'
    + '<rect x="158" y="222" width="12" height="16" fill="#e8c87a" opacity=".5"/>'
    + '<rect x="182" y="266" width="12" height="16" fill="#e8c87a" opacity=".28"/>'
    + '<rect x="716" y="252" width="12" height="16" fill="#e8c87a" opacity=".42"/>'
    + '<rect x="1100" y="268" width="12" height="16" fill="#e8c87a" opacity=".3"/>'
    + '<ellipse cx="420" cy="176" rx="76" ry="34" fill="#1b2331"/>'
    + '<rect x="344" y="176" width="152" height="26" fill="#1b2331"/>'
    + '<path d="M362,202 L392,400 M478,202 L448,400 M420,202 L420,400" stroke="#151c28" stroke-width="9"/>'
    + '<path d="M568,400 L600,120 L632,400 M578,320 L622,320 M586,250 L614,250" stroke="#222b3a" stroke-width="7" fill="none"/>'
    + '<path d="M600,150 L360,196 M600,150 L900,180" stroke="#1d2634" stroke-width="3"/>'
    + '<path d="M980,400 L980,150 L1120,150" stroke="#2a3446" stroke-width="8" fill="none"/>'
    + '<path d="M1096,150 L1096,206" stroke="#2a3446" stroke-width="4"/>'
    + '<rect x="1074" y="206" width="44" height="30" fill="#222b3a"/>'
    + '<rect x="0" y="0" width="1200" height="400" fill="url(#fade-down)"/>'
    + '</svg>',

  /* The cabinet room: a long table, and everyone waiting for you to speak. */
  govt: '<svg viewBox="0 0 1200 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">'
    + '<defs><linearGradient id="govt-door" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="#1b2231"/><stop offset="100%" stop-color="#141a26"/></linearGradient></defs>'
    + '<rect x="0" y="0" width="1200" height="400" fill="#10141c"/>'
    + '<rect x="0" y="250" width="1200" height="150" fill="#0e1219"/>'
    + '<rect x="500" y="60" width="200" height="196" rx="3" fill="url(#govt-door)" stroke="#28313f" stroke-width="4"/>'
    + '<path d="M600,60 L600,256" stroke="#28313f" stroke-width="4"/>'
    + '<rect x="504" y="244" width="192" height="12" fill="#e8c87a" opacity=".3"/>'
    + '<circle cx="576" cy="164" r="5" fill="#8a6f32"/>'
    + '<circle cx="624" cy="164" r="5" fill="#8a6f32"/>'
    + '<path d="M470,400 L545,232 L655,232 L730,400 Z" fill="#212b3d" stroke="#33415a" stroke-width="3"/>'
    + '<rect x="330" y="286" width="72" height="58" rx="10" fill="#1e2635"/>'
    + '<rect x="250" y="320" width="80" height="64" rx="11" fill="#1a2130"/>'
    + '<rect x="420" y="252" width="60" height="48" rx="9" fill="#222b3c"/>'
    + '<rect x="798" y="286" width="72" height="58" rx="10" fill="#1e2635"/>'
    + '<rect x="870" y="320" width="80" height="64" rx="11" fill="#1a2130"/>'
    + '<rect x="720" y="252" width="60" height="48" rx="9" fill="#222b3c"/>'
    + '<rect x="560" y="196" width="80" height="40" rx="8" fill="#1b2331"/>'
    + '<rect x="512" y="300" width="60" height="9" rx="2" fill="#1f2837"/>'
    + '<rect x="628" y="300" width="60" height="9" rx="2" fill="#1f2837"/>'
    + '<rect x="0" y="0" width="1200" height="400" fill="url(#fade-down)"/>'
    + '</svg>',

  /* The chamber: empty benches are louder than full ones. */
  pol: '<svg viewBox="0 0 1200 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">'
    + '<rect x="0" y="0" width="1200" height="400" fill="#10141c"/>'
    + '<rect x="230" y="0" width="90" height="180" fill="#26304a"/>'
    + '<path d="M230,180 L275,206 L320,180 Z" fill="#26304a"/>'
    + '<rect x="880" y="0" width="90" height="180" fill="#222b40"/>'
    + '<path d="M880,180 L925,206 L970,180 Z" fill="#222b40"/>'
    + '<rect x="556" y="0" width="88" height="150" fill="#2d3854"/>'
    + '<path d="M556,150 L600,176 L644,150 Z" fill="#2d3854"/>'
    + '<path d="M120,400 Q600,300 1080,400" fill="none" stroke="#263145" stroke-width="26"/>'
    + '<path d="M60,400 Q600,268 1140,400" fill="none" stroke="#202939" stroke-width="24"/>'
    + '<path d="M10,400 Q600,236 1190,400" fill="none" stroke="#1a2230" stroke-width="22"/>'
    + '<rect x="540" y="286" width="120" height="70" rx="6" fill="#1d2533" stroke="#2a3446" stroke-width="3"/>'
    + '<rect x="566" y="262" width="68" height="26" rx="4" fill="#222b3a"/>'
    + '<circle cx="600" cy="248" r="34" fill="#e8c87a" opacity=".12"/>'
    + '<rect x="0" y="0" width="1200" height="400" fill="url(#fade-down)"/>'
    + '</svg>'
};

/* One shared fade so the art dissolves into the panel instead of ending at a
   hard edge — and so the tab title stays readable on top of it. */
var ART_DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>'
  + '<linearGradient id="fade-down" x1="0" y1="0" x2="0" y2="1">'
  + '<stop offset="0%" stop-color="#0d0f14" stop-opacity=".10"/>'
  + '<stop offset="52%" stop-color="#0d0f14" stop-opacity=".26"/>'
  + '<stop offset="80%" stop-color="#0d0f14" stop-opacity=".58"/>'
  + '<stop offset="100%" stop-color="#0d0f14" stop-opacity=".94"/>'
  + '</linearGradient></defs></svg>';
