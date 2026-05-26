// Node.js port of generateSiteHTML() from the Bedrock builder.
// Takes a lead record from Supabase and produces a standalone HTML page.

const COLORS=[
  {id:'bold',   theme:{bg:'#111418',primary:'#111418',accent:'#c9a84c',text:'#ffffff',textLight:'rgba(255,255,255,0.65)',cardBg:'rgba(255,255,255,0.06)'}},
  {id:'clean',  theme:{bg:'#ffffff',primary:'#1a2030',accent:'#c9a84c',text:'#1a1a2e',textLight:'#6b7a99',cardBg:'#f7f6f3'}},
  {id:'forest', theme:{bg:'#f4f7f0',primary:'#2d4a2d',accent:'#5a8a3a',text:'#1a2d1a',textLight:'#4a6a4a',cardBg:'#e4eed8'}},
  {id:'earthy', theme:{bg:'#f5f0e8',primary:'#5a4a32',accent:'#c8a876',text:'#2d2018',textLight:'#7a6550',cardBg:'#ede8de'}},
  {id:'crimson',theme:{bg:'#1a1416',primary:'#2a1418',accent:'#d4453a',text:'#ffffff',textLight:'rgba(255,255,255,0.7)',cardBg:'rgba(255,255,255,0.05)'}},
  {id:'steel',  theme:{bg:'#ecf0f1',primary:'#2c3548',accent:'#e8793a',text:'#1a252f',textLight:'#5a6a7a',cardBg:'#dce2e6'}}
];

const FONT_PAIRS={
  classic: {heading:`'Cormorant Garamond',serif`, body:`'Montserrat',sans-serif`},
  modern:  {heading:`'Inter',sans-serif`,          body:`'Inter',sans-serif`},
  bold:    {heading:`'Playfair Display',serif`,    body:`'Source Sans 3',sans-serif`},
  friendly:{heading:`'Merriweather',serif`,         body:`'Open Sans',sans-serif`}
};

const TRADES=[
  {id:'contractor',label:'General Contractor'},{id:'roofing',label:'Roofer'},
  {id:'plumber',label:'Plumber'},{id:'electrician',label:'Electrician'},
  {id:'hvac',label:'HVAC'},{id:'landscaping',label:'Landscaper'},
  {id:'concrete',label:'Concrete'},{id:'painting',label:'Painter'},
  {id:'flooring',label:'Flooring'},{id:'drywall',label:'Drywall'},
  {id:'windows',label:'Windows & Doors'},{id:'fencing',label:'Fencing'},
  {id:'cleaning',label:'Cleaning'},{id:'handyman',label:'Handyman'},
  {id:'other',label:'Contractor'}
];

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

/**
 * Generate a standalone HTML page for a customer site.
 * @param {Object} lead - Supabase lead record
 * @returns {string} Complete HTML document
 */
function generateCustomerSite(lead) {
  const d = lead.site_data || {};
  const biz = lead.business_name || 'Your Business';
  const phone = lead.phone || '';
  const email = lead.email || 'contact@yourbusiness.com';
  const city = lead.city || (d.service_areas && d.service_areas[0]) || '';
  const services = lead.services || [];
  const color = d._color || 'bold';
  const heroStyle = d._heroStyle || 'classic';
  const fontPair = d._fontPair || 'classic';

  const t = (COLORS.find(c=>c.id===color) || COLORS[0]).theme;
  const isDark = ['bold','crimson'].includes(color) || t.primary==='#111418' || t.bg==='#111418' || t.bg==='#1a1416';

  const tradeLabel = (TRADES.find(tr=>tr.id===lead.trade)||{label:'Contractor'}).label;

  // Section visibility — show only sections that have real content
  const sVis = {
    services:    !!(d.services && d.services.length),
    about:       !!(d.about),
    specialties: !!(d.specialties && d.specialties.length),
    pricing:     false,
    gallery_1:   false,
    process:     !!(d.process_steps && d.process_steps.length),
    areas:       !!(d.service_areas && d.service_areas.length),
    reviews:     !!(d.reviews && d.reviews.length),
    faq:         !!(d.faqs && d.faqs.length),
    credentials: false,
  };

  const heroKwsHTML = services.slice(0,5).map(s=>`<span style="font-size:0.56rem;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.18);padding:0.32rem 0.72rem;background:rgba(0,0,0,0.15)">${esc(s)}</span>`).join('');

  let heroSection;
  if(heroStyle==='minimal-light'){
    heroSection=`
<section id="hero" style="background:#fafaf7;padding:6rem 5% 4rem;border-bottom:1px solid rgba(0,0,0,0.06)">
  <div style="max-width:780px;margin:0 auto;text-align:center">
    <p style="font-size:0.6rem;font-weight:600;letter-spacing:0.32em;text-transform:uppercase;color:${t.accent};margin-bottom:1.25rem">${esc(city)} · ${esc(tradeLabel)}</p>
    <h1 style="font-family:'Cormorant Garamond',serif;font-size:clamp(2.4rem,5vw,4.4rem);font-weight:300;line-height:1.05;color:#1a1a1a;margin-bottom:1.5rem">${d.headline||''}</h1>
    <div style="width:48px;height:2px;background:${t.accent};margin:0 auto 1.5rem"></div>
    <p style="font-size:0.92rem;font-weight:300;line-height:1.85;color:#4a4a4a;margin-bottom:2.25rem;max-width:560px;margin-left:auto;margin-right:auto">${d.subheadline||''}</p>
    <div style="display:flex;gap:0.85rem;flex-wrap:wrap;justify-content:center">
      <a href="#contact" style="font-size:0.7rem;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#fff;background:#1a1a1a;padding:1rem 2rem;display:inline-block">${d.cta||'Get A Free Quote'}</a>
      ${sVis.services?'<a href="#services" style="font-size:0.7rem;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:#1a1a1a;background:transparent;border:1px solid rgba(0,0,0,0.2);padding:1rem 2rem;display:inline-block">Our Services</a>':''}
    </div>
  </div>
</section>
<div style="background:#fff;border-bottom:1px solid rgba(0,0,0,0.06);display:flex">
  ${(d.trust_items||[]).map(ti=>`<div style="flex:1;text-align:center;padding:1.5rem 1rem;border-right:1px solid rgba(0,0,0,0.06)"><div style="font-family:'Cormorant Garamond',serif;font-size:1.3rem;color:#1a1a1a">${esc(ti.val)}</div><div style="font-size:0.55rem;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:#888;margin-top:3px">${esc(ti.label)}</div></div>`).join('')}
</div>`;
  } else if(heroStyle==='split-screen'){
    heroSection=`
<section id="hero" style="background:${t.primary};border-bottom:2px solid ${t.accent};display:grid;grid-template-columns:1fr 1fr;min-height:75vh">
  <div style="padding:5rem 5% 4rem;display:flex;flex-direction:column;justify-content:center">
    <p style="font-size:0.6rem;font-weight:600;letter-spacing:0.3em;text-transform:uppercase;color:${t.accent};margin-bottom:1rem">${esc(city)} · ${esc(tradeLabel)}</p>
    <h1 style="font-family:'Cormorant Garamond',serif;font-size:clamp(2.2rem,4.5vw,3.8rem);font-weight:300;line-height:1.08;color:#fff;margin-bottom:1.5rem">${d.headline||''}</h1>
    <p style="font-size:0.85rem;font-weight:300;line-height:1.9;color:rgba(255,255,255,0.8);margin-bottom:2rem;max-width:480px">${d.subheadline||''}</p>
    <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:2rem">${services.slice(0,4).map(s=>`<div style="font-size:0.56rem;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${t.accent};border:1px solid rgba(201,168,76,0.35);padding:0.28rem 0.6rem">${esc(s)}</div>`).join('')}</div>
    <div style="display:flex;gap:0.85rem;flex-wrap:wrap">
      <a href="#contact" style="font-size:0.68rem;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${t.primary};background:${t.accent};padding:0.95rem 1.85rem;display:inline-block">${d.cta||'Get A Quote'}</a>
      ${sVis.services?'<a href="#services" style="font-size:0.68rem;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:#fff;background:transparent;border:1px solid rgba(255,255,255,0.3);padding:0.95rem 1.85rem;display:inline-block">Our Services</a>':''}
    </div>
  </div>
  <div style="background:linear-gradient(135deg,${t.accent} 0%,${t.primary} 100%);min-height:100%;display:flex;align-items:center;justify-content:center">
    <div style="font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:300;color:rgba(255,255,255,0.4);font-style:italic;padding:2rem;text-align:center">${esc(biz)}</div>
  </div>
</section>
<div style="background:${t.cardBg};border-bottom:1px solid ${isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)'};display:flex">
  ${(d.trust_items||[]).map(ti=>`<div style="flex:1;text-align:center;padding:1.5rem 1rem;border-right:1px solid ${isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)'}"><div style="font-family:'Cormorant Garamond',serif;font-size:1.3rem;color:${t.text}">${esc(ti.val)}</div><div style="font-size:0.55rem;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:${t.textLight};margin-top:3px">${esc(ti.label)}</div></div>`).join('')}
</div>`;
  } else if(heroStyle==='photo-overlay'){
    heroSection=`
<section id="hero" style="position:relative;min-height:80vh;display:flex;align-items:center;overflow:hidden;background:linear-gradient(135deg,${t.primary} 0%,#0a0d10 100%)">
  <div aria-hidden="true" style="position:absolute;inset:0;background:linear-gradient(to right,rgba(8,6,4,0.92) 0%,rgba(8,6,4,0.65) 55%,rgba(8,6,4,0.25) 100%)"></div>
  <div style="position:relative;max-width:1100px;margin:0 auto;padding:7rem 5% 5rem;width:100%">
    <p style="font-size:0.62rem;font-weight:600;letter-spacing:0.32em;color:rgba(255,255,255,0.55);text-transform:uppercase;display:flex;align-items:center;gap:12px;margin-bottom:1.4rem"><span style="display:inline-block;width:32px;height:1px;background:rgba(255,255,255,0.35)"></span>${esc(city)}${city?' · ':''}${esc(tradeLabel)} · Locally Owned</p>
    <h1 style="font-family:'Cormorant Garamond',serif;font-weight:300;font-size:clamp(2.6rem,6vw,5rem);line-height:1.05;color:#fff;margin-bottom:1.5rem;max-width:760px">${d.headline||''}</h1>
    <p style="font-size:0.92rem;font-weight:300;line-height:1.85;color:rgba(255,255,255,0.85);margin-bottom:2rem;max-width:580px">${d.subheadline||''}</p>
    <div style="display:flex;flex-wrap:wrap;gap:0.55rem;margin-bottom:2.25rem">${heroKwsHTML}</div>
    <div style="display:flex;gap:0.85rem;flex-wrap:wrap">
      <a href="#contact" style="font-size:0.7rem;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:${t.primary};background:${t.accent};padding:1rem 2rem;display:inline-block">${d.cta||'Get A Free Quote'}</a>
    </div>
  </div>
</section>
<div style="background:#0a0d10;padding:1.4rem 5%;border-bottom:1px solid rgba(201,168,76,0.3)">
  <div style="max-width:1100px;margin:0 auto;display:flex;justify-content:space-around;align-items:center;flex-wrap:wrap;gap:1rem">
    ${(d.trust_items||[]).map(ti=>`<div style="display:flex;align-items:center;gap:12px"><div style="font-family:'Cormorant Garamond',serif;font-size:1.6rem;font-weight:400;color:${t.accent};line-height:1">${esc(ti.val)}</div><div style="font-size:0.6rem;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.7);line-height:1.4">${esc(ti.label)}</div></div>`).join('')}
  </div>
</div>`;
  } else {
    // Classic block hero (default)
    heroSection=`
<section id="hero" style="background:${t.primary};padding:5rem 5% 4.5rem">
  <div style="max-width:680px">
    <p style="font-size:0.6rem;font-weight:600;letter-spacing:0.3em;text-transform:uppercase;color:${t.accent};margin-bottom:1rem">${esc(city)} · ${esc(tradeLabel)}</p>
    <h1 style="font-family:'Cormorant Garamond',serif;font-size:clamp(2.4rem,4vw,4rem);font-weight:300;line-height:1.1;color:#fff;margin-bottom:1.25rem">${d.headline||''}</h1>
    <p style="font-size:0.85rem;font-weight:300;line-height:1.9;color:rgba(255,255,255,0.8);margin-bottom:2rem;max-width:560px">${d.subheadline||''}</p>
    <div style="display:flex;flex-wrap:wrap;gap:0.6rem;margin-bottom:2rem">${services.slice(0,5).map(s=>`<div style="font-size:0.56rem;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${t.accent};border:1px solid rgba(201,168,76,0.35);padding:0.28rem 0.6rem">${esc(s)}</div>`).join('')}</div>
    <div style="display:flex;gap:1rem;flex-wrap:wrap">
      <a href="#contact" style="font-size:0.68rem;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${t.primary};background:${t.accent};padding:0.85rem 1.75rem;display:inline-block">${d.cta||'Get A Quote'}</a>
      ${sVis.services?'<a href="#services" style="font-size:0.68rem;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:#fff;background:transparent;border:1px solid rgba(255,255,255,0.3);padding:0.85rem 1.75rem;display:inline-block">Our Services</a>':''}
    </div>
  </div>
</section>
<div style="background:${t.cardBg};border-top:1px solid ${isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)'};border-bottom:1px solid ${isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)'};display:flex">
  ${(d.trust_items||[]).map(ti=>`<div style="flex:1;text-align:center;padding:1.5rem 1rem;border-right:1px solid ${isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)'}"><div style="font-family:'Cormorant Garamond',serif;font-size:1.3rem;color:${t.text}">${esc(ti.val)}</div><div style="font-size:0.55rem;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:${t.textLight};margin-top:3px">${esc(ti.label)}</div></div>`).join('')}
</div>`;
  }

  const servicesHtml=sVis.services?`
<section id="services" style="padding:5rem 5%;background:${t.bg}">
  <p style="font-size:0.58rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:${t.accent};margin-bottom:0.5rem">What We Do</p>
  <h2 style="font-family:'Cormorant Garamond',serif;font-size:2.2rem;font-weight:300;color:${t.text};margin-bottom:0.75rem">Our Services</h2>
  <div style="width:36px;height:2px;background:${t.accent};margin-bottom:2rem"></div>
  <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:1.25rem">
    ${(d.services||[]).map((s,i)=>`<div style="padding:1.75rem;border:1px solid ${isDark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.1)'};background:${t.cardBg}"><div style="font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:300;color:${t.accent};margin-bottom:0.4rem">0${i+1}</div><div style="font-size:0.78rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${t.text};margin-bottom:0.6rem">${esc(s.name)}</div><div style="font-size:0.78rem;font-weight:300;line-height:1.85;color:${t.textLight}">${esc(s.desc)}</div><div style="margin-top:1rem"><a href="#contact" style="font-size:0.78rem;font-weight:500;color:${t.accent};text-decoration:none;border-bottom:1px solid ${t.accent};padding-bottom:2px">Get a quote for ${esc(s.name)} →</a></div></div>`).join('')}
  </div>
</section>`:'';

  const specialtiesHtml=(sVis.specialties&&d.specialties&&d.specialties.length)?`
<section id="specialties" style="padding:4rem 5%;background:${t.bg}">
  <p style="font-size:0.58rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:${t.accent};margin-bottom:0.5rem">What Sets Us Apart</p>
  <h2 style="font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;color:${t.text};margin-bottom:1rem">We Specialize In</h2>
  <div style="width:36px;height:2px;background:${t.accent};margin-bottom:2rem"></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem">
    ${d.specialties.map((s,i)=>`<div style="padding:1.25rem;border-left:3px solid ${t.accent};background:${t.cardBg}"><div style="font-family:'Cormorant Garamond',serif;font-size:1.1rem;color:${t.accent};margin-bottom:0.3rem">0${i+1}</div><div style="font-size:0.82rem;font-weight:500;color:${t.text};line-height:1.5">${esc(s)}</div></div>`).join('')}
  </div>
</section>`:'';

  const aboutHtml=sVis.about?`
<section id="about" style="padding:5rem 5%;background:${t.bg}">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:4rem;align-items:start">
    <div>
      <p style="font-size:0.58rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:${t.accent};margin-bottom:0.5rem">About Us</p>
      <h2 style="font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;color:${t.text};margin-bottom:0.75rem">${esc(d.about_title||'About Us')}</h2>
      <div style="width:36px;height:2px;background:${t.accent};margin-bottom:1.5rem"></div>
      <p style="font-size:0.84rem;font-weight:300;line-height:1.95;color:${t.textLight};margin-bottom:1.5rem">${d.about||''}</p>
      <a href="#contact" style="font-size:0.68rem;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${isDark?'#fff':t.primary};background:${isDark?t.accent:t.primary};padding:0.85rem 1.75rem;display:inline-block">${esc(d.cta||'Contact Us')}</a>
    </div>
    <div style="padding:2rem;background:${t.cardBg};border-left:3px solid ${t.accent}">
      <div style="font-size:0.6rem;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${t.accent};margin-bottom:1rem">Why Choose ${esc(biz)}</div>
      ${['Free estimates on every job','Honest, straightforward pricing','We respect your time and your property','We back our work and stand behind it'].map(item=>`<div style="display:flex;gap:0.75rem;align-items:flex-start;margin-bottom:0.75rem"><div style="width:5px;height:5px;border-radius:50%;background:${t.accent};flex-shrink:0;margin-top:6px"></div><span style="font-size:0.78rem;font-weight:300;color:${t.textLight};line-height:1.7">${item}</span></div>`).join('')}
      ${phone?`<div style="margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid ${isDark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.1)'}"><div style="font-size:0.6rem;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${t.accent};margin-bottom:0.4rem">Call Us Direct</div><a href="tel:${phone.replace(/\D/g,'')}" style="font-size:1.1rem;font-weight:500;color:${t.text}">${esc(phone)}</a></div>`:''}
    </div>
  </div>
</section>`:'';

  const processHtml=(sVis.process&&d.process_steps&&d.process_steps.length)?`
<section id="process" style="padding:4rem 5%;background:${t.primary}">
  <div style="text-align:center;margin-bottom:3rem">
    <p style="font-size:0.58rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:${t.accent};margin-bottom:0.5rem">How We Work</p>
    <h2 style="font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;color:#fff">Simple process. No surprises.</h2>
  </div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1.5rem">
    ${d.process_steps.map(s=>`<div style="text-align:center;padding:0 0.5rem"><div style="width:56px;height:56px;border-radius:50%;border:2px solid ${t.accent};display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;font-family:'Cormorant Garamond',serif;font-size:1.3rem;color:#fff">${esc(s.num)}</div><div style="font-size:0.68rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#fff;margin-bottom:0.4rem">${esc(s.title)}</div><div style="font-size:0.74rem;font-weight:300;color:rgba(255,255,255,0.7);line-height:1.7">${esc(s.desc)}</div></div>`).join('')}
  </div>
</section>`:'';

  const areasHtml=(sVis.areas&&d.service_areas&&d.service_areas.length)?`
<section style="padding:4rem 5%;background:${t.bg}">
  <p style="font-size:0.58rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:${t.accent};margin-bottom:0.5rem">Where We Work</p>
  <h2 style="font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;color:${t.text};margin-bottom:1rem">Service Areas</h2>
  <div style="width:36px;height:2px;background:${t.accent};margin-bottom:2rem"></div>
  <div style="display:flex;flex-wrap:wrap;gap:0.75rem">${d.service_areas.map(a=>`<div style="padding:0.5rem 1rem;border:1px solid ${isDark?'rgba(255,255,255,0.15)':'rgba(0,0,0,0.15)'};font-size:0.72rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:${t.text}">${esc(a)}</div>`).join('')}</div>
  <p style="font-size:0.78rem;font-weight:300;color:${t.textLight};margin-top:1.5rem">Don't see your area? Give us a call — we travel further than you might think.</p>
</section>`:'';

  const reviewsHtml=(sVis.reviews&&d.reviews&&d.reviews.length)?`
<section style="padding:4rem 5%;background:${t.cardBg}">
  <p style="font-size:0.58rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:${t.accent};margin-bottom:0.5rem">Reviews</p>
  <h2 style="font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;color:${t.text};margin-bottom:2rem">What our customers say.</h2>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1.25rem">
    ${d.reviews.map(r=>`<div style="padding:1.75rem;border:1px solid ${isDark?'rgba(255,255,255,0.12)':'rgba(0,0,0,0.08)'};background:${t.bg}"><div style="font-size:0.78rem;color:${t.accent};margin-bottom:0.75rem">${'★'.repeat(r.stars||5)}</div><p style="font-size:0.8rem;font-weight:300;line-height:1.8;color:${t.textLight};font-style:italic;margin-bottom:0.75rem">"${esc(r.text)}"</p><div style="font-size:0.65rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${t.text}">— ${esc(r.name)}${r.job?` · ${esc(r.job)}`:''}</div></div>`).join('')}
  </div>
</section>`:'';

  const faqHtml=(sVis.faq&&d.faqs&&d.faqs.length)?`
<section id="faq" style="padding:5rem 5%;background:${t.bg}">
  <div style="max-width:820px;margin:0 auto">
    <p style="font-size:0.58rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:${t.accent};margin-bottom:0.5rem;text-align:center">Common Questions</p>
    <h2 style="font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;color:${t.text};margin-bottom:0.5rem;text-align:center">Frequently asked questions.</h2>
    <div style="width:36px;height:2px;background:${t.accent};margin:0.5rem auto 2.5rem"></div>
    <div style="display:flex;flex-direction:column;gap:0.65rem">
      ${d.faqs.map(f=>`<details style="border:1px solid ${isDark?'rgba(255,255,255,0.12)':'rgba(0,0,0,0.1)'};background:${t.cardBg}">
        <summary style="padding:1.15rem 1.4rem;cursor:pointer;font-size:0.84rem;font-weight:500;color:${t.text};list-style:none;display:flex;justify-content:space-between;align-items:center;gap:1rem">${esc(f.q||'')}<span style="font-family:'Cormorant Garamond',serif;font-size:1.5rem;color:${t.accent};flex-shrink:0">+</span></summary>
        <div style="padding:0 1.4rem 1.25rem;font-size:0.8rem;font-weight:300;line-height:1.85;color:${t.textLight}">${esc(f.a||'')}</div>
      </details>`).join('')}
    </div>
  </div>
</section>`:'';

  const mailtoSubject = encodeURIComponent('Quote request from your website');
  const sectionOrder = [servicesHtml, specialtiesHtml, aboutHtml, processHtml, areasHtml, reviewsHtml, faqHtml].join('\n');

  const pair = FONT_PAIRS[fontPair] || FONT_PAIRS.classic;

  // WEB1 2026-05-25: deep SEO + AI-discoverability metadata for every deployed
  // customer site. Everything below is driven by the contractor's profile data
  // (no fabrication). Mirrors what Mad Ox got via hand-edits.
  const pageTitle = `${esc(biz)}${city?' — '+esc(city):''} | ${esc(tradeLabel)}`;
  const pageDesc  = esc(d.subheadline || (biz + ' — ' + tradeLabel + ' serving ' + (city || 'your area') + '. Call ' + (phone || 'today') + ' for a free estimate.'));
  const siteUrl   = lead.live_url || lead.site_url || (d._selectedDomain ? ('https://' + d._selectedDomain) : '');
  const ogImage   = (d.photos && d.photos[0]) || (Array.isArray(d.hero_photos) && d.hero_photos[0]) || '';
  const serviceAreasList = (d.service_areas && d.service_areas.length ? d.service_areas : (city ? [city] : []));
  const trade     = lead.trade || '';

  // LocalBusiness JSON-LD. Includes telephone, address, geo-coverage list, and
  // serviceType so Google Maps / Knowledge Panel / AI-search can pick it up.
  const ldBusiness = {
    "@context": "https://schema.org",
    "@type":    ["LocalBusiness", "ProfessionalService"],
    "name":     biz,
    "description": pageDesc,
    "telephone":   phone || undefined,
    "email":       email || undefined,
    "url":         siteUrl || undefined,
    "address": city ? { "@type": "PostalAddress", "addressLocality": city, "addressCountry": "US" } : undefined,
    "areaServed":  serviceAreasList.length ? serviceAreasList.map((a) => ({ "@type": "City", "name": a })) : undefined,
    "serviceType": services && services.length ? services : (tradeLabel || undefined),
    "priceRange":  "$$"
  };
  // Drop undefined keys so JSON stays clean.
  Object.keys(ldBusiness).forEach((k) => { if (ldBusiness[k] === undefined) delete ldBusiness[k]; });

  // FAQPage JSON-LD when the contractor wrote FAQs in the builder — feeds
  // Google's FAQ rich snippet + AI answer engines (Perplexity / ChatGPT).
  const faqs = Array.isArray(d.faqs) ? d.faqs.filter((q) => q && q.question && q.answer) : [];
  const ldFaq = faqs.length ? {
    "@context": "https://schema.org",
    "@type":    "FAQPage",
    "mainEntity": faqs.map((q) => ({
      "@type": "Question",
      "name":  String(q.question),
      "acceptedAnswer": { "@type": "Answer", "text": String(q.answer) }
    }))
  } : null;

  // Optional geo coordinates — populated when the builder captured them on
  // the contractor's city pick (d._geo = {lat, lng}). Skipped otherwise.
  const geoLat = d._geo && d._geo.lat;
  const geoLng = d._geo && d._geo.lng;

  let html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${pageTitle}</title>
<meta name="description" content="${pageDesc}">
<meta name="author" content="${esc(biz)}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
${city ? `<meta name="geo.region" content="US">
<meta name="geo.placename" content="${esc(city)}">` : ''}
${(geoLat && geoLng) ? `<meta name="geo.position" content="${geoLat};${geoLng}">
<meta name="ICBM" content="${geoLat}, ${geoLng}">` : ''}
${siteUrl ? `<link rel="canonical" href="${esc(siteUrl)}">` : ''}

<!-- Open Graph (Facebook / LinkedIn / iMessage previews) -->
<meta property="og:type" content="website">
<meta property="og:locale" content="en_US">
<meta property="og:site_name" content="${esc(biz)}">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${pageDesc}">
${siteUrl ? `<meta property="og:url" content="${esc(siteUrl)}">` : ''}
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:alt" content="${esc(biz)} — ${esc(tradeLabel)}">` : ''}

<!-- Twitter card -->
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${pageTitle}">
<meta name="twitter:description" content="${pageDesc}">
${ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}">` : ''}

<!-- Structured data: LocalBusiness + (optional) FAQPage -->
<script type="application/ld+json">${JSON.stringify(ldBusiness)}</script>
${ldFaq ? `<script type="application/ld+json">${JSON.stringify(ldFaq)}</script>` : ''}

<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300&family=Montserrat:wght@300;400;500;600&family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600&family=Merriweather:wght@300;400;700&family=Open+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:80px;overflow-x:hidden}
body{font-family:'Montserrat',sans-serif;background:${t.bg};color:${t.text};overflow-x:hidden}
a{text-decoration:none}
a.nav-a{font-size:0.62rem;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.8);transition:color 0.2s}
a.nav-a:hover{color:${t.accent}}
.contact-form input,.contact-form textarea{font-family:'Montserrat',sans-serif;padding:0.75rem 1rem;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#fff;font-size:0.82rem;font-weight:300;outline:none;width:100%}
.contact-form input::placeholder,.contact-form textarea::placeholder{color:rgba(255,255,255,0.5)}
.contact-form textarea{resize:vertical;min-height:90px}
img,video{max-width:100%;height:auto}
@media(max-width:760px){
  section[style*="padding:5rem 5%"],section[style*="padding:4rem 5%"]{padding:2.5rem 1.1rem !important}
  section#hero{min-height:auto !important}
  section [style*="grid-template-columns:1fr 1fr"],section [style*="grid-template-columns:repeat(2,1fr)"],
  section [style*="grid-template-columns:repeat(3,1fr)"],section [style*="grid-template-columns:repeat(4,1fr)"]{grid-template-columns:1fr !important;gap:0.9rem !important}
  section#hero [style*="grid-template-columns"]{grid-template-columns:1fr !important}
  h1{font-size:1.9rem !important;line-height:1.18 !important}
  h2{font-size:1.45rem !important}
  nav{padding:0.85rem 1.1rem !important;flex-wrap:wrap !important}
  nav > div[style*="display:flex;gap:2rem"]{display:none !important}
  nav > a{padding:0.55rem 0.9rem !important;font-size:0.56rem !important}
  footer{padding:2.5rem 1.1rem !important}
}
</style></head><body>

<nav style="background:${t.primary};padding:1rem 5%;display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid ${t.accent};position:sticky;top:0;z-index:100">
  <div>
    <div style="font-family:'Cormorant Garamond',serif;font-size:1.1rem;color:#fff;letter-spacing:0.08em">${esc(biz)}</div>
    <div style="font-size:0.5rem;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:${t.accent};margin-top:2px">${esc(d.tagline||'')}</div>
  </div>
  <div style="display:flex;gap:2rem;align-items:center">
    ${sVis.services?'<a href="#services" class="nav-a">Services</a>':''}
    ${sVis.specialties?'<a href="#specialties" class="nav-a">Specialties</a>':''}
    ${sVis.process?'<a href="#process" class="nav-a">Process</a>':''}
    ${sVis.faq?'<a href="#faq" class="nav-a">FAQ</a>':''}
    <a href="#contact" class="nav-a">Contact</a>
  </div>
  <a href="#contact" style="font-size:0.62rem;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${t.primary};background:${t.accent};padding:0.6rem 1.25rem;display:inline-block">${esc(d.cta||'Get A Quote')}</a>
</nav>

${heroSection}
${sectionOrder}

<section id="contact" style="padding:5rem 5%;background:${t.primary}">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:4rem;align-items:start">
    <div>
      <p style="font-size:0.58rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:${t.accent};margin-bottom:0.5rem">Get A Free Quote</p>
      <h2 style="font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;color:#fff;margin-bottom:0.75rem">${esc(d.contact_line||'Ready to get started?')}</h2>
      <p style="font-size:0.83rem;font-weight:300;line-height:1.9;color:rgba(255,255,255,0.75);margin-bottom:2rem">Fill out the form and we'll get back to you the same day — or call us direct.</p>
      ${phone?`<div style="display:flex;gap:0.75rem;align-items:center;margin-bottom:0.75rem"><div style="width:5px;height:5px;border-radius:50%;background:${t.accent}"></div><a href="tel:${phone.replace(/\D/g,'')}" style="font-size:0.88rem;color:#fff">${esc(phone)}</a></div>`:''}
      <div style="display:flex;gap:0.75rem;align-items:center"><div style="width:5px;height:5px;border-radius:50%;background:${t.accent}"></div><a href="mailto:${esc(email)}" style="font-size:0.82rem;color:rgba(255,255,255,0.85)">${esc(email)}</a></div>
    </div>
    <div class="contact-form" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:2rem">
      <form action="mailto:${esc(email)}" method="POST" enctype="text/plain" style="display:flex;flex-direction:column;gap:0.75rem">
        <input type="text" name="Name" placeholder="Your name" required>
        <input type="tel" name="Phone" placeholder="Phone number" required>
        <input type="email" name="Email" placeholder="Your email">
        <textarea name="Project_Details" placeholder="Tell us about your project…" required></textarea>
        <button type="submit" style="font-family:'Montserrat',sans-serif;font-size:0.68rem;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${t.primary};background:${t.accent};border:none;padding:0.9rem;cursor:pointer">${esc(d.cta||'Send Quote Request')}</button>
      </form>
      <p style="font-size:0.6rem;font-weight:300;color:rgba(255,255,255,0.4);margin-top:0.75rem;font-style:italic">Your message will open in your email app and send directly to ${esc(email)}</p>
    </div>
  </div>
</section>

<footer style="background:${isDark?'#0a0d10':t.primary};padding:1.5rem 5%;display:flex;justify-content:space-between;align-items:center;gap:1.25rem;flex-wrap:wrap;border-top:3px solid ${t.accent}">
  <div style="font-family:'Cormorant Garamond',serif;font-size:1rem;color:#fff">${esc(biz)}</div>
  <div style="font-family:'Cormorant Garamond',serif;font-size:0.82rem;font-style:italic;color:${t.accent}">${esc(d.tagline||'')}</div>
  <div style="font-size:0.6rem;font-weight:300;color:rgba(255,255,255,0.35)">© ${new Date().getFullYear()} ${esc(biz)} · Built by <a href="https://bedrock-sites.com" style="color:${t.accent}">Bedrock Sites</a></div>
</footer>
<script>
document.querySelectorAll('a[href^="#"]').forEach(a=>{
  a.addEventListener('click',function(e){
    const id=this.getAttribute('href').slice(1);
    const el=document.getElementById(id);
    if(el){e.preventDefault();const y=el.getBoundingClientRect().top+window.scrollY-70;window.scrollTo({top:y,behavior:'smooth'});}
  });
});
document.querySelectorAll('details').forEach(d=>{
  d.querySelector('summary')?.addEventListener('click',function(){
    const icon=d.querySelector('summary span:last-child');
    if(icon)icon.textContent=d.open?'+':'×';
  });
});
</script>
</body></html>`;

  // Apply font pair substitution
  html = html.split(`'Cormorant Garamond',serif`).join(pair.heading);
  html = html.split(`'Montserrat',sans-serif`).join(pair.body);
  return html;
}

module.exports = { generateCustomerSite };
