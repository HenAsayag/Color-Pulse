/* Original procedural effect helper. dt is milliseconds from the game clock. */
class SmashEffects {
 constructor(){this.reduced=false;this.clear();}
 clear(){this.events=[];this.clock=0;this.lastFlash=-Infinity;}
 trigger(type,{label}={}){
  const color={success:'#19D538',heal:'#F56B08',miss:'#FF0505'}[type]||'#19D538';
  const flash=this.clock-this.lastFlash>=350;
  if(flash)this.lastFlash=this.clock;
  this.events.push({type,color,label:label??(type==='success'?'+5':type==='heal'?'+3':''),age:0,flash});
  this.events=this.events.slice(-12);
 }
 update(dt){this.clock+=Math.max(0,dt);for(const e of this.events)e.age+=Math.max(0,dt);this.events=this.events.filter(e=>e.age<700);}
 offset(){const e=this.events.find(e=>e.type==='miss'&&e.age<160);return e&&!this.reduced?[Math.sin(e.age*.15)*5*(1-e.age/160),Math.cos(e.age*.12)*3*(1-e.age/160)]:[0,0];}
 draw(ctx,w,h,cx,cy,r){
  ctx.save();
  for(const e of this.events){
   const duration=e.type==='success'?240:e.type==='heal'?320:300;
   if(e.flash&&e.age<duration){ctx.globalAlpha=(this.reduced?.12:e.type==='miss'?.95:.8)*Math.pow(1-e.age/duration,2);ctx.fillStyle=e.color;ctx.fillRect(0,0,w,h);}
   if(e.type!=='miss'&&e.age<280){const t=e.age/280;ctx.globalAlpha=.55*(1-t);ctx.strokeStyle='#9AFFB5';ctx.lineWidth=3*(1-t)+1;ctx.beginPath();ctx.arc(cx,cy,r*(this.reduced?1:.86+.25*t),0,Math.PI*2);ctx.stroke();}
   if(e.label&&e.age<650){ctx.globalAlpha=Math.min(1,e.age/35)*(1-e.age/650);ctx.font='600 19px system-ui';ctx.textAlign='center';ctx.fillStyle=e.color;ctx.fillText(e.label,cx,cy-r-55-(this.reduced?0:26*e.age/650));}
  }
  ctx.restore();
 }
}
if(typeof window!=='undefined')window.SmashEffects=SmashEffects;
if(typeof module!=='undefined')module.exports=SmashEffects;
