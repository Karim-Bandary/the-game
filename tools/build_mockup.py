"""
Generates app_mockup.html — the five tabs of the game, with the real starting
numbers from data/balance.json and the simulator's settled month-0 state.

Why generated: if the mockup showed different numbers from the balance
document, Karim would be reviewing two different games.
"""
import json, os, sys, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # repo root, whatever the cwd is
DATA = ROOT / "data"
DOCS = ROOT / "docs"

def wrap_page(title, body):
    """docs/ pages are standalone: GitHub Pages serves them with no wrapper."""
    head, rest = body.split("</style>", 1)
    return ('<!DOCTYPE html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            + head + "</style>\n</head>\n<body>\n" + rest + "\n</body>\n</html>\n")
sys.path.insert(0, str(ROOT / "tools"))
import sim

B = json.load(open(DATA / "balance.json", encoding="utf-8"))
sim.reset_reqs()
st = sim.State()

SV = ["water", "power", "sewage", "health", "edu", "police", "fire"]
GV = ["capital", "industrial", "agri", "south", "border"]
ICON = dict(water="💧", power="⚡", sewage="🚰", health="🏥", edu="🎓", police="👮", fire="🚒")

data = {
    "month": 1, "year": 1,
    "approval": round(st.approval), "stability": round(st.stability),
    "inflation": st.inflation, "ap": 6, "apMax": 6,
    "treasury": round(st.treasury), "personal": 0,
    "tax": st.tax, "util": st.util, "subsidy": round(st.subsidy),
    "services": [{
        "id": k, "icon": ICON[k], "nm": sim.SERVICES[k]["nm"],
        "ask": sim.BASE_REQ[k], "pct": round(st.pct[k]), "comp": round(st.comp[k]),
        "build": sim.SERVICES[k]["build"], "months": sim.SERVICES[k]["months"],
        "run": sim.SERVICES[k]["run"], "serves": sim.SERVICES[k]["cap"],
        "nat": round(st.national(k)),
        "gov": {g: {"cov": round(st.coverage(g, k)), "lvl": round(st.level[g][k]),
                    "fac": st.fac[g][k]} for g in GV},
    } for k in SV],
    "govs": [{"id": g, "nm": sim.GOVS[g]["nm"], "pop": sim.GOVS[g]["pop"],
              "appr": round(st.gov_appr[g])} for g in GV],
    "ministers": [
        {"nm": "رئيس الوزراء", "of": "الحكومة كلها", "loy": 71, "comp": 58, "party": "المحافظ"},
        {"nm": "وزير المالية", "of": "الضرايب والتحصيل", "loy": 64, "comp": 72, "party": "مستقل"},
        {"nm": "وزير الداخلية", "of": "الشرطة وقمع الشغب", "loy": 88, "comp": 41, "party": "المحافظ"},
        {"nm": "وزير الدفاع", "of": "الجيش والرشوة", "loy": 52, "comp": 69, "party": "القومي"},
        {"nm": "وزير المرافق", "of": "مياه وكهربا وصرف", "loy": 60, "comp": 63, "party": "مستقل"},
        {"nm": "وزير الصحة", "of": "الصحة والإسعاف", "loy": 45, "comp": 81, "party": "الحديث"},
        {"nm": "وزير التعليم", "of": "التعليم", "loy": 55, "comp": 66, "party": "الحديث"},
        {"nm": "وزير التموين", "of": "الغذاء والزراعة", "loy": 79, "comp": 38, "party": "المحافظ"},
        {"nm": "وزير الإعلام", "of": "الحملات والفضايح", "loy": 91, "comp": 47, "party": "المحافظ"},
    ],
    "bank": {"nm": "محافظ البنك المركزي", "indep": 78},
    "parties": [
        {"nm": "المحافظ", "power": 34, "stance": "معاك", "wants": "استقرار · ضرايب أقل"},
        {"nm": "الحديث", "power": 26, "stance": "محايد", "wants": "تعليم · بنك مستقل"},
        {"nm": "العمالي", "power": 22, "stance": "ضدك", "wants": "دعم · أسعار واطية"},
        {"nm": "القومي", "power": 18, "stance": "محايد", "wants": "جيش قوي · اكتفاء ذاتي"},
    ],
    "blocs": [
        {"nm": "المتدينين", "w": 24, "sat": 58, "cares": "الاستقرار الاجتماعي"},
        {"nm": "الشباب", "w": 28, "sat": 41, "cares": "تعليم · شغل"},
        {"nm": "العمال", "w": 26, "sat": 49, "cares": "سعر الغذاء · المرتبات"},
        {"nm": "رجال الأعمال", "w": 12, "sat": 66, "cares": "كهربا · تضخم واطي"},
        {"nm": "الجيش", "w": 10, "sat": 54, "cares": "ميزانيته · المحافظة الحدودية"},
    ],
    "actions": [
        {"ic": "💰", "nm": "اسرق من الخزينة", "ap": 2, "eff": "+رصيدك · +خطر الفضيحة"},
        {"ic": "🖨️", "nm": "اطبع فلوس", "ap": 2, "eff": "+خزينة فورًا · +تضخم"},
        {"ic": "🌾", "nm": "غيّر دعم الغذاء", "ap": 1, "eff": "−سعر الغذاء · −خزينة شهريًا"},
        {"ic": "📦", "nm": "استيراد طارئ", "ap": 1, "eff": "يسد العجز · −خزينة كبيرة"},
        {"ic": "🤝", "nm": "اشترِ ولاء وزير", "ap": 1, "eff": "+ولاء · −رصيدك"},
        {"ic": "🗡️", "nm": "اعزل وزير", "ap": 2, "eff": "وزير جديد · −ثبات"},
        {"ic": "🏛️", "nm": "أقِل الوزارة كلها", "ap": 3, "eff": "تمتص فضيحة · −ولاء الكل"},
        {"ic": "🏦", "nm": "غيّر محافظ البنك", "ap": 2, "eff": "تفتح باب الطباعة · −ثبات"},
        {"ic": "📺", "nm": "حملة إعلامية", "ap": 2, "eff": "+رضا مؤقت · −خزينة"},
        {"ic": "🎖️", "nm": "ادفع للجيش", "ap": 1, "eff": "+رضا الجيش · −خزينة"},
        {"ic": "📜", "nm": "تفاوض مع حزب", "ap": 2, "eff": "تحسّن موقفه مقابل تنازل"},
    ],
    "card": {
        "face": "🧔", "who": "محافظ الجنوب",
        "text": "سيادة الرئيس، طوابير العيش في الجنوب بتبدأ من الفجر. والناس بتقول إن المحافظة دي منسية.",
        "choices": [
            {"t": "زوّد الدعم فورًا", "e": "−٢٠م شهريًا · +رضا الجنوب"},
            {"t": "ابعت الشرطة تفض الطوابير", "e": "−٨ رضا الجنوب · +١ ثبات"},
            {"t": "اوعده بمشروع مياه", "e": "−٥٢٠م · ٦ شهور · وعد لازم توفي بيه"},
        ],
    },
}

HTML = """<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>شاشات اللعبة — مسوّدة</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#0d0f14;color:#e8e3d8;
     min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:14px 10px 30px}
.note{max-width:420px;text-align:center;color:#7d8697;font-size:12.5px;line-height:1.9;margin-bottom:12px}
.phone{width:100%;max-width:392px;height:800px;background:#0f1219;border:1px solid #2a3040;
       border-radius:30px;display:flex;flex-direction:column;overflow:hidden;
       box-shadow:0 24px 60px rgba(0,0,0,.6)}

/* top strip */
.top{padding:12px 13px 9px;border-bottom:1px solid #1e2431;background:#141922;flex:none}
.trow1{display:flex;justify-content:space-between;align-items:center;margin-bottom:9px}
.date{font-size:12px;color:#8b93a5}.date b{color:#e8c87a;font-size:14px}
.clock{display:flex;gap:4px;align-items:center}
.cbtn{background:#1a1f2b;border:1px solid #2a3040;color:#8b93a5;border-radius:7px;
      padding:4px 8px;font-size:11px;cursor:pointer;font-family:inherit}
.cbtn.on{background:#1e2a22;border-color:#2c4a38;color:#8ee0ab}
.meters{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
.mtr{text-align:center}
.mtr .lb{font-size:8.5px;color:#6f7891;display:block;margin-bottom:3px}
.mtr .vl{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;display:block;margin-bottom:3px}
.mtr .bar{height:3px;background:#0d1017;border-radius:2px;overflow:hidden}
.mtr .fl{height:100%;border-radius:2px}

/* body + tabs */
.view{flex:1;overflow-y:auto;padding:13px}
.nav{display:grid;grid-template-columns:repeat(5,1fr);border-top:1px solid #1e2431;
     background:#141922;flex:none}
.nav button{background:none;border:0;padding:9px 2px 11px;cursor:pointer;font-family:inherit;
            color:#5d667a;font-size:9px;display:flex;flex-direction:column;align-items:center;gap:4px}
.nav button i{font-style:normal;font-size:17px;opacity:.55}
.nav button.on{color:#e8c87a}.nav button.on i{opacity:1}

h4{font-size:10px;color:#6f7891;letter-spacing:.08em;margin:2px 0 9px;font-weight:500}
h4:not(:first-child){margin-top:20px}
.card{background:#141922;border:1px solid #232a38;border-radius:13px;padding:12px;margin-bottom:8px}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.nm{font-size:13.5px}.sub{font-size:10.5px;color:#6f7891;margin-top:2px}
.val{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.bar{height:4px;background:#0d1017;border-radius:3px;overflow:hidden;margin-top:6px}
.fl{height:100%;border-radius:3px}
.two{display:flex;gap:7px;margin-top:7px}.two>div{flex:1}
.lb{font-size:8.5px;color:#5d667a;display:block;margin-bottom:3px}
.pill{font-size:9.5px;padding:2px 7px;border-radius:20px;border:1px solid;white-space:nowrap}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.act{background:#141922;border:1px solid #232a38;border-radius:11px;padding:10px 9px;
     text-align:right;font-family:inherit;color:#e8e3d8;cursor:pointer;width:100%}
.act:active{background:#1c2331}
.act .ic{font-size:15px}.act .an{font-size:12px;margin-top:4px;display:block}
.act .ae{font-size:9px;color:#6f7891;margin-top:3px;display:block;line-height:1.6}
.act .ap{float:left;font-size:9.5px;color:#c9a24b}
.sit{background:linear-gradient(180deg,#1e2431,#171c26);border:1px solid #2e3648;
     border-radius:16px;padding:18px 14px;text-align:center;margin-bottom:9px}
.sit .face{width:60px;height:60px;border-radius:50%;margin:0 auto 10px;
     background:linear-gradient(145deg,#333c50,#232a38);border:2px solid #45506b;
     display:flex;align-items:center;justify-content:center;font-size:28px}
.sit .who{font-size:11px;color:#e8c87a;margin-bottom:9px}
.sit .tx{font-size:14px;line-height:1.9;color:#ddd8cc}
.ch{width:100%;background:#1a1f2b;border:1px solid #2a3040;border-radius:11px;padding:11px;
    text-align:right;font-family:inherit;color:#e8e3d8;font-size:13px;margin-bottom:6px;cursor:pointer}
.ch small{display:block;font-size:9.5px;color:#6f7891;margin-top:4px}
.slid{width:100%;margin-top:8px;accent-color:#c9a24b}
.tot{border-top:1px solid #232a38;margin-top:9px;padding-top:9px}
.secret{color:#7a6a4a;font-size:11.5px}
.gfilter{display:flex;gap:5px;overflow-x:auto;margin-bottom:10px;padding-bottom:3px}
.gf{background:#141922;border:1px solid #232a38;color:#7d8697;border-radius:20px;
    padding:5px 11px;font-size:11px;white-space:nowrap;cursor:pointer;font-family:inherit}
.gf.on{background:#1e2532;border-color:#3a4457;color:#e8c87a}
.q{background:#1d1712;border:1px solid #4a3a22;border-radius:10px;padding:9px 11px;
   font-size:10.5px;line-height:1.75;color:#c9a97a;margin-bottom:9px}
</style>
</head>
<body>
<div class="note">مسوّدة الشاشات الخمسة. دوس على التابات تحت، وعلى أي خدمة أو وزير.</div>
<div class="phone">
  <div class="top">
    <div class="trow1">
      <div class="date">🏛️ الشهر <b id="mn">١</b> · السنة <b id="yr">١</b></div>
      <div class="clock">
        <button class="cbtn" id="pp" onclick="tog()">⏸</button>
        <button class="cbtn on" onclick="spd(this,1)">×١</button>
        <button class="cbtn" onclick="spd(this,2)">×٢</button>
        <button class="cbtn" onclick="spd(this,3)">×٣</button>
      </div>
    </div>
    <div class="meters" id="meters"></div>
  </div>
  <div class="view" id="view"></div>
  <div class="nav" id="nav"></div>
</div>
<script>
var D = __DATA__;
var AR="٠١٢٣٤٥٦٧٨٩";
function ar(n){return String(Math.round(n)).replace(/\\d/g,function(d){return AR[+d]})}
function col(v){return v>=65?'#68d094':v>=45?'#e8c87a':'#e07575'}

// The four meters live outside the tabs on purpose: whatever screen you are on,
// you keep feeling the danger.
function meters(){
  var m=[['الرضا',D.approval,col(D.approval)],['الثبات',D.stability,col(D.stability)],
         ['التضخم',D.inflation,D.inflation>9?'#e07575':'#68d094'],
         ['الطاقة',D.ap/D.apMax*100,'#6fa8e0']];
  var lbl=[ar(D.approval),ar(D.stability),ar(D.inflation)+'٪',ar(D.ap)+'/'+ar(D.apMax)];
  document.getElementById('meters').innerHTML=m.map(function(x,i){
    return '<div class="mtr"><span class="lb">'+x[0]+'</span><span class="vl" style="color:'+x[2]+'">'
      +lbl[i]+'</span><div class="bar"><div class="fl" style="width:'+Math.min(100,x[1])+'%;background:'+x[2]+'"></div></div></div>'
  }).join('');
}

var TABS=[['pres','🏛️','الرئاسة'],['treas','💰','الخزينة'],['serv','🏗️','الخدمات'],
          ['govt','👔','الحكومة'],['pol','⚖️','السياسة']];
var tab='pres', gfilter='all';

function nav(){
  document.getElementById('nav').innerHTML=TABS.map(function(t){
    return '<button class="'+(tab===t[0]?'on':'')+'" onclick="go(\\''+t[0]+'\\')"><i>'+t[1]+'</i>'+t[2]+'</button>'
  }).join('');
}
function go(t){tab=t;nav();draw()}
function tog(){var b=document.getElementById('pp');b.textContent=b.textContent==='⏸'?'▶':'⏸';
  b.classList.toggle('on')}
function spd(el,n){var s=el.parentNode.querySelectorAll('.cbtn');
  for(var i=1;i<s.length;i++)s[i].classList.remove('on');el.classList.add('on')}

function bar(v,c){return '<div class="bar"><div class="fl" style="width:'+Math.min(100,v)+'%;background:'+(c||col(v))+'"></div></div>'}

function pres(){
  var c=D.card;
  var h='<h4>الموقف الحالي</h4><div class="sit"><div class="face">'+c.face+'</div>'
    +'<div class="who">'+c.who+'</div><div class="tx">'+c.text+'</div></div>';
  h+=c.choices.map(function(x){return '<button class="ch">'+x.t+'<small>'+x.e+'</small></button>'}).join('');
  h+='<h4>مكتب الرئاسة — طاقتك '+ar(D.ap)+' من '+ar(D.apMax)+'</h4><div class="grid2">';
  h+=D.actions.map(function(a){
    return '<button class="act"><span class="ap">'+ar(a.ap)+'⚡</span><span class="ic">'+a.ic+'</span>'
      +'<span class="an">'+a.nm+'</span><span class="ae">'+a.eff+'</span></button>'}).join('');
  return h+'</div>';
}

function treas(){
  var run=0;D.services.forEach(function(s){run+=s.ask*s.pct/100});
  var admin=180, sub=D.subsidy, imp=62;
  var inc=Math.round(D.tax*12*2.30*0.65+12*33*(D.services[1].nat/60)*0.65+12*22*(D.util/50));
  var exp=Math.round(run+admin+sub+imp);
  var h='<h4>الشهر ده</h4><div class="card">'
   +'<div class="row"><span class="nm">الخزينة</span><span class="val" style="color:#e8c87a">'+ar(D.treasury)+'م</span></div>'
   +'<div class="tot"></div>'
   +'<div class="row"><span class="nm">الدخل</span><span class="val" style="color:#68d094">+'+ar(inc)+'م</span></div>'
   +'<div class="row"><span class="sub">ضرايب · شركات · فواتير</span></div>'
   +'<div class="row" style="margin-top:8px"><span class="nm">المصروف</span><span class="val" style="color:#e07575">−'+ar(exp)+'م</span></div>'
   +'<div class="row"><span class="sub">تشغيل '+ar(run)+' · مرتبات '+ar(admin)+' · دعم '+ar(sub)+' · استيراد '+ar(imp)+'</span></div>'
   +'<div class="tot"><div class="row"><span class="nm">الصافي</span><span class="val" style="color:'
   +(inc-exp>=0?'#68d094':'#e07575')+'">'+(inc-exp>=0?'+':'−')+ar(Math.abs(inc-exp))+'م</span></div></div>'
   +'<div class="tot"><div class="row"><span class="secret">💼 رصيدك الشخصي</span><span class="secret">'+ar(D.personal)+'م</span></div></div>'
   +'</div>';
  h+='<h4>الروافع</h4>';
  h+='<div class="card"><div class="row"><span class="nm">ضريبة الدخل</span><span class="val">'+ar(D.tax)+'٪</span></div>'
    +'<div class="sub">كل ١٪ ≈ +١٨م شهريًا · −١٫٦ رضا</div>'
    +'<input class="slid" type="range" min="0" max="45" value="'+D.tax+'" oninput="D.tax=+this.value;draw()"></div>';
  h+='<div class="card"><div class="row"><span class="nm">سعر فواتير الخدمات</span><span class="val">'+ar(D.util)+'</span></div>'
    +'<div class="sub">بيتحس كل شهر في البيت — وجعه أقوى من الضريبة</div>'
    +'<input class="slid" type="range" min="0" max="100" value="'+D.util+'" oninput="D.util=+this.value;draw()"></div>';
  h+='<div class="card"><div class="row"><span class="nm">دعم الغذاء</span><span class="val">'+ar(D.subsidy)+'م</span></div>'
    +'<div class="sub">بيهدّي الشارع بسرعة — وشيله بعدين بيوجع أكتر من نفعه</div>'
    +'<input class="slid" type="range" min="0" max="220" value="'+D.subsidy+'" oninput="D.subsidy=+this.value;draw()"></div>';
  return h;
}

function serv(){
  var h='<div class="gfilter"><button class="gf '+(gfilter==='all'?'on':'')+'" onclick="gset(\\'all\\')">الدولة كلها</button>';
  h+=D.govs.map(function(g){return '<button class="gf '+(gfilter===g.id?'on':'')+'" onclick="gset(\\''+g.id+'\\')">'
    +g.nm+' '+ar(g.appr)+'</button>'}).join('')+'</div>';
  h+='<h4>الخدمات — التغطية × التشغيل</h4>';
  h+=D.services.map(function(s){
    var op=Math.round(s.pct*s.comp/100);
    var cov=gfilter==='all'?Math.round(s.nat/op*100):s.gov[gfilter].cov;
    var lvl=gfilter==='all'?s.nat:s.gov[gfilter].lvl;
    var fac=gfilter==='all'?'':' · '+ar(s.gov[gfilter].fac)+' منشأة';
    return '<div class="card"><div class="row"><span class="nm">'+s.icon+' '+s.nm
      +'<span class="sub">'+ar(s.ask*s.pct/100)+'م/شهر'+fac+'</span></span>'
      +'<span class="val" style="color:'+col(lvl)+'">'+ar(lvl)+'</span></div>'
      +'<div class="two"><div><span class="lb">التغطية '+ar(cov)+'٪</span>'+bar(cov,'#4a7fb5')+'</div>'
      +'<div><span class="lb">التشغيل '+ar(op)+'٪</span>'+bar(op,'#c9a24b')+'</div></div>'
      +'<div class="row" style="margin-top:9px"><span class="sub">التمويل '+ar(s.pct)+'٪ من طلب الوزارة</span>'
      +'<span class="sub">كفاءة الوزير '+ar(s.comp)+'</span></div>'
      +'<input class="slid" type="range" min="0" max="160" value="'+s.pct
      +'" oninput="setpct(\\''+s.id+'\\',+this.value)"></div>'
  }).join('');
  h+='<h4>تحت الإنشاء</h4><div class="card"><div class="row"><span class="nm">محطة مياه — الزراعية'
    +'<span class="sub">بعد ما تفتح: +٩م على المصروف الشهري للأبد</span></span>'
    +'<span class="val" style="color:#e8c87a">٥ شهور</span></div></div>';
  h+='<div class="q">⚠️ التمويل ١٠٠٪ مش معناه تشغيل ١٠٠٪. بكفاءة وزير ٦٥ لازم تموّل ١٥٤٪ — أو تجيب وزير أكفأ.</div>';
  return h;
}
function gset(g){gfilter=g;draw()}
function setpct(id,v){D.services.forEach(function(s){if(s.id===id)s.pct=v});draw()}

function govt(){
  var h='<h4>الحكومة</h4>';
  h+=D.ministers.map(function(m,i){
    return '<div class="card"><div class="row"><span class="nm">'+(i===0?'👑 ':'')+m.nm
      +'<span class="sub">'+m.of+' · '+m.party+'</span></span></div>'
      +'<div class="two"><div><span class="lb">الولاء '+ar(m.loy)+'</span>'+bar(m.loy,'#68d094')+'</div>'
      +'<div><span class="lb">الكفاءة '+ar(m.comp)+'</span>'+bar(m.comp,'#6fa8e0')+'</div></div></div>'
  }).join('');
  h+='<h4>البنك المركزي</h4><div class="card"><div class="row"><span class="nm">🏦 '+D.bank.nm
    +'<span class="sub">استقلاليته عالية — بيرفض يطبع لك</span></span>'
    +'<span class="val" style="color:#6fa8e0">'+ar(D.bank.indep)+'</span></div>'+bar(D.bank.indep,'#6fa8e0')+'</div>';
  h+='<div class="q">💡 الوزير الكفء غير الموالي بيصلّح الخدمات وبيسرّب فضايحك. والفاسد الموالي بيغطي عليك وبيبهدل الخدمات. مفيش وزير مثالي — عشان لو فيه، مفيش قرار.</div>';
  return h;
}

function pol(){
  var sc={'معاك':'#68d094','محايد':'#8b93a5','ضدك':'#e07575'};
  var h='<h4>الأحزاب — بتحاربك في السياسة</h4>';
  h+=D.parties.map(function(p){
    return '<div class="card"><div class="row"><span class="nm">'+p.nm+'<span class="sub">'+p.wants+'</span></span>'
      +'<span class="pill" style="color:'+sc[p.stance]+';border-color:'+sc[p.stance]+'">'+p.stance+'</span></div>'
      +'<span class="lb" style="margin-top:7px">النفوذ '+ar(p.power)+'٪</span>'+bar(p.power*2,'#a58bc9')+'</div>'
  }).join('');
  h+='<h4>الكتل الاجتماعية — بتحاربك في الشارع</h4>';
  h+=D.blocs.map(function(b){
    return '<div class="card"><div class="row"><span class="nm">'+b.nm+'<span class="sub">'+b.cares
      +' · '+ar(b.w)+'٪ من السكان</span></span><span class="val" style="color:'+col(b.sat)+'">'+ar(b.sat)+'</span></div>'
      +bar(b.sat)+'</div>'
  }).join('');
  h+='<div class="q">💡 الكتلة الغاضبة لوحدها بتتذمر بس. لكن لما حزب معارض قوي يلاقي كتلة غاضبة، بيتحالف معاها ويحوّل التذمر لمظاهرة.</div>';
  return h;
}

function draw(){
  meters();
  document.getElementById('view').innerHTML =
    tab==='pres'?pres():tab==='treas'?treas():tab==='serv'?serv():tab==='govt'?govt():pol();
}
nav();draw();
</script>
</body>
</html>"""

(DOCS / "app-mockup.html").write_text(
    HTML.replace("__DATA__", json.dumps(data, ensure_ascii=False)), encoding="utf-8")
print("docs/app-mockup.html written")
