const get=async(u,h={})=>{const r=await fetch(u,{headers:h});await r.text();return r;};
const med=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
async function run(par){
  const t0=performance.now();
  const tok=(await (await fetch("https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/nginx:pull")).json()).token;
  const H={Authorization:`Bearer ${tok}`};
  const tags=(await (await fetch("https://registry.hub.docker.com/v2/library/nginx/tags/list",{headers:H})).json()).tags.slice(0,5);
  const jobs=[...tags.map(t=>()=>get(`https://registry.hub.docker.com/v2/library/nginx/manifests/${t}`,{...H,Accept:"application/vnd.docker.distribution.manifest.v2+json"})),
              ...tags.map(t=>()=>get(`https://hub.docker.com/v2/repositories/library/nginx/tags/${t}`))];
  if(par) await Promise.all(jobs.map(j=>j())); else for(const j of jobs) await j();
  return performance.now()-t0;
}
const S=[],P=[];
for(let i=0;i<5;i++){S.push(await run(false));P.push(await run(true));}
console.log("seq",S.map(Math.round),"med",Math.round(med(S)));console.log("par",P.map(Math.round),"med",Math.round(med(P)));
