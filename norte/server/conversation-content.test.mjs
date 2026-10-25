import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'norte-conversation-blocks-'));
  const options = { storeFile: join(directory, 'state.json'), logger: false, ai: { apiKey: '' }, demoAccount: false };
  let app = await buildApp(options);
  t.after(async () => { await app.close(); await rm(directory, {recursive:true,force:true}); });
  const request = (actor, method, path, payload) => app.inject({method,url:`/api${path}`,headers:actor?.headers,...(payload === undefined ? {} : {payload})});
  async function account(name) {
    const response = await request(null, 'POST', '/auth/register', {name,email:`${name}@fixture.test`,password:'isolated-conversation-fixture-password'});
    assert.equal(response.statusCode,201,response.body);
    return {...response.json().user,headers:{cookie:[response.headers['set-cookie']].flat().filter(Boolean).map(value=>value.split(';')[0]).join('; '),'x-csrf-token':response.json().csrfToken}};
  }
  const owner = await account('owner'), alice = await account('alice'), bob = await account('bob');
  const response = await request(alice,'POST','/platform/conversations',{recipientId:bob.id});
  assert.equal(response.statusCode,200,response.body);
  return {get app(){return app;},request,owner,alice,bob,id:response.json().conversation.id,async restart(){await app.close();app=await buildApp(options);}};
}

test('text and annotated images preserve their order, persist, and keep attachment access private', async t => {
  const f = await fixture(t), path = `/platform/conversations/${f.id}/messages`;
  const payload = {key:randomUUID(),blocks:[
    {type:'text',text:'Antes da primeira imagem'},
    {type:'image',image:{dataUrl:png,name:'primeira.png'}},
    {type:'text',text:'Explicação entre as imagens'},
    {type:'image',image:{dataUrl:png,name:'segunda.png'}},
    {type:'text',text:'Conclusão depois da segunda imagem'},
  ]};
  const sent = await f.request(f.alice,'POST',path,payload);
  assert.equal(sent.statusCode,200,sent.body);
  const message = sent.json().message;
  assert.deepEqual(message.blocks.map(block=>block.type),['text','image','text','image','text']);
  assert.equal(message.blocks[2].text,payload.blocks[2].text);
  assert.equal(message.body,'Antes da primeira imagem\nExplicação entre as imagens\nConclusão depois da segunda imagem');
  assert.doesNotMatch(sent.body,/"data"|"digest"|"key"|base64/);
  assert.equal((await f.request(f.alice,'POST',path,payload)).json().message.id,message.id);
  const reordered = structuredClone(payload);
  [reordered.blocks[1],reordered.blocks[3]] = [reordered.blocks[3],reordered.blocks[1]];
  assert.equal((await f.request(f.alice,'POST',path,reordered)).statusCode,409);
  for(const block of message.blocks.filter(block=>block.type==='image')) {
    const url = block.image.url.slice(4);
    const own = await f.request(f.bob,'GET',url);
    assert.equal(own.statusCode,200);
    assert.equal(own.headers['content-type'],'image/png');
    assert.equal(own.headers['cache-control'],'no-store');
    assert.equal((await f.request(f.owner,'GET',url)).statusCode,404);
    assert.equal((await f.request(null,'GET',url)).statusCode,401);
  }
  await f.restart();
  const loaded = (await f.request(f.bob,'GET',`/platform/conversations/${f.id}`)).json();
  assert.deepEqual(loaded.messages[0].blocks,message.blocks);
  assert.equal(loaded.messages.length,1);
});

test('content validation rejects empty, malformed, oversized, and mixed legacy payloads', async t => {
  const f = await fixture(t), path = `/platform/conversations/${f.id}/messages`;
  for(const blocks of [[],[{type:'text',text:'  '}],[{type:'html',html:'<img>'}],[{type:'image'}],[{type:'text',text:'x'.repeat(4001)}],Array.from({length:7},()=>({type:'image',image:{dataUrl:png,name:'fixture.png'}})),[{type:'image',image:{dataUrl:'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',name:'unsafe.svg'}}]]) {
    const response = await f.request(f.alice,'POST',path,{key:randomUUID(),blocks});
    assert.equal(response.statusCode,400,response.body);
  }
  assert.equal((await f.request(f.alice,'POST',path,{key:randomUUID(),blocks:[{type:'text',text:'text'}],attachment:{dataUrl:png,name:'old.png'}})).statusCode,400);
  const legacy = await f.request(f.alice,'POST',path,{key:randomUUID(),body:'Mensagem antiga',attachment:{dataUrl:png,name:'old.png'}});
  assert.equal(legacy.statusCode,200,legacy.body);
  assert.ok(legacy.json().message.attachment.url);
});

test('new help requests go through administration and legacy guide conversations stay out of the list', async t => {
  const f = await fixture(t);
  assert.equal((await f.request(f.alice,'POST','/platform/conversations',{kind:'help'})).statusCode,410);
  const support = await f.request(f.alice,'POST','/platform/conversations',{kind:'administration'});
  assert.equal(support.statusCode,200,support.body);
  await f.app.missionStore.update(data=>{
    const guide = structuredClone(data.platform.conversations[support.json().conversation.id]);
    guide.id='legacy-guide';guide.kind='help';guide.title='Ajuda Norte';guide.identity=`help:${f.alice.id}`;
    data.platform.conversations[guide.id]=guide;
  });
  const list = (await f.request(f.alice,'GET','/platform/conversations')).json().conversations;
  assert.equal(list.some(conversation=>conversation.kind==='help'),false);
  assert.equal((await f.request(f.alice,'POST','/platform/conversations/legacy-guide/messages',{key:randomUUID(),body:'question'})).statusCode,410);
});
