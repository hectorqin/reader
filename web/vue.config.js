// vue.config.js
var packageInfo = require("./package.json");

function buildVersion() {
  const now = new Date();
  const pad = v => (v >= 10 ? "" + v : "0" + v);
  return (
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes())
  );
}
process.env.VUE_APP_BUILD_VERSION =
  process.env.VUE_APP_BUILD_VERSION ||
  "v" + packageInfo.version + "-" + buildVersion();

function customWorkboxPlugin(generateCacheKey, checkResponse) {
  return {
    generateCacheKey,
    checkResponse,
    // Return `response`, a different `Response` object, or `null`.
    cacheWillUpdate: async function cacheWillUpdate({
      request,
      response,
      event,
      state
    }) {
      // console.log({ request, response, event, state });
      const resCopy = response.clone();
      if (this.checkResponse) {
        return await this.checkResponse({
          request,
          response: resCopy,
          event,
          state
        });
      }
      const body = await resCopy.json().catch(() => false);
      if (body && body.isSuccess) {
        // 请求成功
        return response;
      } else {
        // 请求失败
        return null;
      }
    },
    cacheKeyWillBeUsed: async function cacheKeyWillBeUsed({
      request,
      mode,
      params,
      event,
      state
    }) {
      // `request` is the `Request` object that would otherwise be used as the cache key.
      // `mode` is either 'read' or 'write'.
      // Return either a string, or a `Request` whose `url` property will be used as the cache key.
      // Returning the original `request` will make this a no-op.
      // 只使用 url 参数 作为缓存key
      // console.log({
      //   request,
      //   mode,
      //   params,
      //   event,
      //   state
      // });
      if (this.generateCacheKey) {
        const cacheKey = this.generateCacheKey({
          request,
          mode,
          params,
          event,
          state
        });
        return cacheKey || request;
      } else {
        return request;
      }
    }
  };
}

module.exports = {
  publicPath: "./",
  productionSourceMap: false,
  devServer: {
    port: 8081
  },
  pwa: {
    name: "阅读",
    themeColor: "#ffffff",
    msTileColor: "#000000",

    appleMobileWebAppCapable: "yes",
    appleMobileWebAppStatusBarStyle: "black-translucent",

    manifestOptions: {
      // display: "standalone"
      display: "fullscreen"
    },

    // configure the workbox plugin
    // workboxPluginMode: "InjectManifest",
    workboxOptions: {
      // swSrc is required in InjectManifest mode.
      // swSrc: "src/service-worker.js"
      // ignoreURLParametersMatching: [new RegExp("accessToken")],
      exclude: ["index.html"],
      importScripts: ["sw.js"],
      cleanupOutdatedCaches: true,
      // skipWaiting: true,
      runtimeCaching: [
        {
          // 首页
          urlPattern: new RegExp("^https?://[^/]*/?$"),
          handler: "networkFirst",
          options: {
            cacheName: "home",
            cacheableResponse: {
              statuses: [200]
            }
          }
        },
        {
          // 获取书架
          urlPattern: new RegExp("^https?://[^/]*/reader3/getBookshelf"),
          handler: "networkFirst",
          options: {
            cacheName: "bookshelf",
            cacheableResponse: {
              statuses: [200]
            },
            plugins: [
              customWorkboxPlugin(({ request }) => {
                const searchParams = new URL(request.url).searchParams;
                const accessToken = searchParams.get("accessToken");
                if (!accessToken) {
                  return request;
                }
                return "getBookshelf@" + accessToken.split(":")[0];
              })
            ]
          }
        },
        // 书源手动缓存在 localStorage
        // {
        //   // 获取书源
        //   urlPattern: new RegExp("^https?://[^/]*/reader3/getSources"),
        //   handler: "networkFirst",
        //   options: {
        //     cacheName: "bookSources",
        //     cacheableResponse: {
        //       statuses: [200]
        //     }
        //   }
        // },
        {
          // 获取书籍章节列表
          urlPattern: new RegExp("^https?://[^/]*/reader3/getChapterList"),
          handler: "networkFirst",
          options: {
            cacheName: "bookChapterList",
            networkTimeoutSeconds: 5,
            cacheableResponse: {
              statuses: [200]
            },
            plugins: [
              customWorkboxPlugin(({ request }) => {
                const searchParams = new URL(request.url).searchParams;
                return searchParams.get("url") + "@chapterList";
              })
            ]
          }
        },
        {
          // 获取书籍内容
          urlPattern: new RegExp("^https?://[^/]*/reader3/getBookContent"),
          handler: "cacheFirst",
          options: {
            cacheName: "bookContent",
            cacheableResponse: {
              statuses: [200]
            },
            expiration: {
              maxAgeSeconds: 86400 * 30,
              maxEntries: 10000
            },
            plugins: [
              customWorkboxPlugin(({ request, mode }) => {
                const searchParams = new URL(request.url).searchParams;
                if (mode === "read" && searchParams.get("refresh")) {
                  // 刷新时不读取缓存
                  return false;
                }
                return (
                  searchParams.get("url") +
                  "@chapterContent-" +
                  searchParams.get("index")
                );
              })
            ]
          }
        },
        {
          // 获取书籍封面
          urlPattern: new RegExp("^https?://[^/]*/reader3/cover"),
          handler: "cacheFirst",
          options: {
            cacheName: "bookCover",
            cacheableResponse: {
              statuses: [200]
            },
            expiration: {
              maxAgeSeconds: 86400 * 30,
              maxEntries: 1000
            },
            plugins: [
              customWorkboxPlugin(
                ({ request }) => {
                  const searchParams = new URL(request.url).searchParams;
                  return searchParams.get("path");
                },
                ({ response }) => {
                  if (response.status === 200) {
                    return response;
                  }
                  return null;
                }
              )
            ]
          }
        }
      ]
    }
  }
};
