import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
const [opencode, bundle, worker] = process.argv.slice(2);
const scratch = mkdtempSync(join(tmpdir(), 'bb-skill-repro-'));
const calls = [];
const server = createServer(async (req,res) => {
  let raw=''; for await (const part of req) raw+=part;
  calls.push({path:req.url,body:JSON.parse(raw)});
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const chunk = (delta,finish_reason=null) => 'data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:0,model:'demo',choices:[{index:0,delta,finish_reason}]})+'\n\n';
  res.end(chunk({role:'assistant',content:'fixture-ok'})+chunk({},'stop')+'data: [DONE]\n\n');
});
server.listen(0,'127.0.0.1'); await once(server,'listening');
const port=server.address().port;
mkdirSync(join(scratch,'home'));
const config={model:'fixture/demo',small_model:'fixture/demo',enabled_providers:['fixture'],permission:'deny',provider:{fixture:{npm:'@ai-sdk/openai-compatible',name:'Fixture',options:{baseURL:`http://127.0.0.1:${port}/v1`,apiKey:'synthetic-fixture'},models:{demo:{name:'Fixture Demo',limit:{context:8192,output:512}}}}},command:{'fixture-command':{template:'Reply only fixture-ok'}}};
const env={PATH:process.env.PATH,HOME:join(scratch,'home'),TMPDIR:scratch,XDG_CONFIG_HOME:join(scratch,'config'),XDG_DATA_HOME:join(scratch,'data'),XDG_CACHE_HOME:join(scratch,'cache'),OPENCODE_CONFIG_CONTENT:JSON.stringify(config),OPENCODE_DISABLE_AUTOUPDATE:'true',OPENCODE_DISABLE_DEFAULT_PLUGINS:'true',OPENCODE_DISABLE_LSP_DOWNLOAD:'true',BB_DATA_DIR:join(scratch,'bb-data')};
const children=[];
function client(command,args){
 const child=spawn(command,args,{cwd:scratch,env,stdio:['pipe','pipe','pipe']}); children.push(child);
 const messages=[];let errors='';child.stderr.on('data',s=>errors+=s);
 createInterface({input:child.stdout}).on('line',s=>{try{messages.push(JSON.parse(s))}catch{}});
 let serial=0;
 const wait=async f=>{const end=Date.now()+60000;while(!f()){if(Date.now()>end||child.exitCode!==null)throw Error('RPC timeout/exit: '+errors.slice(-2000));await new Promise(r=>setTimeout(r,10));}};
 const rpc=async(method,params)=>{const id=++serial;child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');await wait(()=>messages.some(m=>m.id===id));const m=messages.find(m=>m.id===id);assert(!m.error,JSON.stringify(m.error));return m.result;};
 return {rpc,messages,wait,child};
}
try{
 const raw=client(opencode,['acp']);
 await raw.rpc('initialize',{protocolVersion:1,clientCapabilities:{}});
 const session=await raw.rpc('session/new',{cwd:scratch,mcpServers:[]});
 const baseline=calls.length; const offset=raw.messages.length;
 const empty=await raw.rpc('session/prompt',{sessionId:session.sessionId,prompt:[{type:'text',text:'/example-skill Reply only fixture-ok'}]});
 assert.equal(empty.stopReason,'end_turn'); assert.equal(calls.length,baseline);
 assert(!raw.messages.slice(offset).some(m=>m.params?.update?.sessionUpdate==='agent_message_chunk'));
 await raw.rpc('session/prompt',{sessionId:session.sessionId,prompt:[{type:'text',text:'/fixture-command'}]});
 assert(calls.length>baseline);
 raw.child.stdin.end();
 const skills=join(scratch,'skills');mkdirSync(join(skills,'example-skill'),{recursive:true});
 writeFileSync(join(skills,'example-skill','SKILL.md'),'---\nname: example-skill\ndescription: Synthetic skill\n---\nReply only fixture-ok.\n');
 const bridge=client(process.execPath,[worker,bundle]);
 await bridge.rpc('skills/configure',{roots:[{id:'synthetic-root',path:skills,skills:[{name:'example-skill',description:'Synthetic skill'}]}]});
 const options={model:'fixture/demo',permissionMode:'full',permissionScope:'full',approvalReviewer:null,permissionEscalation:null,providerOptions:{acpDialect:'opencode',acpLaunchSpec:{displayName:'Isolated OpenCode',command:opencode,args:['acp'],env}}};
 const thread=await bridge.rpc('thread/start',{threadId:'isolated-skill-thread',cwd:scratch,instructionMode:'append',options});
 const completed=()=>bridge.messages.flatMap(m=>m.params?.deltas??[]).filter(d=>d.kind==='turn.boundary'&&d.status==='completed').length;
 async function turn(input){const count=completed();await bridge.rpc('turn/start',{threadId:'isolated-skill-thread',providerThreadId:thread.providerThreadId,clientRequestId:'creq_abcdefghjk',options,input});await bridge.wait(()=>completed()>count);}
 await turn([{type:'text',text:'Reply only fixture-ok',mentions:[]}]);
 const before=calls.length;
 await turn([{type:'text',text:'/example-skill Reply only fixture-ok',mentions:[{start:0,end:14,resource:{kind:'command',trigger:'/',name:'example-skill',source:'skill',origin:'user',label:'example-skill',argumentHint:null}}]}]);
 assert(calls.length>before);
 const texts=calls.slice(before).flatMap(c=>c.body.messages??[]).map(m=>JSON.stringify(m.content)).join('\n');
 assert(texts.includes('Use the bb skill'));
 await bridge.rpc('thread/stop',{threadId:'isolated-skill-thread',providerThreadId:thread.providerThreadId,activeTurnId:null,intent:'release'});
 bridge.child.stdin.end();
 console.log(JSON.stringify({provider:'OpenCode 1.18.34',baselineUnknownSkill:{stopReason:empty.stopReason,inferenceRequests:0,assistantChunks:0},knownProviderCommand:'completed with local fixture response',fixedBridgeSkill:{inferenceRequests:calls.length-before,rewrittenInstructionReachedModel:true},credentials:'synthetic only',modelBackend:'localhost fixture'},null,2));
}finally{for(const c of children){c.stdin.end();if(c.exitCode===null)c.kill('SIGTERM');}server.close();rmSync(scratch,{recursive:true,force:true});}
