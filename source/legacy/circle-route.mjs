import {identity, sameOrigin, db, answer} from "./chunk-ZIGCNLDY.mjs";
import {circleStore} from "./circles.mjs";

const handle = circleStore(async (query, args = []) => {
  const result = await db().prepare(query).bind(...args).run();
  return result.results.map(row => Array.from(row));
});

export async function GET(request) {
  if (request.method === "POST" && !sameOrigin(request)) return answer({error:"请从荔枝园操作"},403);
  const member = await identity(request);
  if (!member) return answer({error:"请登录便签"},401);
  const body = request.method === "POST" ? await request.json().catch(()=>null) : {};
  if (!body || Array.isArray(body) || typeof body !== "object") return answer({error:"数据无效"},400);
  try {
    const profile = await db().prepare("SELECT name FROM camp_profiles WHERE id=?").bind(member).first();
    const day = new Date(Date.now()+8*3600000).toISOString().slice(0,10);
    // In this deployment every authenticated slot belongs to the one shared garden.
    const result = await handle({team:"garden-1",member,name:profile?.name || member,day,
      method:request.method,query:new URL(request.url).searchParams,body});
    if(result.jpeg) return new Response(result.jpeg,{headers:{
      "Content-Type":"image/jpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"
    }});
    return answer(result);
  } catch(error) {
    if([400,401,403,404,405,409].includes(error.status)) return answer({error:error.message},error.status);
    console.error("circle-storage-error",error.code || error.name);
    return answer({error:"圈子暂时没有连上，请稍后再试"},503);
  }
}

export {GET as POST};
