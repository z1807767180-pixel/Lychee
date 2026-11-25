// Only this boolean view is suitable for diagnostics. Readiness means that the
// administrator enabled the service and supplied its credential.
const privateGardenId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function providerStatus(env = process.env, gardenId) {
  const scope = env.LYCHEE_PROVIDER_GARDEN_ID;
  const memberGarden=gardenId==='legacy'||(typeof gardenId==='string'&&gardenId.length===36&&privateGardenId.test(gardenId));
  const registered=scope==='registered-with-daily-limits'&&env.LYCHEE_ACCOUNT_AI_QUOTAS==='1'&&memberGarden;
  const inScope = scope === undefined ||
    registered||(typeof scope === 'string' && scope.length === 36 && privateGardenId.test(scope) && scope === gardenId);
  const enabled = env.LYCHEE_ENABLE_PROVIDER_CALLS === '1' && inScope;
  const chatReady = enabled && !!env.DEEPSEEK_API_KEY?.trim();
  const imageReady = enabled && !!env.ARK_API_KEY?.trim();
  return { enabled, chatReady, imageReady, soupReady: chatReady };
}

export function providerWorkerEnv(env, testOrigin, gardenId) {
  const worker = { LYCHEE_AI_VERIFY_620: '0' };
  if (testOrigin !== undefined) {
    const url = new URL(testOrigin);
    if (!process.env.NODE_TEST_CONTEXT || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
        !url.port || url.origin !== testOrigin) throw Error('Expected an explicit loopback test provider');
    return { ...worker, DEEPSEEK_API_KEY: 'local-chat-fixture', ARK_API_KEY: 'local-image-fixture', ARK_IMAGE_MODEL: 'local-image-model' };
  }
  const { chatReady, imageReady } = providerStatus(env, gardenId);
  if (chatReady) worker.DEEPSEEK_API_KEY = env.DEEPSEEK_API_KEY.trim();
  if (imageReady) {
    worker.ARK_API_KEY = env.ARK_API_KEY.trim();
    if (env.ARK_IMAGE_MODEL?.trim()) worker.ARK_IMAGE_MODEL = env.ARK_IMAGE_MODEL.trim();
  }
  return worker;
}

export function bindLoopbackTestProvider(origin, tursoFixture) {
  const localFetch = globalThis.fetch;
  let pipeline;
  if (tursoFixture !== undefined) {
    const url = new URL(tursoFixture.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
        url.origin !== tursoFixture.url || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(tursoFixture.authToken)) {
      throw Error('Expected an explicit loopback Turso test fixture');
    }
    pipeline = url.origin + '/v2/pipeline';
  }
  const endpoints = new Map([
    ['https://api.deepseek.com/chat/completions', '/chat/completions'],
    ['https://ark.cn-beijing.volces.com/api/v3/images/generations', '/api/v3/images/generations'],
  ]);
  globalThis.fetch = (input, options) => {
    const url = input instanceof Request ? input.url : String(input);
    if (pipeline && url === pipeline) {
      const request = new Request(input, options);
      if (request.method !== 'POST' || request.headers.get('authorization') !== 'Bearer '+tursoFixture.authToken) {
        throw Error('Unexpected Turso fixture request');
      }
      return localFetch(request, {redirect:'error',headers:{
        authorization:'Bearer '+tursoFixture.authToken,'content-type':'application/json',
      }});
    }
    const path = endpoints.get(url);
    if (!path) throw Error('Unexpected test provider endpoint');
    return localFetch(origin + path, { ...options, redirect: 'error' });
  };
}
