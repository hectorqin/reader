self.addEventListener("message", event => {
  if (event.data && event.data.type === "CLEAR_HOME_CACHE") {
    self.caches.delete("home");
  }
});

workbox.routing.setDefaultHandler(async ({ event }) => {
  let { request, target } = event;

  // 处理首页请求 networkFirst
  try {
    const url = new URL(request.url);
    if (
      url.origin === target.origin &&
      (!url.pathname || url.pathname === "/")
    ) {
      const homeCache = await self.caches.open("home");
      return fetch(request)
        .then(fetchRes => {
          if (fetchRes.type !== "opaque") {
            let resClone = fetchRes.clone();
            homeCache.put(request, fetchRes);
            return resClone;
          }
        })
        .catch(() => {
          return homeCache.match(request);
        });
    }
  } catch (error) {
    //
  }

  // 判断是否有 precache
  const precache = await self.caches.open(workbox.core.cacheNames.precache);
  const precacheRes = await precache.match(
    workbox.precaching.getCacheKeyForURL(request.url)
  );
  if (precacheRes) {
    return precacheRes;
  }

  // 处理api请求 networkOnly
  if (request.url.indexOf("/reader3/") !== -1) {
    return fetch(request);
  }

  const imageCache = await self.caches.open("IMAGE_CAHCE");
  const opaqueCache = await self.caches.open("OPAQUE_CAHCE");

  /**
   *
   * @param {Response} res
   */
  const isImage = function(res) {
    const contentType = res.headers.get("Content-Type");
    if (contentType && contentType.indexOf("image/") !== -1) {
      return true;
    }
    return false;
  };

  // 通用请求，缓存 opaque 资源 和 图片资源
  const doRequest = function(request) {
    var originRequest = request;
    // 站外资源去掉 referrer
    if (
      request.mode !== "navigate" &&
      request.url.indexOf(request.referrer) === -1
    ) {
      // 站外资源强制缓存
      request = new Request(request, { referrer: "" });
    }

    // 对于不在 caches 中的资源进行请求
    return fetch(request).then(fetchRes => {
      if (fetchRes.type === "opaque") {
        let resClone = fetchRes.clone();
        opaqueCache.put(originRequest, fetchRes);
        return resClone;
      }
      // 这里只缓存成功 && 请求是 GET 方式的结果，对于 POST 等请求，可把 indexDB 给用上
      if (!fetchRes || fetchRes.status !== 200 || request.method !== "GET") {
        return fetchRes;
      }

      // 只能缓存同源的图片，跨域的资源都访问不了
      let resClone = fetchRes.clone();
      if (isImage(fetchRes)) {
        imageCache.put(originRequest, fetchRes);
      }

      return resClone;
    });
  };

  // 先从 caches 中寻找是否有匹配
  return opaqueCache.match(request).then(res => {
    if (res) {
      return res;
    }
    return imageCache.match(request).then(res => {
      if (res) {
        return res;
      }
      return doRequest(request);
    });
  });
});
