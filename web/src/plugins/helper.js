export const formatSize = function(value, scale) {
  if (value == null || value == "") {
    return "0 Bytes";
  }
  var unitArr = new Array(
    "Bytes",
    "KB",
    "MB",
    "GB",
    "TB",
    "PB",
    "EB",
    "ZB",
    "YB"
  );
  var index = 0;
  index = Math.floor(Math.log(value) / Math.log(1024));
  var size = value / Math.pow(1024, index);
  size = size.toFixed(scale || 2);
  return size + " " + unitArr[index];
};

export const LimitResquest = function(limit, process) {
  let currentSum = 0;
  let requests = [];

  async function run() {
    let err, result;
    try {
      ++currentSum;
      handler.leftCount = requests.length;
      const fn = requests.shift();
      result = await fn();
    } catch (error) {
      err = error;
      // console.log("Error", err);
      handler.errorCount++;
    } finally {
      --currentSum;
      handler.requestCount++;
      handler.leftCount = requests.length;
      process && process(handler, result, err);
      if (requests.length > 0) {
        run();
      }
    }
  }

  const handler = reqFn => {
    if (!reqFn || !(reqFn instanceof Function)) {
      return;
    }
    requests.push(reqFn);
    handler.leftCount = requests.length;
    if (currentSum < limit) {
      run();
    }
  };

  handler.requestCount = 0;
  handler.leftCount = 0;
  handler.errorCount = 0;
  handler.cancel = () => {
    requests = [];
  };
  handler.isEnd = () => {
    return !handler.leftCount && !currentSum;
  };

  return handler;
};

export const networkFirstRequest = async function(
  requestFunc,
  cacheKey,
  forceCache
) {
  cacheKey = "localCache@" + cacheKey;
  const res = await requestFunc().catch(err => {
    // 请求出错，使用缓存
    if (forceCache || !window.serviceWorkerReady) {
      try {
        let cacheResponse =
          window.localStorage && window.localStorage.getItem(cacheKey);
        if (cacheResponse) {
          cacheResponse = JSON.parse(cacheResponse);
          if (cacheResponse) {
            return { data: cacheResponse };
          }
        }
      } catch (error) {
        //
      }
    }
    throw err;
  });
  if (
    (forceCache || !window.serviceWorkerReady) &&
    res.data &&
    res.data.isSuccess
  ) {
    window.localStorage &&
      window.localStorage.setItem(cacheKey, JSON.stringify(res.data));
  }
  return res;
};

export const cacheFirstRequest = async function(
  requestFunc,
  cacheKey,
  validateCache,
  forceCache
) {
  cacheKey = "localCache@" + cacheKey;
  // validateCache === true 时，直接刷新缓存
  if (validateCache !== true) {
    if (forceCache || !window.serviceWorkerReady) {
      try {
        let cacheResponse =
          window.localStorage && window.localStorage.getItem(cacheKey);
        if (cacheResponse) {
          cacheResponse = JSON.parse(cacheResponse);
          if (cacheResponse) {
            if (
              !validateCache ||
              (validateCache && validateCache(cacheResponse))
            ) {
              return { data: cacheResponse };
            }
          }
        }
      } catch (error) {
        //
      }
    }
  }
  const res = await requestFunc();
  if (
    (forceCache || !window.serviceWorkerReady) &&
    res.data &&
    res.data.isSuccess
  ) {
    window.localStorage &&
      window.localStorage.setItem(cacheKey, JSON.stringify(res.data));
  }
  return res;
};

export const isMiniInterface = () => window.innerWidth <= 750;
