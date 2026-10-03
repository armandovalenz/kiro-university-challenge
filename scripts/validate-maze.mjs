#!/usr/bin/env node
// Validate a Math Man maze layout: 28x31 rect, M/F/G present, ghost-house exit
// open+reachable, and FULLY CONNECTED (flood from M reaches all pellets, fruit,
// and the house exit). Supports horizontal tunnels ('-' on a row => E<->W wrap)
// AND vertical tunnels ('|' on a col => N<->S wrap).
import fs from 'node:fs';
const WALL='#', PEL='.', POW='o', M='M', G='G', F='F', HT='-', VT='|';
function validate(rows){
  const errs=[]; if(!Array.isArray(rows)||!rows.length){errs.push('empty');return errs;}
  const Wd=rows[0].length, Hd=rows.length;
  if(Wd!==28||Hd!==31) errs.push(`dims ${Wd}x${Hd} want 28x31`);
  rows.forEach((r,i)=>{if(typeof r!=='string'||r.length!==Wd)errs.push(`row ${i} len ${r&&r.length}`);});
  if(errs.length) return errs;
  const tr=new Set(), tc=new Set();
  for(let r=0;r<Hd;r++)for(let c=0;c<Wd;c++){if(rows[r][c]===HT)tr.add(r);if(rows[r][c]===VT)tc.add(c);}
  let mPos=null; const gP=[],fP=[],pel=[];
  for(let r=0;r<Hd;r++)for(let c=0;c<Wd;c++){const ch=rows[r][c];
    if(ch===M){if(!mPos)mPos={c,r};}else if(ch===G)gP.push({c,r});
    else if(ch===F)fP.push({c,r});else if(ch===PEL||ch===POW)pel.push({c,r});}
  if(!mPos)errs.push('no M'); if(gP.length<2)errs.push(`G=${gP.length}`);
  if(fP.length<1)errs.push('no F'); if(pel.length<20)errs.push(`pellets=${pel.length}`);
  if(tr.size<1)errs.push('no horizontal tunnel (-)'); if(tc.size<1)errs.push('no vertical tunnel (|)');
  if(!mPos) return errs;
  const key=(c,r)=>`${c},${r}`; const seen=new Set([key(mPos.c,mPos.r)]); const st=[mPos];
  while(st.length){const {c,r}=st.pop();
    for(let [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){let nc=c+dc,nr=r+dr;
      if(tr.has(r)){if(nc<0)nc=Wd-1;else if(nc>=Wd)nc=0;}
      if(tc.has(c)){if(nr<0)nr=Hd-1;else if(nr>=Hd)nr=0;}
      if(nc<0||nc>=Wd||nr<0||nr>=Hd)continue;
      if(rows[nr][nc]===WALL)continue;
      if(seen.has(key(nc,nr)))continue; seen.add(key(nc,nr)); st.push({c:nc,r:nr});}}
  const reach=(c,r)=>seen.has(key(c,r));
  const up=pel.filter(p=>!reach(p.c,p.r)); if(up.length)errs.push(`${up.length}/${pel.length} pellets unreachable (first ${JSON.stringify(up[0])})`);
  const uf=fP.filter(f=>!reach(f.c,f.r)); if(uf.length)errs.push(`fruit unreachable`);
  if(gP.length){const minGr=Math.min(...gP.map(g=>g.r));const ex={c:13,r:minGr-1};
    if(rows[ex.r][ex.c]===WALL)errs.push(`house exit (13,${ex.r}) is wall`);
    else if(!reach(ex.c,ex.r))errs.push(`house exit (13,${ex.r}) unreachable`);}
  return errs;
}
const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); let ok=true;
for(const [n,rows] of Object.entries(data)){const e=validate(rows);
  if(e.length){ok=false;console.log(`FAIL ${n}:`);e.forEach(x=>console.log('  -',x));}else console.log(`OK   ${n}`);}
process.exit(ok?0:1);
