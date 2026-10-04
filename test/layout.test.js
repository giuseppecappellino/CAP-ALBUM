const L = require('../js/layout.js');
let fails = 0;
function check(cond, msg){ if(!cond){ fails++; console.log('FAIL', msg); } }
function rnd(n){ const a=[]; for(let i=0;i<n;i++) a.push(Math.random()<0.4? 2/3 : 3/2); return a; }
for (const mode of ['fit','fill']) for (let n=1;n<=12;n++) {
  const ars = rnd(n); const W=79, H=28.5, gap=0.5;
  const t0=Date.now();
  const list = L.combos({ars, width:W, height:H, gap, mode, align:'center', fold:39.5});
  const dt=Date.now()-t0;
  check(list.length>=1 && list[0].rects.length===n, `${mode} n=${n} rects ${list[0].rects.length}`);
  for (const c of list.slice(0,10)) {
    const r=c.rects;
    for (const a of r) {
      check(a.x>=-1e-6 && a.y>=-1e-6 && a.x+a.w<=W+1e-6 && a.y+a.h<=H+1e-6, `${mode} n=${n} out of bounds`);
      if (mode==='fit') check(Math.abs(a.w/a.h - ars[a.i]) < 1e-6, `${mode} n=${n} aspect ${a.w/a.h} vs ${ars[a.i]}`);
    }
    for (let i=0;i<r.length;i++) for (let j=i+1;j<r.length;j++){
      const a=r[i],b=r[j];
      const ov = Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x) > 1e-6 && Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y) > 1e-6;
      check(!ov, `${mode} n=${n} overlap`);
    }
  }
  console.log(mode, 'n='+n, 'combos', list.length, 'best', list[0].score.toFixed(3), dt+'ms');
}
// layoutSpread split
const sp = {items:[{pid:'a'},{pid:'b',side:'R'},{pid:'c',side:'R'}], split:true, s:L.defaultStyle(), sL:L.defaultStyle(), sR:L.defaultStyle(), combo:0, comboL:0, comboR:0};
const out = L.layoutSpread(sp, {w:81,h:30.5}, ()=>1.5);
check(out.placed.length===3, 'split placed'); check(out.placed.filter(p=>p.x>=40.5).length===2, 'right side');
console.log(fails? fails+' failures':'ALL OK');
// ---- v0.2: operazioni sugli alberi ----
const O = L.ops;
let t = null;
t = O.appendLeaves(t, ['a']); t = O.appendLeaves(t, ['b']);
check(JSON.stringify(O.leafIds(t))==='["a","b"]' && t.t==='h', 'append');
t = O.insertAt(t, 'a', 'bottom', ['c']);       // a sopra c, accanto a b
check(t.t==='h' && t.c[0].t==='v' && O.leafIds(t).join('')==='acb', 'insert bottom '+JSON.stringify(t));
t = O.insertAt(t, 'b', 'right', ['d']);
check(t.t==='h' && t.c.length===3 && O.leafIds(t).join('')==='acbd', 'insert right');
t = O.insertAt(t, 'c', 'top', ['e']);
check(O.leafIds(t).join('')==='aecbd' && t.c[0].t==='v' && t.c[0].c.length===3, 'insert top in same column');
t = O.swapLeaves(t, 'a', 'd'); check(O.leafIds(t).join('')==='decba', 'swap');
t = O.removeLeaf(t, 'e'); t = O.removeLeaf(t, 'c');
check(O.leafIds(t).join('')==='dba' && t.t==='h' && t.c.every(c=>c.t==='leaf'), 'remove+collapse '+JSON.stringify(t));
// placeTree con pesi: la colonna mantiene il suo ingombro, i figli si ridistribuiscono
let col = {t:'h', c:[{t:'leaf',id:'x'},{t:'v',c:[{t:'leaf',id:'y'},{t:'leaf',id:'z'}]}]};
const arm = {x:2/3,y:1.5,z:1.5};
const base = L.placeTree(col,{W:79,H:28.5,gap:0.5,mode:'fit',align:'center',ar:l=>arm[l.id]});
const dv = base.dividers.find(d=>d.axis==='v');
check(!!dv, 'divider verticale trovato');
const col2 = JSON.parse(JSON.stringify(col)); col2.c[1].w = [dv.sizes[0]+4, dv.sizes[1]-4];
const moved = L.placeTree(col2,{W:79,H:28.5,gap:0.5,mode:'fit',align:'center',ar:l=>arm[l.id]});
const ry = moved.rects.find(r=>r.leaf.id==='y'), ry0 = base.rects.find(r=>r.leaf.id==='y'), rz=moved.rects.find(r=>r.leaf.id==='z');
check(Math.abs(ry.h - (ry0.h+4))<1e-6, 'peso applicato');
check(Math.abs((rz.y+rz.h) - (base.rects.find(r=>r.leaf.id==='z').y + base.rects.find(r=>r.leaf.id==='z').h))<1e-6, 'ingombro colonna invariato');
// layoutSpread con albero personalizzato
const items=[{id:'a',pid:'A'},{id:'b',pid:'B'},{id:'c',pid:'C'}];
const spc={items, split:false, s:L.defaultStyle(), combo:0, tree:{t:'v',c:[{t:'leaf',id:'a'},{t:'h',c:[{t:'leaf',id:'b'},{t:'leaf',id:'c'}]}]}};
const lay=L.layoutSpread(spc,{w:81,h:30.5},()=>1.5);
check(lay.regions[0].custom && lay.placed.length===3, 'albero personalizzato usato');
const a=lay.placed.find(p=>p.item.id==='a'), b=lay.placed.find(p=>p.item.id==='b');
check(a.y < b.y, 'a sopra b');
console.log(fails? fails+' failures':'OPS OK');
