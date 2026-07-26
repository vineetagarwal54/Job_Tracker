// Produces the bookmarklet JavaScript as a single-line javascript: URL.
// Each array entry MUST be a complete single-line JS statement so that
// .join("") yields a syntactically valid program.
//
// The `cln` helper inside mirrors cleanJobDescription() — duplicated here
// because bookmarklet code runs in the target page's global scope and
// can't share modules with the React app.
export function getBookmarkletCode() {
  return [
    "javascript:void(function(){",
    "var d={},h=location.hostname,jd='',selected=((window.getSelection&&window.getSelection().toString())||'').trim(),ats=/greenhouse|lever|workday|ashby|bamboo|icims|taleo|smartrecruiters|jazz|breezy|paylocity|myworkday|phenom/i;",

    // ── 1. JSON-LD structured data (most reliable when present) ──
    "try{document.querySelectorAll('script[type=\"application/ld+json\"]').forEach(function(s){try{var raw=JSON.parse(s.textContent),items=Array.isArray(raw)?raw:raw['@graph']?raw['@graph']:[raw];items.forEach(function(j){if(j['@type']==='JobPosting'){d.role=d.role||j.title||'';d.company=d.company||(j.hiringOrganization&&j.hiringOrganization.name)||'';if(j.jobLocation){var a=j.jobLocation.address||j.jobLocation;if(a.addressLocality)d.location=[a.addressLocality,a.addressRegion].filter(Boolean).join(', ')}if(j.baseSalary&&j.baseSalary.value){var bv=j.baseSalary.value;d.salary=bv.minValue?'$'+bv.minValue+(bv.maxValue?'-$'+bv.maxValue:''):'$'+(bv.value||'')}jd=jd||j.description||''}})}catch(e){}})}catch(e){}",

    // ── 2. Source detection ──
    "if(selected.length)jd=selected;",
    "if(h.includes('handshake'))d.source='Handshake';else if(h.includes('linkedin'))d.source='LinkedIn';else if(h.includes('indeed'))d.source='Indeed';else if(h.includes('jobright'))d.source='Other';else d.source='Company Site';",

    // ── 3. Parse og:title / document.title ──
    "var ogT=(document.querySelector('meta[property=\"og:title\"]')||{}).content||document.title||'';",
    "var titleParts=ogT.split(/\\s*[\\|\\-\\u2013\\u2014]\\s*/);",
    "var atParts=ogT.split(/\\s+at\\s+/i);",

    // ── 4. Role ──
    "if(!d.role&&titleParts.length>1)d.role=titleParts[0].trim();",
    "if(!d.role){var h1=(document.querySelector('h1')||{}).textContent||'';if(h1&&!/^(careers|jobs|join|open positions|work with us|opportunities)/i.test(h1.trim()))d.role=h1.trim()}",
    "if(!d.role&&titleParts.length)d.role=titleParts[0].trim();",

    // ── 5. Company ──
    "if(!d.company&&h.includes('handshake')){var aEls=document.querySelectorAll('a[href*=\"/employers/\"]');for(var i=0;i<aEls.length;i++){if(/\\/employers\\/\\d/.test(aEls[i].getAttribute('href'))){var t=aEls[i].textContent.trim();if(t&&t.length>1&&t.length<80){d.company=t;break}}}}",
    "if(!d.company&&h.includes('handshake')&&titleParts.length>=2){var cp=titleParts[1].trim();if(!/handshake/i.test(cp))d.company=cp;else if(titleParts.length>=3)d.company=titleParts[1].trim()}",
    "if(!d.company&&atParts.length>=2){var cp2=atParts[1].replace(/\\s*[\\|\\-].*/,'').trim();if(cp2&&cp2.length<80&&!ats.test(cp2))d.company=cp2}",
    "if(!d.company){var og=document.querySelector('meta[property=\"og:site_name\"]');if(og&&og.content&&!/handshake|linkedin|indeed|glassdoor/i.test(og.content)&&!ats.test(og.content))d.company=og.content.trim()}",
    "if(!d.company){var cEl=document.querySelector('[data-hook*=\"employer\"],[class*=\"employer-name\"],[class*=\"company-name\"],[data-testid*=\"employer\"],[data-testid*=\"company\"]');if(cEl)d.company=cEl.textContent.trim()}",
    "if(!d.company&&!h.includes('handshake')){var cLinks=document.querySelectorAll('a[href*=\"/company\"],a[href*=\"/companies\"]');for(var i=0;i<cLinks.length;i++){var t=cLinks[i].textContent.trim();if(t&&t.length>1&&t.length<80){d.company=t;break}}}",
    "if(!d.company&&titleParts.length>=2){var last=titleParts[titleParts.length-1].trim();if(last.length>1&&last.length<80)d.company=last}",

    // ── 6. Link ──
    "d.link=location.href;",

    // ── 7. Salary ──
    "if(!d.salary){try{var sEls=document.querySelectorAll('div,span,dt,li,p,td,dd,section');for(var i=0;i<sEls.length;i++){var el=sEls[i],txt=el.innerText||'';if(txt.length>5&&txt.length<500&&/salary|compensation|pay|stipend|wage/i.test(txt)){var sm=txt.match(/\\$[\\d,]+(\\.[\\d]+)?(k|K)?\\s*([-\\u2013\\/]\\s*(\\$)?[\\d,]+(\\.[\\d]+)?(k|K)?)?\\s*(\\/\\s*(hr|hour|yr|year|month|mo|week|wk|annual))?/i);if(sm&&sm[0].length>3){d.salary=sm[0].trim();break}}}}catch(e){}}",
    "if(!d.salary){try{var bt=document.body.innerText;var sm=bt.match(/\\$[\\d,]+(\\.[\\d]+)?(k|K)?\\s*([-\\u2013\\/]\\s*(\\$)?[\\d,]+(\\.[\\d]+)?(k|K)?)?\\s*(\\/\\s*(hr|hour|yr|year|month|mo|week|wk|annual))?/i);if(sm&&sm[0].length>3)d.salary=sm[0].trim()}catch(e){}}",

    // ── 8. Job Description ──
    "if(!jd){var jdEl=document.querySelector('[class*=\"job-description\"],[class*=\"job_description\"],[id*=\"job-description\"],[id*=\"job_description\"],[class*=\"posting-description\"],[class*=\"job-detail\"],[class*=\"jobDetail\"]');if(jdEl&&jdEl.innerText.length>100)jd=jdEl.innerText}",
    "if(!jd||jd.length<200){var jdEl2=document.querySelector('[class*=\"description\"],[id*=\"description\"],article,[role=\"main\"]');if(jdEl2&&jdEl2.innerText.length>200)jd=jdEl2.innerText}",
    "if(!jd||jd.length<200){var mainEl=document.querySelector('main,[role=\"main\"]');if(mainEl&&mainEl.innerText&&mainEl.innerText.length>200)jd=mainEl.innerText}",
    "if(!jd||jd.length<200){var best='';document.querySelectorAll('div,section,main').forEach(function(el){if(el.closest('nav,footer,header,[class*=\"sidebar\"],[class*=\"nav\"],[class*=\"footer\"],[class*=\"header\"]'))return;var t=el.innerText||'';if(t.length>300&&t.length>best.length&&t.length<50000)best=t});if(best.length>300)jd=best}",

    // ── 9. Clean JD (HTML → text) + copy to clipboard + open app ──
    // Mirrors cleanJobDescription() in utils/jobDescriptionCleaner.js
    "function cln(s){if(!s||typeof s!=='string')return'';if(/<[a-z][^>]*>/i.test(s)){s=s.replace(/<(script|style|noscript|svg)[^>]*>[\\s\\S]*?<\\/\\1>/gi,'').replace(/<\\s*br\\s*\\/?\\s*>/gi,'\\n').replace(/<\\s*li[^>]*>/gi,'\\n\\u2022 ').replace(/<\\/\\s*(p|div|h[1-6]|section|article|ul|ol|tr)\\s*>/gi,'\\n').replace(/<\\s*(p|div|h[1-6]|section|article|tr)[^>]*>/gi,'\\n').replace(/<[^>]+>/g,'');var dec=document.createElement('textarea');dec.innerHTML=s;s=dec.value}return s.replace(/\\r\\n/g,'\\n').replace(/[^\\S\\n]+/g,' ').replace(/\\n[^\\S\\n]+/g,'\\n').replace(/[^\\S\\n]+\\n/g,'\\n').replace(/\\n{3,}/g,'\\n\\n').trim()}",
    "var jdC=false;if(jd&&jd.length>50){jd=cln(jd);try{navigator.clipboard.writeText(jd.substring(0,15000));jdC=true}catch(e){}}",
    "var p=new URLSearchParams();for(var k in d)if(d[k])p.set(k,String(d[k]).trim().substring(0,500));if(jd)p.set('jd',jd.substring(0,15000));if(jdC)p.set('jdCopied','1');",
    "window.location='jobtrack://add?'+p.toString();",
    "}())",
  ].join("");
}
