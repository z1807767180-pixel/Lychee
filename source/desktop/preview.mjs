import {listen} from '../server/index.mjs';
import {providerStatus} from '../server/provider-config.mjs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const home=fileURLToPath(new URL('../',import.meta.url));
const gardenArg=process.argv.indexOf('--garden');
const providers=providerStatus(process.env,gardenArg>=0?process.argv[gardenArg+1]:undefined);
if(process.env.LYCHEE_PROVIDER_GARDEN_ID!==undefined&&gardenArg<0)
  console.log('本机已配置指定园范围。可用 --ai-status --garden 园区UUID 核对该园的配置。');
console.log('本机 AI 外部调用'+(providers.enabled?'已启用。':'已关闭。'));
console.log('聊天与海龟汤主持'+(providers.chatReady?'已配置 DeepSeek。':'尚未就绪。'));
console.log('生图'+(providers.imageReady?'已配置火山方舟。':'尚未就绪。'));
console.log('可运行 node desktop/preview.mjs --ai-status 查看本机配置状态，配置方式见 server/OPERATIONS.md。');
if(process.argv.includes('--ai-status'))process.exit(0);
const service=await listen({dataDir:join(home,'本机体验数据'),webRoot:join(home,'release-site'),port:0});
console.log('本机手机版入口 '+service.url+'/mobile/');
console.log('本次使用这台电脑的体验账号。窗口关闭后，数据保存在工程目录的「本机体验数据」。');
const clientEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>
  !/^(DEEPSEEK_|ARK_|LYCHEE_)/i.test(key)));
const client=spawn(join(home,'client-bin','荔枝.exe'),['--test-local',service.url],{windowsHide:false,env:clientEnv});
try {await once(client,'exit');} finally {await service.close();}
