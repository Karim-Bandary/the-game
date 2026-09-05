"""
Generates setup_mockup.html — the new-game flow (name → government → society → start).

Why generated from data/balance.json: the summary screen shows the ACTUAL starting
numbers each choice produces. If it invented them, Karim would be reviewing a
promise instead of the game.
"""
import json

B = json.load(open("data/balance.json", encoding="utf-8"))
st = B["start"]

BASE = {
    "approval": 52, "stability": 68, "treasury": st["treasury"], "ap": 6,
    "inflation": st["inflation"], "competence": st["minister_competence"], "loyalty": 65,
}

# Every modifier is a number or a rule flag — never a separate content tree.
# That is what makes these choices cheap to build and expensive to feel.
GOVS = [
    {"id": "monarchy", "ic": "👑", "nm": "ملكي", "tag": "الشرعية موروثة",
     "desc": "إنت ملك. الناس مش لازم تحبك عشان تفضل في الكرسي — بس تغيير أي حاجة صعب.",
     "mods": {"stability": +12, "ap": -1},
     "good": ["ثبات سياسي بيبدأ أعلى بـ١٢", "الغليان بيتراكم أبطأ ١٥٪", "العزل محتاج أزمة أكبر بكتير"],
     "bad": ["طاقة قرارات أقل (٥) — البلاط والتقاليد بيقيدوك",
             "الشباب والحزب الحديث بيبدأوا غاضبين", "عزل أي وزير بيكلف ثبات ×١٫٥"],
     "feel": "لعبة بطيئة ومستقرة. بتعيش طويل، بس بتتحرك ببطء."},

    {"id": "republic", "ic": "🗳️", "nm": "جمهوري", "tag": "شرعيتك من الصندوق",
     "desc": "دولة بمؤسسات. الجهاز بيشتغل أحسن — بس فيه انتخابات كل ٤ سنين، والرضا وقتها هو كل حاجة.",
     "mods": {"competence": +8},
     "good": ["كفاءة الوزرا +٨ — التعيين مؤسسي مش مزاجي", "دخل الضرايب +٨٪ (جهاز تحصيل منظم)",
              "الفضيحة الواحدة مش بتوديك — المؤسسات بتمتص"],
     "bad": ["🗳️ انتخابات كل ٤ سنين — رضاك تحت ٤٠ يوم الانتخابات = خرجت",
             "نفوذ الأحزاب +١٥٪", "الإعلام أحر → الفضايح بتنتشر أسرع"],
     "feel": "لعبة بإيقاع. أربع سنين شغل، وامتحان."},

    {"id": "dictator", "ic": "🎖️", "nm": "ديكتاتوري", "tag": "شرعيتك من الجيش",
     "desc": "كل السلطة في إيدك. الأحزاب ضعيفة والإعلام مقموع — والجيش هو الحاجة الوحيدة اللي بتخاف منها.",
     "mods": {"ap": +2, "approval": -10},
     "good": ["طاقة قرارات ٨ — تعمل اللي إنت عايزه", "القمع بينجح أكتر ٣٠٪",
              "نفوذ الأحزاب −٤٠٪", "احتمال الفضيحة ×٠٫٦ — الإعلام مقفول"],
     "bad": ["الرضا بيبدأ −١٠ وبينزل لوحده كل شهر", "دخل الشركات −١٥٪ — مفيش استثمار",
             "⚠️ لو رضا الجيش نزل تحت ٣٠ → انقلاب فوري ونهاية تالتة"],
     "feel": "لعبة قوة وخوف. بتقدر على كل حاجة إلا حاجة واحدة."},
]

SOCIETIES = [
    {"id": "conservative", "ic": "🕌", "nm": "مجتمع محافظ", "tag": "بطيء ومستقر",
     "desc": "مجتمع متماسك بيقدّر الاستقرار. بيسامحك كتير — لو ما حاولتش تغيّره.",
     "mods": {"stability": +8},
     "good": ["ثبات +٨", "الغليان بيتراكم أبطأ ١٥٪", "كتلة المتدينين أكبر — ولو راضية بتهدّي الباقي"],
     "bad": ["كل إصلاح كبير بيكلف ضعف الرضا", "التعليم أثره على الاقتصاد أقل ٢٠٪"]},

    {"id": "open", "ic": "🏙️", "nm": "مجتمع مدني منفتح", "tag": "بينمو وبيراقب",
     "desc": "مجتمع متعلم وبيتحرك بسرعة. بيبني لك اقتصاد قوي — وبيمسك عليك كل غلطة.",
     "mods": {"competence": +6},
     "good": ["التعليم أثره +٣٠٪ على الدخل طويل المدى", "دخل الشركات +١٢٪", "كفاءة الوزرا +٦"],
     "bad": ["الفضيحة بتنتشر ×١٫٥ — الإعلام حر", "كتلة الشباب أكبر وبتنزل الشارع أسرع"]},

    {"id": "tribal", "ic": "🪶", "nm": "مجتمع قبلي عشائري", "tag": "ولاء بدل كفاءة",
     "desc": "الولاء هنا أهم من الشهادة. رجالتك مخلصين لك — ومش شاطرين.",
     "mods": {"loyalty": +15, "competence": -12},
     "good": ["ولاء الوزرا بيبدأ +١٥", "رشوة الجيش أرخص ٣٠٪", "المحافظات البعيدة أهدى"],
     "bad": ["كفاءة الوزرا −١٢ — محسوبية", "لو بنيت في محافظة كتير، الباقيين بيغاروا ورضاهم ينزل"]},

    {"id": "divided", "ic": "⚡", "nm": "مجتمع منقسم", "tag": "صعب — للمرة التانية",
     "desc": "مجتمع مشقوق لنصين. خصومك مش متفقين على حاجة — ولا شعبك كمان.",
     "mods": {"approval": -6},
     "good": ["الأحزاب مش بتتحد ضدك", "تقدر تلعب طرف ضد طرف — التفاوض أرخص"],
     "bad": ["كل أزمة بتكبر ×١٫٤", "الرضا بيبدأ −٦ والغليان بيتراكم أسرع"]},
]

COUNTRY_NAMES = ["جمهورية النهر", "دولة السواحل", "بلاد الرمال", "اتحاد الوديان",
                 "مملكة الشمال", "دولة المرتفعات", "بلاد النخيل"]
RULER_NAMES = ["كريم عبد الحكم", "سليم الفارس", "عادل بن راشد", "نور الدين حلمي",
               "طارق العامري", "مراد الشريف"]

HTML = """<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>بداية اللعبة — مسوّدة</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#0d0f14;color:#e8e3d8;
     min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:14px 10px 30px}
.note{max-width:420px;text-align:center;color:#7d8697;font-size:12.5px;line-height:1.9;margin-bottom:12px}
.phone{width:100%;max-width:392px;height:790px;background:#0f1219;border:1px solid #2a3040;
       border-radius:30px;display:flex;flex-direction:column;overflow:hidden;
       box-shadow:0 24px 60px rgba(0,0,0,.6)}
.steps{display:flex;gap:5px;padding:16px 16px 12px;flex:none}
.sp{flex:1;height:3px;background:#1e2431;border-radius:2px}
.sp.on{background:#c9a24b}.sp.done{background:#3d6b52}
.view{flex:1;overflow-y:auto;padding:6px 16px 16px}
.foot{padding:12px 16px 16px;flex:none;border-top:1px solid #1a1f2b;display:flex;gap:8px}
.btn{flex:1;padding:14px;border-radius:14px;border:1px solid #2c4a38;background:#182620;
     color:#8ee0ab;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer}
.btn:disabled{opacity:.35;cursor:default}
.btn.ghost{flex:0 0 92px;background:#141922;border-color:#2a3040;color:#7d8697;font-weight:400;font-size:13px}
.btn:active:not(:disabled){transform:scale(.98)}

.eyebrow{font-size:10px;color:#6f7891;letter-spacing:.12em;margin-bottom:6px}
h1{font-size:21px;font-weight:700;line-height:1.5;margin-bottom:6px}
.lede{font-size:12.5px;color:#7d8697;line-height:1.85;margin-bottom:18px}

.field{margin-bottom:16px}
.field label{display:block;font-size:11px;color:#8b93a5;margin-bottom:7px}
.field .wrap{display:flex;gap:7px}
input{flex:1;background:#141922;border:1px solid #2a3040;border-radius:12px;padding:13px;
      color:#e8e3d8;font-family:inherit;font-size:15px;text-align:right}
input:focus{outline:none;border-color:#c9a24b}
.dice{flex:0 0 46px;background:#141922;border:1px solid #2a3040;border-radius:12px;
      color:#c9a24b;font-size:17px;cursor:pointer}

.opt{width:100%;text-align:right;background:#141922;border:1px solid #232a38;border-radius:15px;
     padding:14px;margin-bottom:9px;font-family:inherit;color:#e8e3d8;cursor:pointer;
     transition:border-color .15s,background .15s}
.opt.sel{border-color:#c9a24b;background:#191f29}
.opt .hd{display:flex;align-items:center;gap:9px;margin-bottom:3px}
.opt .ic{font-size:20px}
.opt .nm{font-size:15.5px;font-weight:700;flex:1}
.opt .tag{font-size:9.5px;color:#6f7891;border:1px solid #2a3040;border-radius:20px;padding:2px 8px}
.opt.sel .tag{color:#c9a24b;border-color:#4a3f22}
.opt .ds{font-size:11.5px;color:#8b93a5;line-height:1.85;margin:6px 0 0}
.detail{max-height:0;overflow:hidden;transition:max-height .28s ease}
.opt.sel .detail{max-height:340px}
.lst{margin-top:11px;padding-top:10px;border-top:1px solid #232a38}
.li{font-size:11.5px;line-height:1.8;display:flex;gap:7px;margin-bottom:5px}
.li b{flex:none;font-weight:400}
.good b{color:#68d094}.bad b{color:#e07575}
.feel{font-size:11px;color:#c9a24b;margin-top:10px;font-style:italic}

.sum{background:#141922;border:1px solid #232a38;border-radius:15px;padding:14px;margin-bottom:9px}
.srow{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;font-size:13px}
.srow .v{font-variant-numeric:tabular-nums;font-weight:700}
.srow .d{font-size:10.5px;margin-right:6px}
.up{color:#68d094}.dn{color:#e07575}
.flag{background:#1d1712;border:1px solid #4a3a22;border-radius:11px;padding:10px 12px;
      font-size:11.5px;line-height:1.8;color:#c9a97a;margin-bottom:8px}
.title{background:linear-gradient(180deg,#1e2431,#171c26);border:1px solid #2e3648;border-radius:16px;
       padding:18px 14px;text-align:center;margin-bottom:12px}
.title .cn{font-size:19px;font-weight:700;margin-bottom:4px}
.title .rn{font-size:12px;color:#e8c87a}
</style>
</head>
<body>
<div class="note">مسوّدة شاشات بداية اللعبة. اكتب اسم واختار، وشوف الملخص في الآخر بيتغير.</div>
<div class="phone">
  <div class="steps" id="steps"></div>
  <div class="view" id="view"></div>
  <div class="foot" id="foot"></div>
</div>
<script>
var GOVS=__GOVS__, SOCS=__SOCS__, BASE=__BASE__;
var CN=__CN__, RN=__RN__;
var AR="٠١٢٣٤٥٦٧٨٩";
function ar(n){return String(Math.round(n)).replace(/\\d/g,function(d){return AR[+d]})}

var S={step:0, country:"", ruler:"", gov:null, soc:null};

// The starting state is the base numbers plus whatever the two choices modify.
// Showing it before the game starts is the whole point of the screen: the
// player should feel the trade-off before living with it for 20 years.
function computed(){
  var o={};
  for(var k in BASE) o[k]=BASE[k];
  var d={};
  [S.gov,S.soc].forEach(function(c){
    if(!c) return;
    for(var k in c.mods){ o[k]+=c.mods[k]; d[k]=(d[k]||0)+c.mods[k]; }
  });
  return {v:o,d:d};
}

function steps(){
  var h="";
  for(var i=0;i<4;i++) h+='<div class="sp '+(i<S.step?'done':i===S.step?'on':'')+'"></div>';
  document.getElementById('steps').innerHTML=h;
}

function pick(list,cur,key){
  return list.map(function(o,i){
    var sel=cur&&cur.id===o.id;
    var h='<button class="opt '+(sel?'sel':'')+'" onclick="sel_(\\''+key+'\\','+i+')">'
      +'<div class="hd"><span class="ic">'+o.ic+'</span><span class="nm">'+o.nm+'</span>'
      +'<span class="tag">'+o.tag+'</span></div>'
      +'<p class="ds">'+o.desc+'</p><div class="detail"><div class="lst">';
    h+=o.good.map(function(g){return '<div class="li good"><b>▲</b><span>'+g+'</span></div>'}).join('');
    h+=o.bad.map(function(g){return '<div class="li bad"><b>▼</b><span>'+g+'</span></div>'}).join('');
    if(o.feel) h+='<div class="feel">'+o.feel+'</div>';
    return h+'</div></div></button>';
  }).join('');
}
function sel_(k,i){ S[k]=(k==='gov'?GOVS:SOCS)[i]; draw(); }

function view(){
  if(S.step===0){
    return '<div class="eyebrow">الخطوة ١ من ٤</div><h1>دولتك</h1>'
      +'<p class="lede">دولة خيالية، وحاكم من اختيارك. الأسماء دي هتظهر في كل مكان في اللعبة وفي شاشة النهاية.</p>'
      +'<div class="field"><label>اسم الدولة</label><div class="wrap">'
      +'<input id="cn" value="'+S.country+'" placeholder="اكتب اسم دولتك" oninput="S.country=this.value;foot()">'
      +'<button class="dice" onclick="roll(\\'country\\')">🎲</button></div></div>'
      +'<div class="field"><label>اسمك كحاكم</label><div class="wrap">'
      +'<input id="rn" value="'+S.ruler+'" placeholder="اكتب اسمك" oninput="S.ruler=this.value;foot()">'
      +'<button class="dice" onclick="roll(\\'ruler\\')">🎲</button></div></div>'
      +'<div class="flag">💡 لو سيبتهم فاضيين، اللعبة هتختار لك أسماء عشوائية.</div>';
  }
  if(S.step===1){
    return '<div class="eyebrow">الخطوة ٢ من ٤</div><h1>نظام الحكم</h1>'
      +'<p class="lede">ده مش شكل بس — ده بيغيّر مصدر شرعيتك، يعني بيغيّر الحاجة اللي ممكن تسقطك.</p>'
      +pick(GOVS,S.gov,'gov');
  }
  if(S.step===2){
    return '<div class="eyebrow">الخطوة ٣ من ٤</div><h1>طبيعة المجتمع</h1>'
      +'<p class="lede">الناس اللي هتحكمهم. ده بيحدد إيه اللي بيغضبهم، وقد إيه بيسامحوا.</p>'
      +pick(SOCS,S.soc,'soc');
  }
  var c=computed(), v=c.v, d=c.d;
  function row(lb,key,suffix){
    var dd=d[key]?'<span class="d '+(d[key]>0?'up':'dn')+'">'+(d[key]>0?'▲+':'▼')+ar(Math.abs(d[key]))+'</span>':'';
    return '<div class="srow"><span>'+lb+'</span><span class="v">'+ar(v[key])+(suffix||'')+dd+'</span></div>';
  }
  var h='<div class="eyebrow">الخطوة ٤ من ٤</div><h1>قبل ما تبدأ</h1>'
    +'<p class="lede">دي حالة دولتك يوم ما تمسك الحكم — بعد ما اختياراتك اتحسبت.</p>'
    +'<div class="title"><div class="cn">'+(S.country||'دولة بلا اسم')+'</div>'
    +'<div class="rn">'+(S.gov?S.gov.ic+' ':'')+(S.ruler||'حاكم بلا اسم')+'</div></div>'
    +'<div class="sum">'
    +row('الرضا الشعبي','approval')+row('الثبات السياسي','stability')
    +row('كفاءة الوزرا','competence')+row('ولاء الوزرا','loyalty')
    +row('طاقة القرارات','ap')+row('التضخم','inflation','٪')
    +'<div class="srow"><span>الخزينة</span><span class="v">'+ar(v.treasury)+'م</span></div>'
    +'</div>';
  if(S.gov&&S.gov.id==='republic') h+='<div class="flag">🗳️ أول انتخابات بعد ٤٨ شهر. لو رضاك وقتها تحت ٤٠، خرجت.</div>';
  if(S.gov&&S.gov.id==='dictator') h+='<div class="flag">⚠️ رضا الجيش تحت ٣٠ = انقلاب فوري. راقب وزير الدفاع.</div>';
  if(S.gov&&S.gov.id==='monarchy') h+='<div class="flag">👑 مفيش انتخابات ومفيش مدة. بتفضل لحد ما يشيلوك.</div>';
  if(S.soc&&S.soc.id==='divided') h+='<div class="flag">⚡ الوضع الصعب. ما تلعبهوش أول مرة.</div>';
  return h;
}

function foot(){
  var ok = S.step===0 ? true : S.step===1 ? !!S.gov : S.step===2 ? !!S.soc : true;
  var lbl = S.step===3 ? 'ابدأ الحُكم ⟵' : 'التالي ⟵';
  document.getElementById('foot').innerHTML =
    (S.step>0?'<button class="btn ghost" onclick="back()">⟶ رجوع</button>':'')
    +'<button class="btn" '+(ok?'':'disabled')+' onclick="next()">'+lbl+'</button>';
}
function next(){ if(S.step<3){S.step++;draw()} else alert('اللعبة بتبدأ هنا'); }
function back(){ if(S.step>0){S.step--;draw()} }
function roll(k){
  var L = k==='country'?CN:RN;
  S[k==='country'?'country':'ruler'] = L[Math.floor(Math.random()*L.length)];
  draw();
}
function draw(){ steps(); document.getElementById('view').innerHTML=view(); foot(); }
draw();
</script>
</body>
</html>"""

out = (HTML.replace("__GOVS__", json.dumps(GOVS, ensure_ascii=False))
           .replace("__SOCS__", json.dumps(SOCIETIES, ensure_ascii=False))
           .replace("__BASE__", json.dumps(BASE, ensure_ascii=False))
           .replace("__CN__", json.dumps(COUNTRY_NAMES, ensure_ascii=False))
           .replace("__RN__", json.dumps(RULER_NAMES, ensure_ascii=False)))
open("setup_mockup.html", "w", encoding="utf-8").write(out)

# the setup modifiers are game data, so they belong in the data folder too
json.dump({"government_types": GOVS, "society_types": SOCIETIES, "base_start": BASE,
           "suggested_country_names": COUNTRY_NAMES, "suggested_ruler_names": RULER_NAMES},
          open("data/setup.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("setup_mockup.html + data/setup.json written")
