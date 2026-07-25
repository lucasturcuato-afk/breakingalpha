import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { buildThinFallback } from "../src/lib/thin-fallback.ts";
function env(k:string){for(const l of readFileSync("/Users/noahhanning/breakingalpha/.env.local","utf8").split(/\r?\n/)){const m=l.match(new RegExp(`^${k}\\s*=\\s*(.+)$`));if(m)return m[1].trim().replace(/^["']|["']$/g,"");}throw new Error(k);}
const sb=createClient(env("NEXT_PUBLIC_SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"));
async function main(){
  for(const name of ["SpaceX","Anthropic","OpenAI","Stripe","Some Random Minted Co"]){
    const tf=await buildThinFallback(sb,{name});
    console.log(`"${name}"`.padEnd(28),`tier=${tf.tier} cik=${tf.cik ?? "null"}  (no-false-positive check)`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
